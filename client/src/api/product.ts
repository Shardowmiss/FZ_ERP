import { request } from './request';
import type {
  StyleBarcodeConfigDto,
  StyleBarcodeConfigSaveRequest,
  StyleBarcodeDto,
  StyleBarcodeGenerateRequest,
  StyleBarcodeGenerateResult,
} from '@shared/api.interface';

// 商品资料域 API（条形码管理等）
export const productApi = {
  barcodeConfig: {
    getByStyle: (styleId: string) =>
      request<{ config: StyleBarcodeConfigDto | null; barcodes: StyleBarcodeDto[] }>(
        '/api/product/barcode-config', 'GET', null, { styleId },
      ),
    save: (data: StyleBarcodeConfigSaveRequest) =>
      request<StyleBarcodeConfigDto>('/api/product/barcode-config', 'POST', data),
    generate: (data: StyleBarcodeGenerateRequest) =>
      request<StyleBarcodeGenerateResult>('/api/product/barcode-config/generate', 'POST', data),
  },
};
