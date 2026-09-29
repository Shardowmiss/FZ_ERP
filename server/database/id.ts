import { randomBytes } from 'node:crypto';

/**
 * 自包含 ULID 实现（Crockford base32，零第三方依赖）。
 *
 * 设计取舍：
 * - 单据号此前用 `Date.now() + Math.random()` 拼后缀，高并发同毫秒 + 同随机数会碰撞，
 *   仅靠唯一索引兜底（命中即抛错）。ULID 用 80-bit 随机，碰撞概率 ~1/2^80，
 *   同时首 10 字符为毫秒时间（base32 大端），整串可字典序排序，便于对账与分页。
 * - 不引入 `ulid`/`nanoid` 依赖，避免私有仓库装包风险，与"零成本解耦"原则一致。
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RAND_LEN = 16;

function encodeTime(now: number, len: number): string {
  let str = '';
  let value = Math.floor(now);
  for (let i = 0; i < len; i++) {
    const mod = value % ENCODING_LEN;
    str = ENCODING[mod] + str;
    value = Math.floor(value / ENCODING_LEN);
  }
  return str;
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(Math.ceil((len * 5) / 8)); // 16 * 5bit = 80bit => 10 bytes
  let str = '';
  for (let i = 0; i < len; i++) {
    const bitOffset = i * 5;
    const byteIdx = bitOffset >> 3;
    const shift = bitOffset & 7;
    let value = bytes[byteIdx] >> shift;
    if (shift > 3) {
      value |= bytes[byteIdx + 1] << (8 - shift);
    }
    str += ENCODING[value & 0x1f];
  }
  return str;
}

/**
 * 生成 ULID。time 部分按毫秒时间可排序；随机部分 80-bit，碰撞可忽略。
 * @param seedTime 可选时间戳（毫秒），默认 Date.now()，测试时可注入以验证时间编码。
 */
export function ulid(seedTime: number = Date.now()): string {
  return encodeTime(seedTime, TIME_LEN) + encodeRandom(RAND_LEN);
}

/**
 * 生成带业务前缀的单号。长度 = prefix.length + 26，所有单号列均为 varchar(50)，安全。
 * 例：generateDocNo('RT') => 'RT01ARZ3...'（26 位 ULID 后缀）
 */
export function generateDocNo(prefix: string): string {
  return `${prefix}${ulid()}`;
}
