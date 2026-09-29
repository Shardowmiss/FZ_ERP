import { Injectable } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

/**
 * 单号生成服务
 *
 * 并发安全：在事务内对目标表的最大单号行加 FOR UPDATE 行锁，
 * 确保同一前缀的单号生成不会出现并发重复。
 *
 * 使用方式：
 * 1. 在创建单据的事务回调中调用 generateNextNo
 * 2. 传入当前事务 tx、目标表、单号列、前缀和流水号位数
 * 3. 第二个并发请求会等待第一个事务提交后再读取，保证不重复
 */
@Injectable()
export class NumberGeneratorService {
  /**
   * 生成下一单号（需在事务内调用，利用 FOR UPDATE 行锁保证并发安全）
   *
   * @param tx 当前事务对象（从 db.transaction 回调中获取）
   * @param table 目标表（单号所在的业务表）
   * @param noColumn 单号列
   * @param prefix 单号前缀（如 'PO20260916'）
   * @param serialDigits 流水号位数，默认 4 位
   * @returns 生成的完整单号
   */
  async generateNextNo(
    tx: PostgresJsDatabase,
    table: PgTableWithColumns<any>,
    noColumn: PgColumn,
    prefix: string,
    serialDigits: number = 4,
  ): Promise<string> {
    // 空表竞态防护：当表中尚无该前缀的单号时，SELECT ... FOR UPDATE 无法锁住
    // 任何行，两个并发首单都会读到“空”并生成 seq=1，造成单号重复。
    // 这里在事务内对「前缀」加会话级 advisory 锁，使同一前缀的单号生成串行化。
    const lockKey = `ng:${prefix}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const result = await tx
      .select({ no: noColumn })
      .from(table)
      .where(sql`${noColumn} like ${prefix + '%'}`)
      .orderBy(desc(noColumn))
      .limit(1)
      .for('update');

    let seq = 1;
    if (result.length > 0 && result[0].no) {
      const lastNo: string = String(result[0].no);
      const seqStr = lastNo.slice(prefix.length);
      const parsed = parseInt(seqStr, 10);
      if (!isNaN(parsed)) {
        seq = parsed + 1;
      }
    }

    return `${prefix}${seq.toString().padStart(serialDigits, '0')}`;
  }
}
