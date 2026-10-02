import { request } from './request';
import type {
  Member,
  MemberTag,
  MemberPoint,
  MemberProfile,
  CampaignResult,
} from '@shared/api.interface';

// ---- 会员合并（P0-3 切片 A；member:merge 授权）类型，与 server/modules/member/member-merge.service.ts 严格对齐 ----
export interface MemberMergeCandidate {
  id: string;
  memberNo: string;
  name: string;
  phoneMasked: string | null;
  points: number;
  /** 储值（单位=分） */
  storedValue: number;
  totalSpent: number;
  orderCount: number;
  level: string;
  status: string;
}

export interface MemberMergeCandidateGroup {
  phoneHmac: string | null;
  phoneMasked: string | null;
  members: MemberMergeCandidate[];
}

export interface MemberMergeResult {
  runId: string;
  survivorId: string;
  mergedCount: number;
  movedPoints: number;
  /** 转移的储值（单位=分） */
  movedStoredValue: number;
  movedTotalSpent: number;
  movedOrderCount: number;
  logs: { mergedId: string; logId: string }[];
}

/** 会员合并审计日志（与 server/database/schema.ts member_merge_log 严格对齐） */
export interface MemberMergeLog {
  id: string;
  runId: string;
  survivorId: string;
  mergedId: string;
  mergedMemberNo: string | null;
  mergedName: string | null;
  mergedPhoneHmac: string | null;
  /** 本行从被合并方转移到 survivor 的积分 */
  movedPoints: number;
  /** 转移的储值（单位=分，numeric 以字符串返回） */
  movedStoredValue: string;
  /** 转移的累计消费额（numeric 以字符串返回） */
  movedTotalSpent: string;
  /** 转移的订单数 */
  movedOrderCount: number;
  reason: string | null;
  operator: string | null;
  createdAt: string;
  reversedAt: string | null;
}

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

  // ---- 会员合并（P0-3 切片 A；member:merge 授权，独立于 member:manage） ----
  /** 合并候选预览：按手机号分组的重复会员（脱敏），供运营确认保留方 */
  mergeCandidates: (limit = 500) =>
    request<MemberMergeCandidateGroup[]>('/api/member/merge-candidates', 'GET', null, { limit }),
  /** 执行合并：survivorId 吸收 mergedIds（资金安全，单事务 + 账本事件 + 可回滚日志） */
  merge: (data: { survivorId: string; mergedIds: string[]; reason?: string }) =>
    request<MemberMergeResult>('/api/member/merge', 'POST', data),
  /** 回滚一次合并（按 merge_log.id）或整批（按 run_id，前缀 merge_） */
  reverseMerge: (id: string, body?: { runId?: string }) =>
    request<{ reversed: number }>(`/api/member/merge/${id}/reverse`, 'POST', body),
  /** 会员合并审计日志列表（按时间倒序）；reversed 可选 true/false/undefined（全部） */
  mergeLogs: (reversed?: boolean) =>
    request<MemberMergeLog[]>('/api/member/merge-logs', 'GET', null,
      reversed === undefined ? undefined : { reversed: reversed ? 'true' : 'false' }),
};
