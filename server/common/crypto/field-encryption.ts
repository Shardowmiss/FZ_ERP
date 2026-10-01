import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

/**
 * 字段级加密基座（P0-2 会员 PII 加密）。
 *
 * 采用「可搜索加密」双列结构（以 member.phone 为模板落地）：
 *   · 密文列（phone）     —— AES-256-GCM，带 `enc::` 前缀，便于幂等回填与向后兼容识别。
 *   · HMAC 查询列（hmac） —— HMAC-SHA256(明文) 确定性指纹，用于按值搜索/去重/一致性校验，
 *                            避免对密文直接比较（随机 IV 使同明文每次加密结果不同），也避免泄露明文。
 *
 * 密钥：统一来自环境变量 FIELD_ENC_KEY（生产缺失/弱即 fail-fast，见 validateSecrets）。
 *   从主密钥派生两个相互独立的子密钥（加密 / HMAC），避免「同一密钥既加密又做 MAC」。
 *
 * 设计原则（anti-假绿）：
 *   · encryptField 对已是密文的值幂等返回（回填/重复调用安全）。
 *   · decryptField 对非空非密文的值原样返回（存量明文/过渡期兼容，不抛错）。
 *   · 全部仅依赖 Node 原生 crypto，无外部依赖，便于回填脚本直接复用编译产物。
 */

const PREFIX = 'enc::';
const IV_LEN = 12;
const TAG_LEN = 16;

// 本地开发兜底密钥（仅当 FIELD_ENC_KEY 完全未设置且非生产时使用；数据不可在 prod 解密）。
const DEV_KEY = 'dev-only-insecure-field-enc-key-0000000000000000000000';

type Keys = { aesKey: Buffer; hmacKey: Buffer };
let cachedKeys: Keys | null = null;

function deriveKeys(): Keys {
  if (cachedKeys) return cachedKeys;
  const raw = process.env.FIELD_ENC_KEY;
  const isProd = process.env.NODE_ENV === 'production';

  let master: Buffer;
  if (!raw || raw.trim().length === 0) {
    if (isProd) {
      throw new Error(
        '[field-encryption] 生产环境 FIELD_ENC_KEY 未配置：禁止启动（字段加密密钥缺失）。请在部署密钥管理中设置 >=32 字节的强随机密钥。',
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      '[field-encryption] 警告：未设置 FIELD_ENC_KEY，使用不安全的开发兜底密钥（仅限本地，禁止用于生产数据）。',
    );
    master = Buffer.from(DEV_KEY, 'utf8');
  } else {
    master = Buffer.from(raw, 'utf8');
    if (master.length < 32) {
      throw new Error(
        '[field-encryption] FIELD_ENC_KEY 强度不足：长度必须 >= 32 字节（256 位）。请使用强随机密钥（如 `openssl rand -hex 32`）。',
      );
    }
  }

  // 从主密钥派生两个独立子密钥（不同 info 标签 → 不同密钥）。
  const aesKey = createHmac('sha256', 'field-enc::v1::aes').update(master).digest();
  const hmacKey = createHmac('sha256', 'field-enc::v1::hmac').update(master).digest();
  cachedKeys = { aesKey, hmacKey };
  return cachedKeys;
}

/** 触发密钥加载与校验（供启动期 fail-fast 调用）。 */
export function loadKeys(): Keys {
  return deriveKeys();
}

/** 值是否已加密（enc:: 前缀）。 */
export function isEncrypted(value?: string | null): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** 明文规范化（当前：去空白；后续如需 E.164 统一在此扩展）。 */
function normalize(plain: string): string {
  return plain.trim();
}

/** 加密明文 → 密文（AES-256-GCM，base64(iv).base64(tag).base64(cipher)，前缀 enc::）。 */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null;
  const s = String(plain);
  if (isEncrypted(s)) return s; // 幂等：已是密文则不重复加密
  const { aesKey } = deriveKeys();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const enc = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/** 解密密文 → 明文；非密文（存量明文/空）原样返回（向后兼容）。 */
export function decryptField(cipher: string | null | undefined): string | null {
  if (cipher === null || cipher === undefined) return null;
  const s = String(cipher);
  if (!isEncrypted(s)) return s;
  const { aesKey } = deriveKeys();
  const parts = s.slice(PREFIX.length).split('.');
  if (parts.length !== 3) {
    throw new Error('[field-encryption] 密文格式非法（预期 enc::iv.tag.data）');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const data = Buffer.from(parts[2], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** 计算明文确定性 HMAC 指纹（用于搜索/去重/一致性校验）。 */
export function hmacField(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null;
  const s = String(plain);
  if (isEncrypted(s)) return null; // 异常二次调用：不对密文做 hmac，避免指纹错乱
  const { hmacKey } = deriveKeys();
  return createHmac('sha256', hmacKey).update(normalize(s)).digest('hex');
}
