/* ------------------------------------------------------------------ *
 * 吊牌模板 API（复用后端已有 CRUD，无需新增后端接口）
 *
 * 后端路由前缀 /api/hangtag：
 *   GET    /templates          模板列表
 *   POST   /templates          新建模板
 *   GET    /templates/:id      模板详情
 *   PUT    /templates/:id      更新模板
 *   DELETE /templates/:id      删除模板
 * ------------------------------------------------------------------ */
import { request } from './request';
import type {
  HangtagTemplateFull,
  HangtagContentConfig,
  HangtagStyleConfig,
} from '@client/src/components/hangtag/types';

/** 新建/更新模板入参 */
export interface HangtagTemplateInput {
  code: string;
  name: string;
  contentConfig?: HangtagContentConfig;
  styleConfig?: HangtagStyleConfig;
  isDefault?: boolean;
  status?: string;
  remark?: string;
}

export const hangtagApi = {
  /** 模板列表（含 contentConfig / styleConfig） */
  listTemplates: () =>
    request<HangtagTemplateFull[]>('/api/hangtag/templates', 'GET'),

  /** 模板详情 */
  getTemplate: (id: string) =>
    request<HangtagTemplateFull>(`/api/hangtag/templates/${id}`, 'GET'),

  /** 新建模板 */
  createTemplate: (input: HangtagTemplateInput) =>
    request<HangtagTemplateFull>('/api/hangtag/templates', 'POST', input),

  /** 更新模板 */
  updateTemplate: (id: string, patch: Partial<HangtagTemplateInput>) =>
    request<HangtagTemplateFull>(`/api/hangtag/templates/${id}`, 'PUT', patch),

  /** 删除模板 */
  deleteTemplate: (id: string) =>
    request<{ deleted: boolean; id: string }>(`/api/hangtag/templates/${id}`, 'DELETE'),
};
