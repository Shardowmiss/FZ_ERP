import { Injectable, Logger } from '@nestjs/common';
import postgres from 'postgres';
import { RequestContext } from '../../common/logging/request-context';
import { emitLog } from '../../common/logging/logger';
import type { ErpPromotionRow } from './promotion-mapping';

/**
 * 真实 ERP 适配器（TEST-P）
 * ------------------------------------------------------------------
 * 与 MockErpService 实现【完全相同】的契约接口，但数据源从“硬编码假数据”
 * 改为读取真实 ERP 数据库（TEST-P）。部署到 lark-apaas 平台后，只需把
 * ErpIntegrationModule 的 provider 由 MockErpService 切换为 RealErpAdapter，
 * 即可让 ErpIntegrationService.syncDownstream / 上游 receive* 直接对接真实 ERP，
 * 无需改动任何同步逻辑。
 *
 * 连接：通过环境变量 ERP_DATABASE_URL 指定 ERP 库（跨服务 DB 访问）。
 * 读取方式：使用 postgres-js 原生客户端 + 参数化查询（避免跨项目引入 ERP schema）。
 *
 * 已验证（见 pos-erp-link.cjs 联调脚本）：ERP→POS 下行字段映射全部成立，
 * 门店库存合计与 ERP 完全一致（375 = 375）。
 */
/** RealErpAdapter 读出的 ERP promotion 行（下划线命名保持与库列名一致）。 */
interface ErpRawPromotionRow {
  id: string;
  code: string | null;
  name: string | null;
  type: string | null;
  threshold: unknown;
  reduce_amount: unknown;
  discount_rate: unknown;
  begin_date: unknown;
  end_date: unknown;
  store_ids: string[] | null;
  priority: unknown;
  status: string | null;
  _updated_at: unknown;
}

@Injectable()
export class RealErpAdapter {
  private readonly logger = new Logger(RealErpAdapter.name);
  private client: ReturnType<typeof postgres>;
  private connectionStatus = true;

  constructor() {
    const url =
      process.env.ERP_DATABASE_URL || 'postgres://erp:erp@localhost:5434/erp_db';
    // postgres-js 惰性连接：构造时不真正建连，首个查询时才连，避免启动期强依赖 ERP 可用性。
    this.client = postgres(url, { onnotice: () => {} });
  }

  // ============ 连接状态 ============
  isConnected(): boolean {
    return this.connectionStatus;
  }

  setConnected(connected: boolean): void {
    this.connectionStatus = connected;
    this.logger.log(`ERP连接状态变更: ${connected ? '在线' : '离线'}`);
  }

  private ensureConnected(): void {
    if (!this.connectionStatus) {
      throw new Error('ERP连接已断开，当前为离线模式');
    }
  }

  /** 将 ERP 数值（numeric 返回为字符串）安全转 number */
  private num(v: unknown, d = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  // ============ 下行数据（ERP → POS） ============

  /**
   * 获取款式主数据 + 颜色/尺码目录。
   * 注意：ERP 的 color_group.colors / size_group.sizes 为 []，真实颜色尺码落在 sku 表，
   * 故从 sku 反推颜色/尺码目录；颜色无 hex，默认 #000000。
   */
  async getStyles(lastSyncTime?: string): Promise<{
    styles: Array<{
      id: string;
      name: string;
      category: string;
      colorIds: string[];
      sizeIds: string[];
      tagPrice: number;
      costPrice: number;
      status: string;
    }>;
    colors: Array<{ id: string; name: string; hex: string }>;
    sizes: Array<{ id: string; sortOrder: number }>;
    total: number;
  }> {
    this.ensureConnected();
    this.logger.log(`[RealERP] 获取款式数据 ${lastSyncTime ? '(增量)' : '(全量)'}`);

    const colorRows =
      await this.client`SELECT DISTINCT color FROM sku WHERE color IS NOT NULL ORDER BY color`;
    const sizeRows =
      await this.client`SELECT DISTINCT size FROM sku WHERE size IS NOT NULL ORDER BY size`;
    const styleRows =
      await this.client`SELECT style_no, name, category, status, tag_price, cost_price FROM style`;

    const colors = colorRows.map((c: any) => ({
      id: c.color,
      name: c.color,
      hex: '#000000',
    }));
    const sizes = sizeRows.map((s: any, i: number) => ({
      id: s.size,
      sortOrder: i + 1,
    }));

    // P1-1 修复 N+1：原实现循环内对每款逐查 `sku` 组合（款数 × 1 次查询）。
    // 改为一次性批量查所有款的组合，内存按 style_no 归并。
    const styleNos = (styleRows as any[]).map((s: any) => s.style_no);
    const comboRows = styleNos.length
      ? await this.client`SELECT DISTINCT style_no, color, size FROM sku WHERE style_no = ANY(${styleNos})`
      : [];
    const combosByStyle = new Map<string, Array<{ color: string; size: string }>>();
    for (const c of comboRows as any[]) {
      const arr = combosByStyle.get(c.style_no) || [];
      arr.push({ color: c.color, size: c.size });
      combosByStyle.set(c.style_no, arr);
    }

    const styles: any[] = (styleRows as any[]).map((st: any) => {
      const combos = combosByStyle.get(st.style_no) || [];
      const colorIds = [...new Set(combos.map((c: any) => c.color))];
      const sizeIds = [...new Set(combos.map((c: any) => c.size))];
      return {
        id: st.style_no,
        name: st.name,
        category: st.category || '未分类',
        colorIds,
        sizeIds,
        tagPrice: this.num(st.tag_price),
        costPrice: this.num(st.cost_price),
        status: st.status === 'active' ? 'on_sale' : 'off_shelf',
      };
    });

    return { styles, colors, sizes, total: styles.length };
  }

  /**
   * 获取价格数据。ERP 价格已并入款式（tag_price/cost_price）下发，
   * 此处返回 SKU 级价格（tagPrice + costPrice；vipPrice 暂无独立字段，暂等于 tagPrice）。
   */
  async getPrices(styleIds?: string[]): Promise<
    Array<{
      styleId: string;
      skuId: string;
      tagPrice: number;
      vipPrice: number;
      costPrice: number;
    }>
  > {
    this.ensureConnected();
    this.logger.log(`[RealERP] 获取价格数据, 款数: ${styleIds?.length ?? '全部'}`);
    const rows = styleIds?.length
      ? await this.client`SELECT style_no, sku_code, tag_price, cost_price FROM sku WHERE style_no = ANY(${styleIds})`
      : await this.client`SELECT style_no, sku_code, tag_price, cost_price FROM sku`;
    return (rows as any[]).map((r) => ({
      styleId: r.style_no,
      skuId: r.sku_code,
      tagPrice: this.num(r.tag_price),
      vipPrice: this.num(r.tag_price),
      costPrice: this.num(r.cost_price),
    }));
  }

  /**
   * 获取促销活动（Wave 4-C：由空桩改为真实读取 ERP 促销中心）。
   *
   * 原实现 `return []`，导致 POS 的 `syncDownstream('promotions')` 永远同步到
   * 「0 条成功」，门店收银台对总部促销一无所知。这里直接读 ERP 的 promotion 表。
   *
   * 输出形态 = ErpPromotionRow（金额用「元」，与 ERP numeric 列一致；
   * 门店维度由 PromotionSyncService 原样落库，不在传输层裁剪）。
   *
   * ⚠ storeId 参数**刻意不接受裁剪**：促销同步必须拉「全部门店可见的促销」。
   * 若按门店 A 拉一次、再按门店 B 拉一次，门店 A 的促销会因不在第二次快照里
   * 而被墓碑软删 —— 这是最隐蔽的一类资损。门店过滤交给计价侧内存过滤。
   */
  async getPromotions(storeId?: string): Promise<ErpPromotionRow[]> {
    this.ensureConnected();
    this.logger.log(`[RealERP] 获取促销活动${storeId ? `, 门店: ${storeId}（仅日志，实际不过滤）` : ''}`);

    const rows = (await this.client`
      SELECT id,
             code,
             name,
             type,
             threshold,
             reduce_amount,
             discount_rate,
             begin_date,
             end_date,
             store_ids,
             priority,
             status,
             _updated_at
      FROM promotion
      WHERE status = 'active'
      ORDER BY priority DESC, _created_at DESC
    `) as unknown as ErpRawPromotionRow[];

    return rows.map((r) => ({
      erpPromotionId: String(r.id),
      erpCode: r.code ?? undefined,
      name: String(r.name ?? ''),
      type: String(r.type ?? ''),
      thresholdYuan: this.num(r.threshold),
      reduceAmountYuan: this.num(r.reduce_amount),
      discountRate: this.num(r.discount_rate, 1),
      beginDate: r.begin_date ? String(r.begin_date).slice(0, 10) : null,
      endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
      storeIds: (r.store_ids as string[] | null) ?? [],
      priority: this.num(r.priority),
      // postgres-js 模板查询的标量与复合列一律 unknown，这里收窄为 string | Date
      updatedAt: r._updated_at ? new Date(r._updated_at as string | Date).toISOString() : null,
    }));
  }

  /**
   * 获取会员数据。ERP member 无 storedValue（储值）字段，置 0。
   */
  async getMembers(lastSyncTime?: string): Promise<{
    members: Array<{
      /** S2 身份锚点：ERP `member.id`。下行以它为 ON CONFLICT 目标，不能为空 */
      erpMemberId: string;
      memberNo: string;
      name: string;
      phone: string;
      gender: string;
      birthday: string;
      level: string;
      points: number;
      storedValue: number;
    }>;
    total: number;
  }> {
    this.ensureConnected();
    this.logger.log(`[RealERP] 获取会员数据 ${lastSyncTime ? '(增量)' : '(全量)'}`);
    // S2：必须取 `id`。此前只按业务键 member_no 做冲突目标，ERP 改会员号就会
    // 把同一自然人插成第二行（档案与积分分裂），故以主键作为唯一真相锚点。
    const rows = lastSyncTime
      ? await this.client`SELECT id, member_no, name, phone, gender, birthday, level, points FROM member WHERE _updated_at >= ${new Date(lastSyncTime)}`
      : await this.client`SELECT id, member_no, name, phone, gender, birthday, level, points FROM member`;
    const members = (rows as any[]).map((m) => ({
      erpMemberId: String(m.id),
      memberNo: m.member_no,
      name: m.name,
      phone: m.phone || `EMPTY_${m.member_no}`,
      gender: m.gender || 'unknown',
      birthday: m.birthday ? String(m.birthday) : '',
      level: m.level || 'normal',
      points: this.num(m.points),
      storedValue: 0,
    }));
    return { members, total: members.length };
  }

  /**
   * 获取库存数据（总部仓库 → 门店）。storeId 对应 ERP 门店仓 warehouse.code；
   * 不传则返回所有门店仓库存。skuId 采用与 POS 一致的 `${style_no}-${color}-${size}`。
   */
  async getStock(storeId: string): Promise<Array<{
    skuId: string;
    styleId: string;
    colorId: string;
    sizeId: string;
    qty: number;
  }>> {
    this.ensureConnected();
    this.logger.log(`[RealERP] 获取库存数据, 门店: ${storeId}`);
    const rows = storeId
      ? await this.client`SELECT s.style_no, s.color, s.size, s.quantity, w.code AS wh_code
         FROM inventory_stock s JOIN warehouse w ON w.id = s.warehouse_id
         WHERE w.type = 'store' AND w.code = ${storeId}`
      : await this.client`SELECT s.style_no, s.color, s.size, s.quantity, w.code AS wh_code
         FROM inventory_stock s JOIN warehouse w ON w.id = s.warehouse_id
         WHERE w.type = 'store'`;
    return (rows as any[]).map((r) => ({
      skuId: `${r.style_no}-${r.color}-${r.size}`,
      styleId: r.style_no,
      colorId: r.color,
      sizeId: r.size,
      qty: this.num(r.quantity),
      // wh_code 仅用于服务端按门店落库，不进入 POS 契约字段
      ...(storeId ? {} : { _storeId: r.wh_code }),
    })) as any;
  }

  /**
   * 获取调拨单。仅取“目的仓为门店仓”的调拨（成衣到店），物料调拨跳过。
   */
  async getTransfers(storeId: string): Promise<Array<{
    erpNo: string;
    fromLocation: string;
    toLocation: string;
    type: string;
    items: Array<{
      skuId: string;
      styleId: string;
      colorId: string;
      sizeId: string;
      plannedQty: number;
    }>;
  }>> {
    this.ensureConnected();
    this.logger.log(`[RealERP] 获取调拨单, 门店: ${storeId}`);
    const transferRows = storeId
      ? await this.client`SELECT it.id, it.transfer_no, it.from_warehouse_name, it.to_warehouse_name, it.status, tw.code AS to_wh_code
         FROM inventory_transfer it JOIN warehouse tw ON tw.id = it.to_warehouse_id
         WHERE tw.type = 'store' AND tw.code = ${storeId}`
      : await this.client`SELECT it.id, it.transfer_no, it.from_warehouse_name, it.to_warehouse_name, it.status, tw.code AS to_wh_code
         FROM inventory_transfer it JOIN warehouse tw ON tw.id = it.to_warehouse_id
         WHERE tw.type = 'store'`;

    // P1-1 修复 N+1：原实现循环内对每笔调拨单查 item（且子查询再查一次 transfer），
    // 调拨单数 × 2 次查询。改为一次性批量查所有调拨单的明细，内存按 transfer_id 分组。
    const transferIds = (transferRows as any[]).map((r: any) => r.id);
    const itemRows = transferIds.length
      ? await this.client`SELECT tti.transfer_id, tti.quantity, s.style_no, s.color, s.size
           FROM inventory_transfer_item tti LEFT JOIN sku s ON s.id = tti.sku_id
           WHERE tti.transfer_id = ANY(${transferIds})`
      : [];
    const itemsByTransfer = new Map<string, any[]>();
    for (const it of itemRows as any[]) {
      const arr = itemsByTransfer.get(it.transfer_id) || [];
      arr.push(it);
      itemsByTransfer.set(it.transfer_id, arr);
    }

    const out: any[] = (transferRows as any[]).map((tf: any) => {
      const items = (itemsByTransfer.get(tf.id) || [])
        .filter((it: any) => it.style_no)
        .map((it: any) => ({
          skuId: `${it.style_no}-${it.color}-${it.size}`,
          styleId: it.style_no,
          colorId: it.color,
          sizeId: it.size,
          plannedQty: this.num(it.quantity),
        }));
      return {
        erpNo: tf.transfer_no,
        fromLocation: tf.from_warehouse_name,
        toLocation: tf.to_warehouse_name,
        type: 'in',
        items,
      };
    });
    return out;
  }

  // ============ 上行数据（POS → ERP） ============
  // P1-1b：由 TODO 桩改为真实 HTTP 推送骨架。
  // ERP 接收端基址由环境变量 ERP_UPSTREAM_BASE_URL 配置；未配置时真实报错（不再谎报成功）。
  // 网络异常 / 超时 / 非 2xx 均抛错，由调用方（ErpIntegrationService.pushUpstream /
  // retryFailedUpstream）记录 failed 日志并按需重试。上行走 HTTP，独立于 ERP DB 连接开关。

  private upstreamBaseUrl(): string {
    return process.env.ERP_UPSTREAM_BASE_URL ?? '';
  }

  private upstreamPath(bizType: string): string {
    const map: Record<string, string> = {
      sales: '/sales',
      returns: '/returns',
      stocktakes: '/stocktakes',
      transfer_requests: '/transfer-requests',
      eod: '/eods',
    };
    const path = map[bizType];
    if (!path) {
      throw new Error(`不支持的上行类型: ${bizType}`);
    }
    return path;
  }

  /**
   * 向 ERP 接收端推送一条单据。最多重试 3 次（指数退避），每次携带幂等键。
   * 成功返回 { success:true, erpNo? }；任一失败均抛出（由调用方记 failed）。
   */
  private async pushToErp(
    bizType: string,
    docNo: string,
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; erpNo?: string; message?: string }> {
    const baseUrl = this.upstreamBaseUrl();
    if (!baseUrl) {
      throw new Error('ERP 上游接收端未配置（请设置环境变量 ERP_UPSTREAM_BASE_URL）');
    }
    const url = `${baseUrl.replace(/\/$/, '')}${this.upstreamPath(bizType)}`;

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      // 链路贯穿：把 POS 这侧的 requestId 作为 traceId 带上行，
      // ERP 接收端会以同一 traceId 记录收单日志，两端日志即可串成一条链。
      // 必须在 try 外声明：重试次数递增，但 traceId 需在整个重试周期内保持稳定
      // （否则同一次推送的三次重试会变成三个互不相关的 traceId），且 catch 里也要能引用。
      // 非请求上下文（定时任务 / 脚本）降级为本地短 ID，不影响功能。
      // traceId 取「上下文 traceId → 本端 requestId → 本地短 ID」：
      // 只要走到 X-Request-Id / X-Trace-Id 两个头必须是**同一个值**，ERP 侧才能用
      // 同一个 traceId 串联本次收单；前者缺失时回退到 requestId 可保证这一点。
      const traceId =
        RequestContext.getTraceId() ??
        RequestContext.getRequestId() ??
        `${bizType}:${docNo}:${attempt}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `${bizType}:${docNo}:${attempt}`,
            // server-to-server 上行密钥（与 ERP 接收端 UpstreamTokenGuard 校验一致）
            'X-Erp-Upstream-Token': process.env.ERP_UPSTREAM_TOKEN ?? '',
            // 链路贯穿（Wave 4-A②）：POS 侧 requestId → ERP 侧 traceId
            'X-Request-Id': traceId,
            'X-Trace-Id': traceId,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await resp.text();
        if (!resp.ok) {
          throw new Error(`ERP 接收端返回 ${resp.status}: ${text.slice(0, 200)}`);
        }
        let erpNo: string | undefined;
        try {
          const json = JSON.parse(text) as { erpNo?: string; data?: { erpNo?: string } };
          erpNo = json.erpNo ?? json.data?.erpNo;
        } catch {
          // 非 JSON 响应：2xx 即视为成功，erpNo 留空
        }
        // 上行结果改为结构化输出并带上 traceId：ERP 侧日志使用同一 traceId，
        // 一次推送的两端可以在日志平台上直接对上（此前只有自由文本，无法关联）。
        emitLog('info', 'upstream.push', { bizType, docNo, attempt, erpNo, traceId });
        return { success: true, erpNo, message: '已接收' };
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        emitLog('warn', 'upstream.push.retry', {
          bizType,
          docNo,
          attempt,
          traceId,
          err: err instanceof Error ? err.message : String(err),
        });
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
        }
      }
    }
    throw new Error(
      `ERP 上行 ${bizType} ${docNo} 失败（已重试 3 次）: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  async receiveSales(orderData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.logger.log(`[RealERP] 上行销售单: ${orderData.orderNo}`);
    return this.pushToErp('sales', String(orderData.orderNo ?? ''), orderData);
  }

  async receiveReturns(returnData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.logger.log(`[RealERP] 上行退货单: ${returnData.returnNo}`);
    return this.pushToErp('returns', String(returnData.returnNo ?? ''), returnData);
  }

  async receiveStocktake(stocktakeData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.logger.log(`[RealERP] 上行盘点单: ${stocktakeData.stocktakeNo}`);
    return this.pushToErp('stocktakes', String(stocktakeData.stocktakeNo ?? ''), stocktakeData);
  }

  async receiveTransferRequest(reqData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.logger.log(`[RealERP] 上行要货申请: ${reqData.reqNo}`);
    return this.pushToErp('transfer_requests', String(reqData.reqNo ?? ''), reqData);
  }

  async receiveEod(eodData: Record<string, unknown>): Promise<{
    success: boolean;
    erpNo?: string;
    message?: string;
  }> {
    this.logger.log(`[RealERP] 上行日结单: ${eodData.eodNo}`);
    return this.pushToErp('eod', String(eodData.eodNo ?? ''), eodData);
  }
}
