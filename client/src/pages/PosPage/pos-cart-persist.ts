import type { SaleItem, Member } from '@shared/api.interface';

/**
 * U-修复：收银台购物车持久化。
 *
 * 门店现场误触刷新、浏览器崩溃、切页面回来都会丢掉整购物车，
 * 收银员必须重新扫码一遍。这里把购物车与会员暂存到本地，刷新后自动恢复。
 *
 * 注意：只存「未结算」的购物车，订单一旦提交成功即清空（见 clearPersistedCart）。
 */

const KEY = 'yuncaipos_cart_v1';

export interface PersistedCart {
  cart: SaleItem[];
  member: Member | null;
  savedAt: number;
}

/** 超过该时长（12 小时）视为上一班遗留的僵尸数据，不再恢复 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function readPersistedCart(): PersistedCart | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedCart;
    if (!parsed || !Array.isArray(parsed.cart) || parsed.cart.length === 0) return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedCart(cart: SaleItem[], member: Member | null): void {
  try {
    if (cart.length === 0) {
      localStorage.removeItem(KEY);
      return;
    }
    const payload: PersistedCart = { cart, member, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* 隐私模式或配额不足时忽略，不影响收银 */
  }
}

export function clearPersistedCart(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
