import { loadKeys } from './field-encryption';

/**
 * 启动期密钥/密钥式配置校验（fail-fast）。
 *
 * - 触发字段加密密钥加载：生产缺失/弱即抛错中止启动（绝不降级到不安全兜底）。
 * - 校验其他生产必需密钥式配置是否齐备（机器对机器令牌、CSRF 签名密钥等）。
 *
 * 在 ERP bootstrap 早期调用，确保「缺密钥就不启动」，而非带着不安全配置跑起来。
 */
export function validateSecrets(): void {
  // 内部已对生产环境 FIELD_ENC_KEY 缺失/弱做 throw
  loadKeys();

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    const required = ['ERP_UPSTREAM_TOKEN', 'ERP_CSRF_SIGNING_SECRET'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
      throw new Error(
        `[validateSecrets] 生产环境缺失必要密钥式配置：${missing.join(
          ', ',
        )}（请在部署环境变量/密钥管理中配置）`,
      );
    }
  }
}
