import { request } from './request';
import type { MemberLevel, PaginationResult } from '@shared/api.interface';

export const memberLevelApi = {
  list: (
    page = 1,
    pageSize = 20,
    keyword?: string,
    conditionType?: string,
    status?: string,
  ) =>
    request<PaginationResult<MemberLevel>>('/api/member-level', 'GET', null, {
      page,
      pageSize,
      keyword,
      conditionType,
      status,
    }),
  options: () =>
    request<{ code: string; name: string }[]>('/api/member-level/options'),
  create: (data: Partial<MemberLevel>) =>
    request<MemberLevel>('/api/member-level', 'POST', data),
  update: (id: string, data: Partial<MemberLevel>) =>
    request<MemberLevel>(`/api/member-level/${id}`, 'PUT', data),
  remove: (id: string) =>
    request<void>(`/api/member-level/${id}`, 'DELETE'),
};
