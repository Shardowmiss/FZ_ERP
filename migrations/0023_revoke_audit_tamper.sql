-- 0023 审计日志防篡改（等保三级：审计记录须防篡改、防删除）
--
-- 背景：system_operation_log 由全局 AuditInterceptor 异步落库，应用以 anon_ 角色
--       执行查询。此前 anon_ 对该表拥有 DELETE/UPDATE/TRUNCATE（来自平台/迁移的
--       宽泛 GRANT ALL），意味着任何能触及 anon_ 的链路都可抹除审计轨迹，不满足
--       等保「审计记录应受到保护，避免被意外删除、修改或覆盖」的要求。
--
-- 设计：审计表的写语义是**仅追加（append-only）**——OperationLogService 只 INSERT
--       （create）与 SELECT（list 分页），没有任何业务路径 UPDATE/DELETE 该表
--       （已 grep 确认：server 内无 systemOperationLog.delete/update 调用）。
--       因此可安全回收 anon_ 的 DELETE/UPDATE/TRUNCATE，仅保留 INSERT/SELECT，
--       使审计轨迹不可被应用角色篡改。
--
-- 例外：若未来需要审计日志留存清理（retention），必须由独立的高权限角色/定时任务
--       执行，不得使用 anon_；届时在本迁移之外另行授权，避免重新放开 anon_ 写权限。
--
-- ⚠ 幂等：REVOKE 重复执行是 no-op（仅 NOTICE），整脚本可安全重跑。

REVOKE DELETE, UPDATE, TRUNCATE ON system_operation_log FROM anon_;
