/**
 * W1-3 关键路径：POS 接收端钱包事件入口契约（PosReceiverService.receiveWalletEvent）。
 *
 * 纯单元测试，不依赖数据库：直接构造 service，桩 MemberWalletService.applyWalletEvent，
 * 验证入参校验（eventKey/memberId/kind/changeValue）与幂等委托 / 拒绝透传。
 * 这条路径是 S3 门店积分/储值上行入账的入口，属于资金安全关键路径，必须有契约护栏。
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PosReceiverService } from '@server/modules/pos-receiver/pos-receiver.service';

function makeService(fakeApply: ReturnType<typeof vi.fn>) {
  const db: unknown = {}; // receiveWalletEvent 自身不读取 db
  const walletService = { applyWalletEvent: fakeApply };
  // 构造函数签名 (db, walletService)，直接 new 绕过 DI 容器
  return new PosReceiverService(db as never, walletService as never);
}

describe('W1-3 POS 接收端 receiveWalletEvent 契约', () => {
  it('缺 eventKey → 400（幂等键必填）', async () => {
    const svc = makeService(vi.fn());
    await expect(
      svc.receiveWalletEvent({ memberId: 'm1', kind: 'points', changeValue: 10 } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('缺 memberId → 400（ERP 会员主键必填）', async () => {
    const svc = makeService(vi.fn());
    await expect(
      svc.receiveWalletEvent({ eventKey: 'k', kind: 'points', changeValue: 10 } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('kind 非法 → 400（必须为 points / stored_value）', async () => {
    const svc = makeService(vi.fn());
    await expect(
      svc.receiveWalletEvent({ eventKey: 'k', memberId: 'm1', kind: 'foo', changeValue: 10 } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('changeValue 非数字 → 400', async () => {
    const svc = makeService(vi.fn());
    await expect(
      svc.receiveWalletEvent({ eventKey: 'k', memberId: 'm1', kind: 'points', changeValue: NaN } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('正常路径 → 委托 applyWalletEvent 并原样返回其结果与 eventKey', async () => {
    const apply = vi.fn(async (p: Record<string, unknown>) => ({
      status: 'applied',
      eventKey: p.eventKey,
      message: 'ok',
    }));
    const svc = makeService(apply);
    const r = await svc.receiveWalletEvent({
      eventKey: 'k1',
      memberId: 'm1',
      kind: 'points',
      changeValue: 10,
      sourceType: 'pos',
      sourceNo: 'S1',
      storeCode: 'BJ01',
    } as never);

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'k1',
        memberId: 'm1',
        kind: 'points',
        changeValue: 10,
        sourceType: 'pos',
        sourceNo: 'S1',
        storeCode: 'BJ01',
      }),
    );
    expect(r.status).toBe('applied');
    expect(r.eventKey).toBe('k1');
  });

  it('rejected 状态 → 原样返回而非抛异常（业务不可重试，转运营对账补单）', async () => {
    const apply = vi.fn(async () => ({
      status: 'rejected',
      eventKey: 'k2',
      message: 'member not synced',
    }));
    const svc = makeService(apply);
    const r = await svc.receiveWalletEvent({
      eventKey: 'k2',
      memberId: 'm2',
      kind: 'stored_value',
      changeValue: -100,
    } as never);

    expect(r.status).toBe('rejected');
    expect(String(r.message)).toContain('not synced');
  });
});
