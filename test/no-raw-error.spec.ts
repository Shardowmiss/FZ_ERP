import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 回归护栏：禁止在 server 业务代码中再出现裸 `throw new Error(...)`。
 * 这类异常会被 GlobalExceptionFilter 兜底成 500「服务器内部错误」且原始中文
 * 文案被丢弃，业务人员误以为系统故障、运维也无法定位。应改用 Nest 的
 * HttpException（NotFoundException / BadRequestException 等），让具体文案与
 * 正确的状态码透传给前端。
 *
 * 白名单：
 *   · database/schema.ts 是 drizzle 自动生成、标注「do not edit」的自定义列类型
 *     转换错误，不在请求处理路径上，属内部校验错误，保持原状。
 *   · common/crypto/field-encryption.ts / common/crypto/secret-validation.ts 是
 *     启动期密钥校验 guard（FIELD_ENC_KEY 缺失/弱即 fail-fast 中止启动），不在请求
 *     处理路径上，裸 throw 是其有意设计（绝不能降级为 500 兜底）。
 */
// vitest 从项目根目录运行，直接用 cwd 定位 server 目录（避免 import.meta 在 test tsconfig 下报错）
const SERVER_ROOT = join(process.cwd(), 'server');
const WHITELIST = new Set([
  'database/schema.ts',
  'common/crypto/field-encryption.ts',
  'common/crypto/secret-validation.ts',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('no raw `throw new Error(` in server business code', () => {
  const files = walk(SERVER_ROOT).map((f) => f.replace(SERVER_ROOT + '/', ''));
  const offenders = files
    .filter((f) => !WHITELIST.has(f))
    .filter((f) => {
      const src = readFileSync(join(SERVER_ROOT, f), 'utf-8');
      return /throw\s+new\s+Error\s*\(/.test(src);
    });

  it('server 业务代码中不应残留裸 throw new Error（白名单除外）', () => {
    expect(offenders, `发现裸 throw new Error: ${offenders.join(', ')}`).toEqual([]);
  });

  it('白名单 database/schema.ts 仍可保留裸 Error（自定义列类型转换）', () => {
    const src = readFileSync(join(SERVER_ROOT, 'database/schema.ts'), 'utf-8');
    expect(/throw\s+new\s+Error\s*\(/.test(src)).toBe(true);
  });
});
