// C.3 回归测试：生产类列表 API 必须把 startDate/endDate 真正转发给 request。
// 后端 material-issue / finish-receipt 的 list service 已支持按 issueDate/receiptDate
// 区间过滤（gte(startDate) + lt(endDate)），此前前端两页从未发送这两个字段，
// 导致日期筛选“填了无效”。本测试锁定 contract，防止回退。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request } from '../client/src/api/request';
import { productionApi } from '../client/src/api/production';

vi.mock('../client/src/api/request', () => ({
  request: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

describe('C.3 生产列表 API 转发 startDate/endDate（防回退）', () => {
  beforeEach(() => {
    vi.mocked(request).mockClear();
  });

  it('materialIssue.list 把 startDate/endDate 透传给 request 第 4 个参数', async () => {
    await productionApi.materialIssue.list({
      page: 1,
      pageSize: 10,
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });
    expect(vi.mocked(request)).toHaveBeenCalledTimes(1);
    const params = vi.mocked(request).mock.calls[0][3] as Record<string, unknown>;
    expect(params).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });
  });

  it('finishReceipt.list 把 startDate/endDate 透传给 request 第 4 个参数', async () => {
    await productionApi.finishReceipt.list({
      page: 1,
      pageSize: 10,
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    });
    expect(vi.mocked(request)).toHaveBeenCalledTimes(1);
    const params = vi.mocked(request).mock.calls[0][3] as Record<string, unknown>;
    expect(params).toMatchObject({
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    });
  });

  it('未传日期时不附加 startDate/endDate（避免把 null 发后端）', async () => {
    await productionApi.materialIssue.list({ page: 1, pageSize: 10 });
    const params = vi.mocked(request).mock.calls[0][3] as Record<string, unknown>;
    expect(params.startDate).toBeUndefined();
    expect(params.endDate).toBeUndefined();
  });
});
