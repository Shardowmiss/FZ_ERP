import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

import './request-interceptor';

export { baseApi } from './base';
export type {
  MergeEntityType,
  MergeCandidateKeyType,
  MergeCandidateMember,
  MergeCandidateGroup,
  MergeResult,
  MergeLog,
} from './base';
export { bomApi } from './bom';
export { purchaseApi } from './purchase';
export { salesApi } from './sales';
export { inventoryApi } from './inventory';
export { financeApi } from './finance';
export { systemApi } from './system';
export { tradeShowApi } from './trade-show';
export { retailApi } from './retail';
export { rbacApi } from './rbac';
export { reportApi } from './report';
export { garmentPurchaseApi, productionApi } from './production';
export { productApi } from './product';

export { request } from './request';

export function getLogger() {
  return logger;
}

export function getAxios() {
  return axiosForBackend;
}
