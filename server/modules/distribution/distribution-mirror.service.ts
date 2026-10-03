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
} from '@server/database/schema';
import type {
  GarmentPurchaseOrderCreateDto,
  GarmentPurchaseReturnCreateDto,
  GarmentPurchaseReturn,
} from '@shared/api.interface';
import { GarmentPurchaseOrderService } from '../purchase/garment-order/garment-purchase-order.service';
import { GarmentPurchaseReturnService } from '../purchase/garment-return/garment-purchase-return.service';

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

    return {
      downstreamDealerId: downstreamDealer.id,
      downstreamDealerName: downstreamDealer.name,
      upstreamSupplierId: supRows[0].id,
      upstreamSupplierName: supRows[0].name,
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
      const created: GarmentPurchaseReturn = await this.db.transaction(async (tx) => {
        const ret = await this.garmentPurchaseReturnService.create(
          {
            inboundId: gpi.id,
            returnDate: sr.returnDate,
            remark: `分销镜像：上游销售退货单 ${sr.returnNo}`,
            skus: returnSkus,
          },
          tx,
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
}
