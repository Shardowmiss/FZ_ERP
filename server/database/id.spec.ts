import { describe, it, expect } from 'vitest';
import { ulid, generateDocNo } from './id';

const ULID_RE = /^[0-9A-Z]{26}$/;

describe('ulid（单据号后缀，P3-12）', () => {
  it('默认生成 26 位 Crockford base32 字符', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(ULID_RE);
  });

  it('seedTime=0 时时间前缀为 10 个 0', () => {
    expect(ulid(0).startsWith('0000000000')).toBe(true);
  });

  it('时间前缀随毫秒单调递增（字典序可排序）', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
  });

  it('20000 次生成零碰撞（碰撞概率 ~1/2^80）', () => {
    const set = new Set<string>();
    for (let i = 0; i < 20000; i++) set.add(ulid());
    expect(set.size).toBe(20000);
  });
});

describe('generateDocNo', () => {
  it('带业务前缀，总长度 = prefix.length + 26', () => {
    const no = generateDocNo('RT');
    expect(no.startsWith('RT')).toBe(true);
    expect(no).toHaveLength('RT'.length + 26);
    expect(no).toMatch(/^RT[0-9A-Z]{26}$/);
  });

  it('不同前缀生成不同单号', () => {
    expect(generateDocNo('SO')).not.toBe(generateDocNo('RT'));
  });

  it('空前缀时退化为纯 ULID', () => {
    expect(generateDocNo('')).toHaveLength(26);
  });
});
