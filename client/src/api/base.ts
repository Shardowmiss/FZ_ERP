import { request } from './request';
import type {
  PaginationParams, PaginationResult,
  Style, Sku, ColorGroup, SizeGroup,
  Material, Customer, Supplier, Warehouse,
  Dealer, Store,
  StyleCreateAutoRequest,
} from '@shared/api.interface';

export const baseApi = {
  colorGroup: {
    list: (params: PaginationParams & { keyword?: string }) =>
      request<PaginationResult<ColorGroup>>('/api/base/color-group', 'GET', null, params),
    get: (id: string) => request<ColorGroup>(`/api/base/color-group/${id}`),
    create: (data: Partial<ColorGroup>) => request<ColorGroup>('/api/base/color-group', 'POST', data),
    update: (id: string, data: Partial<ColorGroup>) =>
      request<ColorGroup>(`/api/base/color-group/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/color-group/${id}`, 'DELETE'),

  },
  sizeGroup: {
    list: (params: PaginationParams & { keyword?: string }) =>
      request<PaginationResult<SizeGroup>>('/api/base/size-group', 'GET', null, params),
    get: (id: string) => request<SizeGroup>(`/api/base/size-group/${id}`),
    create: (data: Partial<SizeGroup>) => request<SizeGroup>('/api/base/size-group', 'POST', data),
    update: (id: string, data: Partial<SizeGroup>) =>
      request<SizeGroup>(`/api/base/size-group/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/size-group/${id}`, 'DELETE'),

  },
  style: {
    list: (params: PaginationParams & { keyword?: string; category?: string; status?: string; brand?: string }) =>
      request<PaginationResult<Style>>('/api/base/style', 'GET', null, params),
    get: (id: string) => request<Style & { skus: Sku[] }>(`/api/base/style/${id}`),
    create: (data: Partial<Style>) => request<Style>('/api/base/style', 'POST', data),
    update: (id: string, data: Partial<Style>) =>
      request<Style>(`/api/base/style/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/style/${id}`, 'DELETE'),

    options: () => request<{ id: string; styleNo: string; name: string }[]>('/api/base/style/options'),
    createAuto: (data: StyleCreateAutoRequest) =>
      request<Style & { skus: Sku[] }>('/api/base/style/auto', 'POST', data),
  },
  sku: {
    list: (params: PaginationParams & { styleId?: string; keyword?: string; color?: string; size?: string }) =>
      request<PaginationResult<Sku>>('/api/base/sku', 'GET', null, params),
    get: (id: string) => request<Sku>(`/api/base/sku/${id}`),
    update: (id: string, data: Partial<Sku>) =>
      request<Sku>(`/api/base/sku/${id}`, 'PUT', data),
    byStyle: (styleId: string) => request<Sku[]>(`/api/base/sku/by-style/${styleId}`),
  },
  material: {
    list: (params: PaginationParams & { keyword?: string; category?: string; status?: string }) =>
      request<PaginationResult<Material>>('/api/base/material', 'GET', null, params),
    get: (id: string) => request<Material>(`/api/base/material/${id}`),
    create: (data: Partial<Material>) => request<Material>('/api/base/material', 'POST', data),
    update: (id: string, data: Partial<Material>) =>
      request<Material>(`/api/base/material/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/material/${id}`, 'DELETE'),

    options: () => request<{ id: string; code: string; name: string; unit: string }[]>('/api/base/material/options'),
  },
  customer: {
    list: (params: PaginationParams & { keyword?: string; status?: string }) =>
      request<PaginationResult<Customer>>('/api/base/customer', 'GET', null, params),
    get: (id: string) => request<Customer>(`/api/base/customer/${id}`),
    create: (data: Partial<Customer>) => request<Customer>('/api/base/customer', 'POST', data),
    update: (id: string, data: Partial<Customer>) =>
      request<Customer>(`/api/base/customer/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/customer/${id}`, 'DELETE'),

    options: () => request<{ id: string; code: string; name: string }[]>('/api/base/customer/options'),
  },
  supplier: {
    list: (params: PaginationParams & { keyword?: string; status?: string }) =>
      request<PaginationResult<Supplier>>('/api/base/supplier', 'GET', null, params),
    get: (id: string) => request<Supplier>(`/api/base/supplier/${id}`),
    create: (data: Partial<Supplier>) => request<Supplier>('/api/base/supplier', 'POST', data),
    update: (id: string, data: Partial<Supplier>) =>
      request<Supplier>(`/api/base/supplier/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/supplier/${id}`, 'DELETE'),

    options: () => request<{ id: string; code: string; name: string }[]>('/api/base/supplier/options'),
  },
  warehouse: {
    list: (params: PaginationParams & { keyword?: string; type?: string; status?: string }) =>
      request<PaginationResult<Warehouse>>('/api/base/warehouse', 'GET', null, params),
    get: (id: string) => request<Warehouse>(`/api/base/warehouse/${id}`),
    create: (data: Partial<Warehouse>) => request<Warehouse>('/api/base/warehouse', 'POST', data),
    update: (id: string, data: Partial<Warehouse>) =>
      request<Warehouse>(`/api/base/warehouse/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/warehouse/${id}`, 'DELETE'),

    options: () => request<{ id: string; code: string; name: string; type: string }[]>('/api/base/warehouse/options'),
  },
  dealer: {
    list: (params: PaginationParams & { keyword?: string; status?: string }) =>
      request<PaginationResult<Dealer>>('/api/base/dealer', 'GET', null, params),
    get: (id: string) => request<Dealer>(`/api/base/dealer/${id}`),
    create: (data: Partial<Dealer>) => request<Dealer>('/api/base/dealer', 'POST', data),
    update: (id: string, data: Partial<Dealer>) =>
      request<Dealer>(`/api/base/dealer/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/dealer/${id}`, 'DELETE'),

    options: () => request<{ id: string; code: string; name: string }[]>('/api/base/dealer/options'),
  },
  store: {
    list: (params: PaginationParams & { keyword?: string; storeType?: string; status?: string }) =>
      request<PaginationResult<Store>>('/api/base/store', 'GET', null, params),
    get: (id: string) => request<Store>(`/api/base/store/${id}`),
    create: (data: Partial<Store>) => request<Store>('/api/base/store', 'POST', data),
    update: (id: string, data: Partial<Store>) =>
      request<Store>(`/api/base/store/${id}`, 'PUT', data),
    remove: (id: string) => request<void>(`/api/base/store/${id}`, 'DELETE'),

    options: () =>
      request<{ id: string; code: string; name: string; storeType: string; dealerId?: string; warehouseId?: string }[]>('/api/base/store/options'),
  },
  styleAttribute: {
    list: (params: { attrType: string; keyword?: string; page?: number; pageSize?: number }) =>
      request<PaginationResult<StyleAttribute>>('/api/base/style-attribute', 'GET', null, params),
    getAll: (attrType: string, onlyActive?: boolean) =>
      request<StyleAttribute[]>('/api/base/style-attribute/all', 'GET', null, { attrType, onlyActive }),
    getSubCategories: (parentCode: string, onlyActive?: boolean) =>
      request<StyleAttribute[]>('/api/base/style-attribute/sub-categories', 'GET', null, { parentCode, onlyActive }),
    create: (data: Partial<StyleAttribute>) =>
      request<StyleAttribute>('/api/base/style-attribute', 'POST', data),
    update: (id: string, data: Partial<StyleAttribute>) =>
      request<StyleAttribute>(`/api/base/style-attribute/${id}`, 'PUT', data),
    remove: (id: string) =>
      request<{ success: boolean; disabled?: boolean; message?: string }>(`/api/base/style-attribute/${id}`, 'DELETE'),
    batchStatus: (ids: string[], status: string) =>
      request<void>('/api/base/style-attribute/batch-status', 'POST', { ids, status }),
  },
  styleAttrDef: {
    list: (onlyActive?: boolean) =>
      request<StyleAttrDef[]>('/api/base/style-attr-def', 'GET', null, { onlyActive }),
    listWithValues: (onlyActive?: boolean) =>
      request<StyleAttrDef[]>('/api/base/style-attr-def/with-values', 'GET', null, { onlyActive }),
    detail: (id: string) =>
      request<StyleAttrDef>(`/api/base/style-attr-def/${id}`, 'GET'),
    create: (data: Partial<StyleAttrDef>) =>
      request<StyleAttrDef>('/api/base/style-attr-def', 'POST', data),
    update: (id: string, data: Partial<StyleAttrDef>) =>
      request<StyleAttrDef>(`/api/base/style-attr-def/${id}`, 'PUT', data),
    reorder: (items: Array<{ id: string; sortOrder: number }>) =>
      request<{ success: boolean }>('/api/base/style-attr-def/reorder', 'POST', { items }),
    remove: (id: string) =>
      request<{ success: boolean; disabled?: boolean; message?: string }>(`/api/base/style-attr-def/${id}`, 'DELETE'),
    listValues: (id: string, onlyActive?: boolean) =>
      request<StyleAttrValue[]>(`/api/base/style-attr-def/${id}/values`, 'GET', null, { onlyActive }),
    createValue: (id: string, data: Partial<StyleAttrValue>) =>
      request<StyleAttrValue>(`/api/base/style-attr-def/${id}/values`, 'POST', data),
    updateValue: (valueId: string, data: Partial<StyleAttrValue>) =>
      request<StyleAttrValue>(`/api/base/style-attr-def/values/${valueId}`, 'PUT', data),
    reorderValues: (attrDefId: string, items: Array<{ id: string; sortOrder: number }>) =>
      request<{ success: boolean }>(`/api/base/style-attr-def/${attrDefId}/values/reorder`, 'POST', { items }),
    removeValue: (valueId: string) =>
      request<{ success: boolean; disabled?: boolean; message?: string }>(`/api/base/style-attr-def/values/${valueId}`, 'DELETE'),
  },
};

export interface StyleAttribute {
  id: string;
  attrType: string;
  attrCode: string;
  attrName: string;
  sortOrder: number;
  status: string;
  parentCode?: string;
  parentName?: string;
  remark?: string;
  createdAt: string;
}

export interface StyleAttrDef {
  id: string;
  attrCode: string;
  attrName: string;
  sortOrder: number;
  status: string;
  remark?: string;
  createdAt: string;
  values?: StyleAttrValue[];
}

export interface StyleAttrValue {
  id: string;
  attrDefId: string;
  valueCode: string;
  valueName: string;
  sortOrder: number;
  status: string;
  remark?: string;
  createdAt: string;
}
