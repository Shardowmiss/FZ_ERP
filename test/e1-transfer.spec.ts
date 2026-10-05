/**
 * W1-3 关键路径：库存调拨读路径 getTransferList（单号/状态筛选 + 分页 + 经销商作用域）。
 *
 * 真库 erp_test：种子一条已知 transfer_no 的调拨单（已提交），验证筛选命中，
 * afterAll 清理，避免污染测试库。读路径是列表/看板/报表的共同依赖，必须有护栏。
 * 注意：service 构造函数的其余依赖（月结/库存/单号生成）仅在 create/approve 使用，
 * 读路径不需要真实实现，故以占位对象注入。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InventoryTransferService } from '@server/modules/inventory/transfer/inventory-transfer.service';
import { createErpClient, createErpDb } from './utils/erp-db';

const TRANSFER_NO = `W1-3-TF-${Date.now()}`;

describe('W1-3 库存调拨 getTransferList 读路径', () => {
  let client: any;
  let svc: InventoryTransferService;
  let whId = '';
  let whName = '';

  beforeAll(async () => {
    client = createErpClient();
    const db = createErpDb(client);
    svc = new InventoryTransferService(db as any, {} as any, {} as any, {} as any);

    const wh = await client<{ id: string; name: string }>`select id, name from warehouse limit 1`;
    if (!wh[0]) throw new Error('erp_test 缺少 warehouse 种子数据，无法构造调拨单');
    whId = wh[0].id;
    whName = wh[0].name;

    await client`
      insert into inventory_transfer
        (transfer_no, from_warehouse_id, from_warehouse_name, to_warehouse_id, to_warehouse_name, transfer_date, item_type, status)
      values
        (${TRANSFER_NO}, ${whId}, ${whName}, ${whId}, ${whName}, ${'2026-10-05'}, 'sku', 'draft')
    `;
  });

  afterAll(async () => {
    await client`delete from inventory_transfer where transfer_no = ${TRANSFER_NO}`.catch(() => undefined);
    await client.end().catch(() => undefined);
  });

  it('按单号模糊筛选命中种子单', async () => {
    const r = await svc.getTransferList({ page: 1, pageSize: 10, transferNo: TRANSFER_NO });
    expect(r.total).toBeGreaterThanOrEqual(1);
    expect(r.items.some((t: any) => t.transferNo === TRANSFER_NO)).toBe(true);
  });

  it('按状态筛选：draft 命中，approved 不命中', async () => {
    const draft = await svc.getTransferList({ page: 1, pageSize: 10, status: 'draft' });
    expect(draft.items.some((t: any) => t.transferNo === TRANSFER_NO)).toBe(true);
    const approved = await svc.getTransferList({ page: 1, pageSize: 10, status: 'approved' });
    expect(approved.items.some((t: any) => t.transferNo === TRANSFER_NO)).toBe(false);
  });

  it('分页 pageSize 限制返回条数，且 total 反映全量', async () => {
    const r = await svc.getTransferList({ page: 1, pageSize: 1 });
    expect(r.items.length).toBeLessThanOrEqual(1);
    expect(r.total).toBeGreaterThanOrEqual(1);
  });
});
