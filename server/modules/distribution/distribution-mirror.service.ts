import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray } from 'drizzle-orm';
import {
  dealer,
  supplier,
  sku,
  salesOrder,
  salesOrderItem,
  salesReturn,
  salesReturnItem,
  salesOutbound,
  garmentPurchaseOrder,
  garmentPurchaseReturn,
  garmentPurchaseInbound,
  garmentPurchaseInboundSku,
  garmentPurchaseOrderSku,
} from '@server/database/schema';
import type {
  GarmentPurchaseOrderCreateDto,
  GarmentPurchaseReturnCreateDto,
  GarmentPurchaseReturn,
} from '@shared/api.interface';
import { GarmentPurchaseOrderService } from '../purchase/garment-order/garment-purchase-order.service';
import { GarmentPurchaseReturnService } from '../purchase/garment-return/garment-purchase-return.service';
import { NumberGeneratorService } from '../system/code-rule/number-generator.service';
import { RequestContext } from '@server/common/context/request-context';
import { round2, round3, round4 } from '../../common/utils/money';

type TxLike =
  PostgresJsDatabase |
  Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

interface MirrorContext {
  downstreamDealerId: string;
  downstreamDealerName: string;
  upstreamSupplierId: string;
  upstreamSupplierName: string;
}

/**
 * 多级分销镜像引擎
 * ------------------------------------------------------------------
 * 核心语义：下级分销商进入系统看到的"采购单 / 采购退货单"，本质上是其上级
 * （总部或上级分销商）对它的"销售单 / 销售退货单"。本服务在销售侧单据
 * 记账(book)时，自动向下游生成对应的采购侧单据，并通过 source_doc_id /
 * source_doc_type / downstream_org_id 双向追溯。
 *
 * 设计要点：
 *  - 仅对"分销经销商"（存在上级经销商）生效；顶层总部不镜像。
 *  - 幂等：按 source_doc_id + source_doc_type 去重，book 重复调用不会产生重复单据。
 *  - 安全：任一环节缺失（上级无供应商主数据 / 下游未入库等）则静默跳过，并吞掉异常，
 *    绝不阻断销售侧主流程。
 */
@Injectable()
export class DistributionMirrorService {
  private readonly logger = new Logger(DistributionMirrorService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly garmentPurchaseOrderService: GarmentPurchaseOrderService,
    private readonly garmentPurchaseReturnService: GarmentPurchaseReturnService,
  ) {}

  /**
   * 由"经销商ID"定位分销镜像上下文：
   *   经销商(下级) -> 上级经销商 -> 上级的供应商身份
   * 任一环节不满足（顶层无上级 / 上级无供应商主数据）返回 null。
   */
  private async resolveMirrorContext(dealerId: string): Promise<MirrorContext | null> {
    const dealerRows = await this.db.select().from(dealer).where(eq(dealer.id, dealerId));
    if (dealerRows.length === 0) return null;
    const downstreamDealer = dealerRows[0];

    const parentId = downstreamDealer.parentId;
    if (!parentId) return null; // 顶层（总部）无上级，无需向下镜像

    const upstreamRows = await this.db.select().from(dealer).where(eq(dealer.id, parentId));
    if (upstreamRows.length === 0) return null;

    const supRows = await this.db
      .select()
      .from(supplier)
      .where(eq(supplier.partnerId, upstreamRows[0].id));
    if (supRows.length === 0) return null; // 上级尚未建立供应商主数据

    // 上家名称取「上级经销商」本名，而非 supplier.name：
    // supplier 只是经销商为分销开单而持有的身份马甲，其 name 字段属于冗余存储，历史上
    // 出现过与所属主体脱钩的情况（见 0064_align_partner_supplier_name.sql，42 条全部错位），
    // 直接取用会让下游采购单的上家显示错误名称、导致上下级无法对账。
    // supplierId 仍需指向该身份记录（采购单 supplier_id 外键要求），只有名称以经销商本体为准。
    return {
      downstreamDealerId: downstreamDealer.id,
      downstreamDealerName: downstreamDealer.name,
      upstreamSupplierId: supRows[0].id,
      upstreamSupplierName: upstreamRows[0].name,
    };
  }

  /** 写回销售单的镜像结果（F2：可观测性）。tx 传入时在镜像事务内写，否则独立写。 */
  private async markSalesOrderMirror(
    salesOrderId: string,
    status: 'skipped' | 'success' | 'failed',
    error: string | null,
    orderId: string | null,
    tx?: TxLike,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(salesOrder)
      .set({
        mirrorStatus: status,
        mirrorError: error ?? null,
        mirrorOrderId: orderId ?? null,
      })
      .where(eq(salesOrder.id, salesOrderId));
  }

  /** 写回销售退货单的镜像结果（F2：可观测性）。tx 传入时在镜像事务内写，否则独立写。 */
  private async markSalesReturnMirror(
    salesReturnId: string,
    status: 'skipped' | 'success' | 'failed',
    error: string | null,
    returnId: string | null,
    tx?: TxLike,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(salesReturn)
      .set({
        mirrorStatus: status,
        mirrorError: error ?? null,
        mirrorReturnId: returnId ?? null,
      })
      .where(eq(salesReturn.id, salesReturnId));
  }

  /**
   * 销售单记账(book)后调用：生成下游分销商视角的成衣采购单。
   * 语义：下级采购单 = 上级销售单。
   */
  async mirrorFromSalesOrder(salesOrderId: string): Promise<void> {
    try {
      const soRows = await this.db.select().from(salesOrder).where(eq(salesOrder.id, salesOrderId));
      if (soRows.length === 0) return;
      const so = soRows[0];

      const ctx = await this.resolveMirrorContext(so.dealerId);
      if (!ctx) {
        // 非分销客户 / 顶层总部：无需镜像
        await this.markSalesOrderMirror(salesOrderId, 'skipped', null, null);
        return;
      }

      // 幂等去重：已存在对应下游采购单则跳过（仍回填成功状态与单据 id）
      const dup = await this.db
        .select({ id: garmentPurchaseOrder.id })
        .from(garmentPurchaseOrder)
        .where(
          and(
            eq(garmentPurchaseOrder.sourceDocId, salesOrderId),
            eq(garmentPurchaseOrder.sourceDocType, 'SALES_ORDER'),
          ),
        );
      if (dup.length > 0) {
        await this.markSalesOrderMirror(salesOrderId, 'success', null, dup[0].id);
        return;
      }

      const itemRows = await this.db
        .select()
        .from(salesOrderItem)
        .where(eq(salesOrderItem.orderId, salesOrderId));
      if (itemRows.length === 0) {
        await this.markSalesOrderMirror(salesOrderId, 'skipped', null, null);
        return;
      }

      const skuIds = itemRows.map((i) => i.skuId);
      const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
      const skuMap = new Map(skuRows.map((s) => [s.id, s] as const));

      const purchaseSkus: GarmentPurchaseOrderCreateDto['skus'] = [];
      for (const it of itemRows) {
        const s = skuMap.get(it.skuId);
        if (!s) continue; // 跳过找不到 SKU 的明细
        purchaseSkus.push({
          skuId: it.skuId,
          styleId: s.styleId,
          styleNo: s.styleNo,
          color: s.color,
          size: s.size,
          quantity: Number(it.quantity),
          price: Number(it.price),
        });
      }
      if (purchaseSkus.length === 0) {
        await this.markSalesOrderMirror(salesOrderId, 'skipped', null, null);
        return;
      }

      // ===== 原子镜像：下游采购单创建 + 追溯字段回填 + 销售侧状态回填，全部在一个事务内 =====
      // 任一步失败整体回滚，避免产生 sourceDocId=NULL 的孤儿下游单，进而在重试时重复生成。
      const created = await this.db.transaction(async (tx) => {
        const po = await this.garmentPurchaseOrderService.create(
          {
            supplierId: ctx.upstreamSupplierId,
            supplierName: ctx.upstreamSupplierName,
            orderDate: so.orderDate,
            remark: `分销镜像：上游销售单 ${so.orderNo}`,
            skus: purchaseSkus,
          },
          tx,
        );

        await tx
          .update(garmentPurchaseOrder)
          .set({
            sourceDocId: so.id,
            sourceDocType: 'SALES_ORDER',
            downstreamOrgId: ctx.downstreamDealerId,
            status: 'wait_confirm',
          })
          .where(eq(garmentPurchaseOrder.id, po.id));

        await this.markSalesOrderMirror(salesOrderId, 'success', null, po.id, tx);
        return po;
      });

      this.logger.log(
        `分销镜像：销售单 ${so.orderNo} -> 下游采购单 ${created.orderNo}（分销商 ${ctx.downstreamDealerName}，状态：待接收）`,
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await this.markSalesOrderMirror(salesOrderId, 'failed', msg, null).catch(() => {});
      this.logger.error(`分销镜像(销售单 ${salesOrderId})失败：${msg}`, err?.stack);
    }
  }

  /**
   * 销售退货单记账(book)后调用：生成下游分销商视角的成衣采购退货单。
   * 语义：下级采购退货单 = 上级销售退货单。
   * 前置：下游必须已对该采购单完成入库（存在 garment_purchase_inbound），否则安全跳过。
   */
  async mirrorFromSalesReturn(salesReturnId: string): Promise<void> {
    try {
      const srRows = await this.db.select().from(salesReturn).where(eq(salesReturn.id, salesReturnId));
      if (srRows.length === 0) return;
      const sr = srRows[0];

      const ctx = await this.resolveMirrorContext(sr.dealerId);
      if (!ctx) {
        await this.markSalesReturnMirror(salesReturnId, 'skipped', null, null);
        return;
      }

      // 幂等去重
      const dup = await this.db
        .select({ id: garmentPurchaseReturn.id })
        .from(garmentPurchaseReturn)
        .where(
          and(
            eq(garmentPurchaseReturn.sourceDocId, salesReturnId),
            eq(garmentPurchaseReturn.sourceDocType, 'SALES_RETURN'),
          ),
        );
      if (dup.length > 0) {
        await this.markSalesReturnMirror(salesReturnId, 'success', null, dup[0].id);
        return;
      }

      // 销售退货单 -> 出库单 -> 销售单
      const obRows = await this.db
        .select()
        .from(salesOutbound)
        .where(eq(salesOutbound.id, sr.outboundId));
      if (obRows.length === 0) {
        await this.markSalesReturnMirror(salesReturnId, 'skipped', null, null);
        return;
      }
      const soId = obRows[0].orderId;

      // 下游已镜像生成的采购单
      const gpoRows = await this.db
        .select()
        .from(garmentPurchaseOrder)
        .where(
          and(
            eq(garmentPurchaseOrder.sourceDocId, soId),
            eq(garmentPurchaseOrder.sourceDocType, 'SALES_ORDER'),
            eq(garmentPurchaseOrder.downstreamOrgId, ctx.downstreamDealerId),
          ),
        );
      if (gpoRows.length === 0) {
        await this.markSalesReturnMirror(salesReturnId, 'skipped', null, null);
        return;
      }

      // 下游采购入库单（必须已入库，才能退货）
      const gpiRows = await this.db
        .select()
        .from(garmentPurchaseInbound)
        .where(eq(garmentPurchaseInbound.orderId, gpoRows[0].id));
      if (gpiRows.length === 0) {
        await this.markSalesReturnMirror(salesReturnId, 'skipped', null, null);
        return;
      }
      const gpi = gpiRows[0];

      const gpiSkuRows = await this.db
        .select()
        .from(garmentPurchaseInboundSku)
        .where(eq(garmentPurchaseInboundSku.inboundId, gpi.id));
      const gpiSkuMap = new Map(gpiSkuRows.map((x) => [x.skuId, x] as const));

      const srItemRows = await this.db
        .select()
        .from(salesReturnItem)
        .where(eq(salesReturnItem.returnId, salesReturnId));
      if (srItemRows.length === 0) {
        await this.markSalesReturnMirror(salesReturnId, 'skipped', null, null);
        return;
      }

      const returnSkus: GarmentPurchaseReturnCreateDto['skus'] = [];
      for (const it of srItemRows) {
        const gpiSku = gpiSkuMap.get(it.skuId);
        if (!gpiSku) continue;
        returnSkus.push({
          inboundSkuId: gpiSku.id,
          styleId: gpiSku.styleId,
          styleNo: gpiSku.styleNo,
          skuId: it.skuId,
          color: gpiSku.color,
          size: gpiSku.size,
          quantity: Number(it.quantity),
          price: Number(it.price),
          batchNo: gpiSku.batchNo ?? null,
        });
      }
      if (returnSkus.length === 0) {
        await this.markSalesReturnMirror(salesReturnId, 'skipped', null, null);
        return;
      }

      // ===== 原子镜像：下游采购退货单创建 + 追溯字段回填 + 销售侧状态回填，全部在一个事务内 =====
      // 该退货单归属于下游分销商：以「下游经销商」身份进入 create，由服务端按经销层级
      // 自动解析退货店仓（本店仓）与收货方（上级经销商店仓），并设置 dealerId。
      const created: GarmentPurchaseReturn = await this.db.transaction(async (tx) => {
        const ret = await RequestContext.run(
          {
            requestId: `mirror-sales-return-${salesReturnId}`,
            dealerScope: { type: 'dealer', dealerIds: [ctx.downstreamDealerId] },
          },
          () =>
            this.garmentPurchaseReturnService.create(
              {
                inboundId: gpi.id,
                returnDate: sr.returnDate,
                remark: `分销镜像：上游销售退货单 ${sr.returnNo}`,
                skus: returnSkus,
              },
              tx,
            ),
        );

        await tx
          .update(garmentPurchaseReturn)
          .set({
            sourceDocId: sr.id,
            sourceDocType: 'SALES_RETURN',
            downstreamOrgId: ctx.downstreamDealerId,
          })
          .where(eq(garmentPurchaseReturn.id, ret.id));

        await this.markSalesReturnMirror(salesReturnId, 'success', null, ret.id, tx);
        return ret;
      });

      this.logger.log(
        `分销镜像：销售退货单 ${sr.returnNo} -> 下游采购退货单 ${created.returnNo}（分销商 ${ctx.downstreamDealerName}）`,
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await this.markSalesReturnMirror(salesReturnId, 'failed', msg, null).catch(() => {});
      this.logger.error(`分销镜像(销售退货单 ${salesReturnId})失败：${msg}`, err?.stack);
    }
  }

  /**
   * 【反向镜像】经销商主动发起采购单后，自动生成其上级的销售单。
   *
   * 语义：上级销售单 = 下级采购单 —— 与正向镜像互为逆向：
   *   正向：上级开销售单 → 下级采购单（销售侧驱动，已实现）
   *   反向：下级开采购单 → 上级销售单（采购侧驱动，本方法）
   * 业务侧已确认两种发起方式等价、需同时支持。
   *
   * 为什么不直接调用 SalesOrderService.create：
   *   SalesOrderService 依赖本服务（销售单 book 后触发正向镜像），若本服务再反向依赖它
   *   会形成 Nest 循环依赖导致启动失败。因此这里直接落库，逻辑与 SalesOrderService.create
   *   保持一致（同样的必填校验、金额取整、编码生成规则）。
   *
   * 防二次镜像（关键）：
   *   事务内同时写两个方向 —— 销售单.sourceDocId = 采购单ID，采购单.sourceDocId = 销售单ID。
   *   此后若该销售单流转到 book()，正向镜像的幂等去重
   *   「存在 source_doc_id = 本销售单ID 且 source_doc_type='SALES_ORDER' 的采购单」必然命中，
   *   于是直接跳过，循环被数据结构本身阻断，无需运行时标记。
   *
   * 安全：任一前置不满足（非分销采购 / 根节点 / 上家不是上级）一律静默跳过，
   *       异常吞掉，绝不阻断采购侧主流程。
   */
  async mirrorFromPurchaseOrder(purchaseOrderId: string): Promise<void> {
    try {
      const poRows = await this.db
        .select()
        .from(garmentPurchaseOrder)
        .where(eq(garmentPurchaseOrder.id, purchaseOrderId));
      if (poRows.length === 0) return;
      const po = poRows[0];

      // 幂等：已反向生成过销售单则不再生成
      const dup = await this.db
        .select({ id: salesOrder.id })
        .from(salesOrder)
        .where(
          and(
            eq(salesOrder.sourceDocId, purchaseOrderId),
            eq(salesOrder.sourceDocType, 'PURCHASE_ORDER'),
          ),
        );
      if (dup.length > 0) return;

      // 归属分销节点：只有分销节点发起的采购单才进入反向链路
      const dealerId = po.downstreamOrgId;
      if (!dealerId) {
        this.logger.debug(`反向镜像跳过：采购单 ${po.orderNo} 无归属分销节点，判定为普通采购`);
        return;
      }

      const selfRows = await this.db.select().from(dealer).where(eq(dealer.id, dealerId));
      if (selfRows.length === 0) return;
      const self = selfRows[0];

      if (!self.parentId) {
        this.logger.debug(`反向镜像跳过：${self.name} 为根节点，无上级可为其生成销售单`);
        return;
      }

      const parentRows = await this.db.select().from(dealer).where(eq(dealer.id, self.parentId));
      if (parentRows.length === 0) return;
      const parent = parentRows[0];

      // 上家必须恰好是「上级的供应商身份」，否则属于向外部供应商采购，不应进入分销链路
      const supRows = await this.db.select().from(supplier).where(eq(supplier.id, po.supplierId));
      if (supRows.length === 0 || supRows[0].partnerId !== parent.id) {
        this.logger.debug(
          `反向镜像跳过：采购单 ${po.orderNo} 的上家并非其上级「${parent.name}」，属外部采购`,
        );
        return;
      }

      const lineRows = await this.db
        .select()
        .from(garmentPurchaseOrderSku)
        .where(eq(garmentPurchaseOrderSku.orderId, po.id));
      if (lineRows.length === 0) return;

      // 补全 SKU 主数据（采购明细不带 skuCode / colorId / sizeId，销售明细要求这些列）
      const masterRows = await this.db
        .select()
        .from(sku)
        .where(inArray(sku.id, lineRows.map((r) => r.skuId)));
      const skuMap = new Map(masterRows.map((s) => [s.id, s] as const));

      let totalAmount = 0;
      const orderItems: {
        skuId: string;
        skuCode: string;
        styleNo: string;
        color: string;
        size: string;
        colorId: string | null;
        sizeId: string | null;
        quantity: string;
        price: string;
        amount: string;
        deliveredQty: string;
      }[] = [];

      for (const line of lineRows) {
        const master = skuMap.get(line.skuId);
        if (!master) continue;
        const qty = Number(line.quantity);
        const prc = Number(line.price);
        const amt = qty * prc;
        totalAmount += amt;
        orderItems.push({
          skuId: master.id,
          skuCode: master.skuCode,
          styleNo: master.styleNo,
          color: master.color,
          size: master.size,
          colorId: master.colorId ?? null,
          sizeId: master.sizeId ?? null,
          quantity: round3(qty),
          price: round4(prc),
          amount: round2(amt),
          deliveredQty: '0',
        });
      }
      if (orderItems.length === 0) return;

      // ===== 原子事务：创建上级销售单 + 明细 + 双向追溯字段回填 =====
      const ng = new NumberGeneratorService();
      await this.db.transaction(async (tx) => {
        const datePart = String(po.orderDate).replace(/-/g, '').slice(0, 8);
        const orderNo = await ng.generateNextNo(
          tx,
          salesOrder,
          salesOrder.orderNo,
          `SO${datePart}`,
          4,
        );

        const inserted = await tx
          .insert(salesOrder)
          .values({
            orderNo,
            // 收货方即发起采购的下级经销商 —— 与正向「上级开单、dealerId=下级」完全对称
            dealerId: self.id,
            customerName: self.name,
            orderDate: po.orderDate,
            deliveryDate: po.expectDate ?? null,
            totalAmount: round2(totalAmount),
            status: 'draft',
            sourceType: 'manual',
            remark: `分销反向镜像：下游采购单 ${po.orderNo}`,
            sourceDocId: po.id,
            sourceDocType: 'PURCHASE_ORDER',
            // 反向镜像自身的产物就是本单，记 success 便于后续观测
            mirrorStatus: 'success',
          })
          .returning();
        const so = inserted[0];

        await tx.insert(salesOrderItem).values(
          orderItems.map((item) => ({ ...item, orderId: so.id })),
        );

        // 回填采购单指向本销售单：让正向镜像的幂等去重必然命中，阻断二次镜像
        await tx
          .update(garmentPurchaseOrder)
          .set({
            sourceDocId: so.id,
            sourceDocType: 'SALES_ORDER',
          })
          .where(eq(garmentPurchaseOrder.id, po.id));

        this.logger.log(
          `分销反向镜像：采购单 ${po.orderNo} -> 上级销售单 ${so.orderNo}` +
            `（${parent.name} 对 ${self.name}，状态：待审核）`,
        );
      });
    } catch (err: any) {
      // 与正向一致：镜像失败仅记录，绝不向上抛出阻断采购主流程
      this.logger.error(
        `分销反向镜像(采购单 ${purchaseOrderId})失败：${err?.message ?? String(err)}`,
        err?.stack,
      );
    }
  }
}
