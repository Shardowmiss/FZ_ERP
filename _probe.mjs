import { PGlite } from '@electric-sql/pglite';
const pg = await PGlite.create();
async function trySql(label, sql) {
  try { await pg.exec(sql); console.log('OK  ', label); }
  catch (e) { console.log('FAIL', label, '->', e.message); }
}
await trySql('CREATE TYPE IF NOT EXISTS', `CREATE TYPE IF NOT EXISTS user_profile AS (user_id text);`);
await trySql('CREATE TYPE no-IF', `CREATE TYPE user_profile2 AS (user_id text);`);
await trySql('CREATE TABLE IF NOT EXISTS', `CREATE TABLE IF NOT EXISTS t1 (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), a timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, b user_profile DEFAULT NULL);`);
await trySql('array col', `CREATE TABLE IF NOT EXISTS t2 (c varchar(50)[] NOT NULL DEFAULT '{}');`);
await pg.close();
