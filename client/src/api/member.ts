import { request } from './request';
import type {
  Member,
  MemberTag,
  MemberPoint,
  MemberProfile,
  CampaignResult,
} from '@shared/api.interface';

export const memberApi = {
  list: (page = 1, pageSize = 20, keyword?: string, level?: string) =>
    request<{ list: Member[]; total: number }>('/api/member/list', 'GET', null, {
      page,
      pageSize,
      keyword,
      level,
    }),
  create: (body: Partial<Member>) =>
    request<Member>('/api/member/create', 'POST', body),
  update: (body: Partial<Member>) =>
    request<Member>('/api/member/update', 'POST', body),
  adjustPoints: (memberId: string, changeType: string, changeValue: number, remark?: string) =>
    request<MemberPoint>('/api/member/points', 'POST', {
      memberId,
      changeType,
      changeValue,
      remark,
    }),
  tags: () => request<MemberTag[]>('/api/member/tags'),
  createTag: (name: string, remark?: string) =>
    request<MemberTag>('/api/member/tags', 'POST', { name, remark }),
  profile: (id: string) =>
    request<MemberProfile>(`/api/member/profile/${id}`),
  campaign: (tagId: string, title: string, content?: string) =>
    request<CampaignResult>('/api/member/campaign', 'POST', {
      tagId,
      title,
      content,
    }),
};
