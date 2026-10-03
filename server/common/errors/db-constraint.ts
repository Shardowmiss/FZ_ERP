import { HttpStatus } from '@nestjs/common';
import { ResponseCode } from '../constants/api_response_code';

/**
 * 数据库约束冲突 → 业务可读的中文报错翻译。
 *
 * 痛点：原先 Postgres 的 23503/23505/23514/23502 等约束冲突会被 GlobalExceptionFilter
 * 当成 500「服务器内部错误」抛给前端，前端再包一层硬编码的「保存失败/删除失败」，
 * 业务人员以为系统坏了、运维也无法从文案定位问题。
 *
 * 这里把常见约束错误翻译成「具体原因 + 受影响对象」，运维可凭约束名/表名定位，
 * 业务人员能看懂为什么操作被拒。
 */

export interface DbConstraintError {
  code: ResponseCode;
  message: string;
  httpStatus: HttpStatus;
  details?: string;
}

/**
 * 外键引用表 → 中文业务名。用于把「Key (...) is still referenced from table "style"」
 * 翻译成「该数据已被「款号」引用」。覆盖当前库主要主数据表，未列出的回退为原表名。
 */
const TABLE_LABELS: Record<string, string> = {
  supplier: '供应商',
  dealer: '经销商',
  warehouse: '仓库',
  store: '门店',
  sku: '商品(SKU)',
  style: '款号',
  material: '物料',
  bom: 'BOM',
  member: '会员',
  price_list: '价格表',
  rbac_user: '用户',
  sales_channel: '销售渠道',
  omni_order: '全渠道订单',
  payable: '应付单',
  month_close: '月结单',
  inventory_batch: '库存批次',
  inventory_stock: '库存',
  inventory_stocktake: '盘点单',
  inventory_transfer: '调拨单',
  garment_purchase_order: '成衣采购单',
  garment_purchase_inbound: '成衣入库单',
  garment_purchase_return: '成衣退货单',
  hangtag_print_task: '吊牌打印任务',
  pos_requisition: 'POS要货单',
  pos_return: 'POS退货单',
  purchase_inbound: '采购入库单',
  purchase_order_item: '采购订单明细',
  purchase_order: '采购订单',
  material_purchase_order: '物料采购单',
  material_purchase_inbound: '物料入库单',
  work_order: '工单',
  finish_receipt: '完工入库单',
  material_issue: '物料领用单',
  trade_show: '展会',
  pre_order: '预订单',
  allocation: '配货单',
  retail_order: '零售单',
  sales_order: '销售订单',
  sales_outbound: '销售出库单',
  sales_return: '销售退货单',
};

/**
 * 已知约束名 → 精确中文文案。命中后直接采用，不再做通用推断。
 * 后续新增主数据外键时，在此登记即可获得更友好、更稳定的报错。
 */
const CONSTRAINT_FRIENDLY: Record<string, string> = {
  // 风格/品牌主数据
  style_brand_code_fkey: '该品牌已被款号引用，不允许删除或修改',
  gpo_brand_code_fkey: '该品牌已被成衣采购单引用，不允许删除或修改',
  // 其它主数据（示例，按实际约束名补充）
  payable_supplier_id_fkey: '该供应商已存在应付单据，不允许删除',
  inventory_batch_sku_id_fkey: '该商品已生成库存批次，不允许删除',
  inventory_stock_sku_id_fkey: '该商品已有库存记录，不允许删除',
  inventory_stock_warehouse_id_fkey: '该仓库已有库存记录，不允许删除',
  inventory_transfer_from_warehouse_id_fkey: '该仓库已参与调拨，不允许删除',
  inventory_transfer_to_warehouse_id_fkey: '该仓库已参与调拨，不允许删除',
};

function tableLabel(table: string | undefined): string {
  if (!table) return '其它业务数据';
  return TABLE_LABELS[table] ?? `表「${table}」`;
}

/** 从 Postgres detail 中提取被引用的表名，如 `... referenced from table "style".` */
function extractReferencedTable(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const m = detail.match(/table\s+"([^"]+)"/i);
  return m ? m[1] : undefined;
}

/** 从 Postgres detail 中提取冲突值，如 `Key (code)=(X) already exists.` */
function extractConflictValue(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const m = detail.match(/\([^)]+\)=\(([^)]*)\)/);
  return m ? m[1] : undefined;
}

/**
 * 从异常对象（含 drizzle 包装的 DrizzleQueryError）中提取 SQLSTATE 相关字段。
 *
 * 关键坑（已踩实）：drizzle-orm 执行失败时会把底层 postgres-js 的 PostgresError
 * 包进 `DrizzleQueryError`，且**只在 `.cause` 上保留 `code`/`detail`/`constraint_name`**，
 * 顶层 `.code` 为 undefined。若只读顶层字段，翻译器会拿不到 code → 返回 500「服务器内部错误」，
 * 之前那版「23503→409 具体文案」的修复在真实链路里其实是失效的。这里统一从 `err` 或 `err.cause`
 * 取字段，兼容裸 PostgresError 与 drizzle 包装两种形态。
 */
function dbErrorFields(err: unknown): {
  code?: string;
  detail?: string;
  constraint?: string;
  column?: string;
} {
  if (typeof err !== 'object' || err === null) return {};
  const e = err as Record<string, unknown>;
  const cause = (e.cause && typeof e.cause === 'object' ? (e.cause as Record<string, unknown>) : null);
  const pick = (k: string): string | undefined => {
    const v = e[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (cause && typeof cause[k] === 'string' && (cause[k] as string).length > 0) return cause[k] as string;
    return undefined;
  };
  const constraint = pick('constraint') ?? pick('constraint_name');
  return {
    code: pick('code'),
    detail: pick('detail'),
    constraint,
    column: pick('column'),
  };
}

/** 提取异常（含 drizzle 包装）的 SQLSTATE 码，供过滤器区分 22P02 等场景。 */
export function dbErrorSqlState(err: unknown): string | undefined {
  return dbErrorFields(err).code;
}

export function translateDbConstraintError(err: unknown): DbConstraintError | null {
  const { code, detail, constraint, column } = dbErrorFields(err);
  if (!code) return null;

  switch (code) {
    case '23503': {
      // 外键冲突：删除被引用主数据 / 写入非法外键值
      const friendly = constraint ? CONSTRAINT_FRIENDLY[constraint] : undefined;
      const refTable = extractReferencedTable(detail);
      const msg =
        friendly ??
        (refTable
          ? `该数据已被「${tableLabel(refTable)}」引用，不允许删除或修改`
          : '该数据已被其它业务数据引用，不允许删除或修改');
      return {
        code: ResponseCode.CONFLICT,
        message: msg,
        httpStatus: HttpStatus.CONFLICT,
        details: constraint ? `constraint=${constraint}` : undefined,
      };
    }
    case '23505': {
      // 唯一约束冲突
      const friendly = constraint ? CONSTRAINT_FRIENDLY[constraint] : undefined;
      const value = extractConflictValue(detail);
      const msg =
        friendly ??
        (value
          ? `数据已存在（${value}），请勿重复`
          : '该数据已存在，请勿重复创建');
      return {
        code: ResponseCode.CONFLICT,
        message: msg,
        httpStatus: HttpStatus.CONFLICT,
        details: constraint ? `constraint=${constraint}` : undefined,
      };
    }
    case '23514': {
      // 检查约束冲突
      const friendly = constraint ? CONSTRAINT_FRIENDLY[constraint] : undefined;
      const msg =
        friendly ??
        `数据不满足业务规则约束${constraint ? `（${constraint}）` : ''}，请检查填写内容}`;
      return {
        code: ResponseCode.VALIDATION_ERROR,
        message: msg,
        httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
        details: constraint ? `constraint=${constraint}` : undefined,
      };
    }
    case '23502': {
      // 非空约束冲突
      const msg = column ? `必填字段「${column}」不能为空` : '存在必填字段为空，请补全后重试';
      return {
        code: ResponseCode.VALIDATION_ERROR,
        message: msg,
        httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
        details: column ? `column=${column}` : undefined,
      };
    }
    default:
      return null;
  }
}
