import { request } from './request';
import type {
  CodeRule,
  CodeMappingConfig,
  StyleCodePreviewRequest,
  StyleCodePreviewResult,
  BrandCode,
  OperationLog,
  PaginationParams,
  PaginationResult,
  SystemConfig,
} from '@shared/api.interface';

export const systemApi = {
  codeRule: {
    getDefaultRule: () =>
      request<CodeRule>('/api/system/code-rule', 'GET'),
    saveRule: (data: CodeRule) =>
      request<CodeRule>('/api/system/code-rule', 'POST', data),
    getMapping: () =>
      request<CodeMappingConfig>('/api/system/code-rule/mapping', 'GET'),
    saveMapping: (data: CodeMappingConfig) =>
      request<CodeMappingConfig>('/api/system/code-rule/mapping', 'POST', data),
    previewStyleCode: (data: StyleCodePreviewRequest) =>
      request<StyleCodePreviewResult>('/api/system/code-rule/preview', 'POST', data),
    getBrandOptions: () =>
      request<BrandCode[]>('/api/system/code-rule/brand-options', 'GET'),
  },
  operationLog: {
    list: (params: PaginationParams & {
      module?: string;
      operationType?: string;
      userId?: string;
      startDate?: string;
      endDate?: string;
      keyword?: string;
    }) =>
      request<PaginationResult<OperationLog>>(
        '/api/system/operation-log', 'GET', null, params),
  },
  config: {
    get: () => request<SystemConfig>('/api/system/config', 'GET'),
    update: (data: Partial<SystemConfig>) =>
      request<SystemConfig>('/api/system/config', 'PATCH', data),
  },
};
