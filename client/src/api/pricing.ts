import { request } from './request';

export interface PriceListItem {
  id: string;
  priceListId: string;
  styleNo?: string | null;
  skuId?: string | null;
  skuCode?: string | null;
  tagPrice: number;
  price: number;
  discountRate: number;
  status: string;
}

export interface PriceList {
  id: string;
  code: string;
  name: string;
  type: string;
  scopeId?: string | null;
  priority: number;
  status: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  remark?: string;
  items?: PriceListItem[];
}

export interface Promotion {
  id: string;
  code: string;
  name: string;
  type: string;
  threshold: number;
  reduceAmount: number;
  discountRate: number;
  beginDate?: string | null;
  endDate?: string | null;
  storeIds: string[];
  priority: number;
  status: string;
  remark?: string;
}

export interface Coupon {
  id: string;
  code: string;
  name: string;
  type: string;
  value: number;
  discountRate: number;
  minSpend: number;
  beginDate?: string | null;
  endDate?: string | null;
  totalQty: number;
  usedQty: number;
  status: string;
  remark?: string;
}

export interface ResolvedPrice {
  skuId?: string;
  skuCode?: string;
  styleNo?: string;
  tagPrice: number;
  listPrice: number;
  finalPrice: number;
  appliedPromotion: {
    id: string;
    name: string;
    type: string;
    discountAmount: number;
  } | null;
  availablePromotions: Array<{
    id: string;
    name: string;
    type: string;
    discountAmount: number;
  }>;
}

export const pricingApi = {
  // 价格表
  listPriceLists: (params: Record<string, any>) =>
    request<any>('/api/pricing/price-list', 'GET', null, params),
  getPriceList: (id: string) =>
    request<PriceList>(`/api/pricing/price-list/${id}`),
  createPriceList: (data: any) =>
    request<{ id: string }>('/api/pricing/price-list', 'POST', data),
  updatePriceList: (id: string, data: any) =>
    request<any>(`/api/pricing/price-list/${id}`, 'PUT', data),
  deletePriceList: (id: string) =>
    request<any>(`/api/pricing/price-list/${id}`, 'DELETE'),
  addPriceListItems: (id: string, items: any[]) =>
    request<any>(`/api/pricing/price-list/${id}/items`, 'POST', { items }),
  updatePriceListItem: (itemId: string, data: any) =>
    request<any>(`/api/pricing/price-list/item/${itemId}`, 'PUT', data),
  removePriceListItem: (itemId: string) =>
    request<any>(`/api/pricing/price-list/item/${itemId}`, 'DELETE'),

  // 促销
  listPromotions: (params: Record<string, any>) =>
    request<any>('/api/pricing/promotion', 'GET', null, params),
  getPromotion: (id: string) =>
    request<Promotion>(`/api/pricing/promotion/${id}`),
  createPromotion: (data: any) =>
    request<{ id: string }>('/api/pricing/promotion', 'POST', data),
  updatePromotion: (id: string, data: any) =>
    request<any>(`/api/pricing/promotion/${id}`, 'PUT', data),
  deletePromotion: (id: string) =>
    request<any>(`/api/pricing/promotion/${id}`, 'DELETE'),

  // 优惠券
  listCoupons: (params: Record<string, any>) =>
    request<any>('/api/pricing/coupon', 'GET', null, params),
  getCoupon: (id: string) => request<Coupon>(`/api/pricing/coupon/${id}`),
  createCoupon: (data: any) =>
    request<{ id: string }>('/api/pricing/coupon', 'POST', data),
  updateCoupon: (id: string, data: any) =>
    request<any>(`/api/pricing/coupon/${id}`, 'PUT', data),
  deleteCoupon: (id: string) =>
    request<any>(`/api/pricing/coupon/${id}`, 'DELETE'),

  // 计价解析
  resolve: (params: Record<string, any>) =>
    request<ResolvedPrice>('/api/pricing/resolve', 'GET', null, params),
};
