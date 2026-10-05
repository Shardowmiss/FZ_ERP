-- W1-5 多租户隔离复核：平台运行角色 anon_ 权限面验证（只读，可重复运行）
--
-- 平台以 `SET ROLE anon_` 执行查询；新建 public 对象若漏授权会触发 42501。
-- 铁律#5 要求权限面：SCHEMA USAGE + 表 ALL DML + 序列 USAGE/SELECT + 自定义类型 USAGE
--                       + 两条 ALTER DEFAULT PRIVILEGES（保证迁移新建对象自动继承授权）。
--
-- 用法：  PGDATABASE=erp_db psql -h /tmp -p 5434 -U erp -v ON_ERROR_STOP=1 -f scripts/verify-anon-privileges.sql
-- 退出码：0 = 权限面完整；非 0 = 存在缺口（可在 CI/迁移后作为门禁）。
--
-- 注意：本脚本只读 catalog，不修改任何数据。

\echo '===== 0. anon_ 角色存在性 ====='
SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = 'anon_';

-- 收集缺口到临时表，供报告与门禁共用
DROP TABLE IF EXISTS _gap_report;
CREATE TEMP TABLE _gap_report (kind text, name text, missing text);

INSERT INTO _gap_report
-- 表：缺 SELECT/INSERT/UPDATE/DELETE 任一即 42501 风险
SELECT 'TABLE', c.relname,
       (CASE WHEN NOT has_table_privilege('anon_', c.oid,'SELECT') THEN 'noSELECT ' END ||
        CASE WHEN NOT has_table_privilege('anon_', c.oid,'INSERT') THEN 'noINSERT ' END ||
        CASE WHEN NOT has_table_privilege('anon_', c.oid,'UPDATE') THEN 'noUPDATE ' END ||
        CASE WHEN NOT has_table_privilege('anon_', c.oid,'DELETE') THEN 'noDELETE ' END)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND NOT (has_table_privilege('anon_',c.oid,'SELECT') AND has_table_privilege('anon_',c.oid,'INSERT')
           AND has_table_privilege('anon_',c.oid,'UPDATE') AND has_table_privilege('anon_',c.oid,'DELETE'))
UNION ALL
-- 序列：PG11+ 仅需 USAGE/SELECT（nextval/setval 不再需要 UPDATE），故只查 USAGE+SELECT
SELECT 'SEQ', c.relname,
       (CASE WHEN NOT has_sequence_privilege('anon_', c.oid,'USAGE') THEN 'noUSAGE ' END ||
        CASE WHEN NOT has_sequence_privilege('anon_', c.oid,'SELECT') THEN 'noSELECT ' END)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='S'
  AND NOT (has_sequence_privilege('anon_',c.oid,'USAGE') AND has_sequence_privilege('anon_',c.oid,'SELECT'))
UNION ALL
-- 自定义类型（枚举/复合/域）：缺 USAGE 即 42501
SELECT 'TYPE', t.typname,
       CASE WHEN NOT has_type_privilege('anon_', t.oid,'USAGE') THEN 'noUSAGE' END
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname='public' AND t.typtype IN ('e','c','d')
  AND t.typname NOT LIKE 'pg_%' AND t.typname NOT LIKE '_pg_%'
  AND NOT has_type_privilege('anon_', t.oid,'USAGE');

\echo '===== 1. schema USAGE ====='
SELECT has_schema_privilege('anon_','public','USAGE') AS public_usage;

\echo '===== 2. 缺口清单（空 = 无缺口）====='
SELECT kind, name, missing FROM _gap_report ORDER BY kind, name;

\echo '===== 3. 非 erp 所有的 public 表（会绕过 erp 的 DEFAULT PRIVILEGES）====='
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname='erp')
ORDER BY c.relname;

\echo '===== 4. ALTER DEFAULT PRIVILEGES（未来对象自动授权，复发防护）====='
SELECT defaclnamespace::regnamespace::text AS nsp,
       defaclrole::regrole::text            AS owner_role,
       defaclobjtype                        AS objtype,
       defaclacl
FROM pg_default_acl
WHERE defaclnamespace = 'public'::regnamespace
ORDER BY objtype;

\echo '===== 5. 判定 ====='
SELECT CASE
         WHEN (SELECT count(*) FROM _gap_report) = 0
          AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relkind='r'
                 AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname='erp')) = 0
          AND EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclobjtype='r' AND defaclnamespace='public'::regnamespace)
          AND EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclobjtype='S' AND defaclnamespace='public'::regnamespace)
         THEN 'PASS: anon_ 权限面完整，且 DEFAULT PRIVILEGES 已就位（未来对象自动授权）'
         ELSE 'FAIL: 存在权限缺口或 DEFAULT PRIVILEGES 缺失，见上方清单'
       END AS verdict;

-- 门禁：有缺口则非零退出，便于 CI / 迁移后校验
DO $$
DECLARE
  g int := (SELECT count(*) FROM _gap_report);
  o int := (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r'
              AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname='erp'));
BEGIN
  IF g > 0 OR o > 0 THEN
    RAISE EXCEPTION 'anon_ 权限缺口=% 行，非erp所有的表=% 行', g, o;
  END IF;
END $$;
