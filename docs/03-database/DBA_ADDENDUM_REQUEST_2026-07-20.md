# DBA Addendum 请求 —— 迁移 005-008 复核发现（2026-07-20）

> **性质**：应用团队对 DBA 交付的 `unWMS_Concurrency_Hardening_V1.sql`（005）/
> `unWMS_Zone_Location_Serial_Tracking_V1.sql`（007）/`unWMS_Storage_Management_V1.sql`（008）
> 三份迁移的复核记录，用 `ecc:database-reviewer` 独立分析并逐项在本地核实。
> **不修改任何 `.sql` 文件**——按项目约定，`.sql` 改动是 DBA 团队所有权范围，
> 本文档只提出需求、给出证据与复现方式，具体 DDL 由 DBA 编写并按
> `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 自查。
>
> 结论先说：006（跨租户归属修复）与 008 的两处已知坑（`auth.uid()` 间接引用、
> `format()` 精度占位符）已核实完整修复，不在下列请求范围内。007 的新表
> （`updated_at`/RLS）与序列号并发写入逻辑同样核实无误。以下 4 项是**新发现、
> 尚未被现有迁移覆盖**的问题。

---

## 1. CRITICAL：四个动作函数缺少 EXECUTE 权限收口，可绕过 dispatcher 复现重复处理

**对应迁移**：005（`fn_apply_pick_action`/`fn_apply_putaway_action`/`fn_apply_count_action`/`fn_apply_pack_action`）

**问题**：005 的安全模型假设 dispatcher `fn_apply_sync_event` 原子地把事件从 `PENDING`
claim 到 `PROCESSING`，因此移除了四个动作子函数内部各自的 `status = 'PENDING'` 复检。
但全仓库 `grep -rni "revoke|grant "` 对 `supabase/migrations/*.sql` 返回空——没有任何
地方收回过 Postgres 默认的 `EXECUTE` 权限。这四个函数在 `src/types/database.ts` 里
作为 `Database['public']['Functions']` 暴露，意味着任何持有 `authenticated`（甚至
`anon`）JWT 的客户端可以直接 `supabase.rpc('fn_apply_pick_action', {...})`。

应用层已经知道这条路径危险——`SupabaseSyncEventRepository.ts`（第 87-93 行）注释明确
写着"统一走 fn_apply_sync_event 分发入口，不直接调用 fn_apply_pick_action 等专用函数"，
但这只是应用层的约定，不是数据库强制边界。

**复现方式（供 DBA 复核）**：在本地一次性 Postgres 上，用一个已经是 `APPLIED` 状态的
`sync_events` 行的 `id`，直接调用 `fn_apply_pick_action(p_event_id := '<该 id>')`
（绕过 `fn_apply_sync_event`）。预期看到：函数无任何状态约束地重跑一次完整业务逻辑，
包括无条件的库存扣减——同一个事件被处理两次。

**请求的修复方向**（供参考，具体实现请 DBA 决定）：

```sql
REVOKE EXECUTE ON FUNCTION
  fn_apply_pick_action, fn_apply_putaway_action,
  fn_apply_count_action, fn_apply_pack_action
FROM PUBLIC, anon, authenticated;
```

建议同时作为纵深防御，在四个子函数内部回加一个轻量状态守卫（不依赖 `EXECUTE`
权限单独生效）：

```sql
IF v_event.status <> 'PROCESSING' THEN
  RETURN 'SKIPPED_NOT_PROCESSING';
END IF;
```

**按 PR 自查清单第 9 条的要求**：这类"发现一个漏洞模式要搜全代码库确认没有同款"的
排查，建议 DBA 顺带确认其他通过 `fn_apply_sync_event` 分发的函数（如未来新增的动作
类型）是否也需要同样的权限收口，避免同一模式在下一次扩展时重新出现。

---

## 2. HIGH：`zone_type` 级联触发器只覆盖 location→zone 方向，反向变更不会同步

**对应迁移**：007（`fn_trg_sync_location_zone_type`）

**问题**：现有触发器只在 `BEFORE INSERT OR UPDATE OF zone_id ON locations` 触发——
库位换绑库区时会正确同步 `zone_type`。但反过来：如果操作员之后修正了
`zones.zone_type` 本身（例如把某库区从 `AMBIENT` 重新分类为 `COLD`），**所有已经
挂在这个库区下的库位都不会跟着更新**，会永久按陈旧值缓存。

`locations.zone_type` 正是 `fn_trg_enforce_product_constraints`（001 迁移，第
1189-1192 行）读取来做冷链/危险品合规校验的字段——一次合理的库区重新分类，会让
合规检查在不知不觉中对着过期数据跑。

**复现方式**：创建一个 `zone_type = 'AMBIENT'` 的库区，挂一个库位；确认库位
`zone_type` 正确同步为 `AMBIENT`。然后 `UPDATE zones SET zone_type = 'COLD' WHERE id = ...`。
预期看到：该库位的 `zone_type` 仍是 `AMBIENT`，未跟随更新。

**请求的修复方向**：

```sql
CREATE OR REPLACE FUNCTION fn_trg_sync_zone_type_to_locations()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE locations
  SET zone_type = NEW.zone_type
  WHERE zone_id = NEW.id AND zone_type IS DISTINCT FROM NEW.zone_type;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_zones_sync_zone_type
AFTER UPDATE OF zone_type ON zones
FOR EACH ROW EXECUTE FUNCTION fn_trg_sync_zone_type_to_locations();
```

---

## 3. HIGH：两张新的 daily_summary 表缺少 `updated_at`，违反 DBA 自己的 PR 清单第 7 条

**对应迁移**：008（`wo_action_logs_daily_summary`、`inventory_history_daily_summary`）

**问题**：这两张表不是纯追加型日志表——`fn_archive_and_purge_wo_action_logs`/
`fn_archive_and_purge_inventory_history`（008 第 208-213、251-253 行）用
`ON CONFLICT (...) DO UPDATE SET action_count = table.action_count + EXCLUDED.action_count, ...`，
每次维护任务运行都会真实地原地更新已有汇总行。这正是
`unWMS_PR_Pre_Submission_Checklist_V1.md` 第 7 条点名的场景："新表如果会被
UPDATE（不是纯追加型日志表），必须加 updated_at 列 + 对应触发器"。

**请求的修复方向**：为两张表补 `updated_at TIMESTAMPTZ DEFAULT now()` 列 + 标准的
`updated_at` 触发器（与本项目其余可变表一致的写法）。

---

## 4. MEDIUM：`sync_events` 卡在 `PROCESSING` 状态缺少超时清扫

**对应迁移**：005（`sync_events` 状态机）

**问题**：如果处理进程在原子 claim（`PENDING → PROCESSING`）之后、动作子函数事务
提交之前崩溃（连接断开、进程被杀等），事件会永久卡在 `PROCESSING`，没有自动恢复
机制——不像同一迁移里的 `task_claims`/cross-dock 任务，那两个都拿到了专属的
`fn_expire_task_claims`/`fn_cross_dock_timeout_sweep` 清扫函数。当前唯一恢复路径
是应用层手动调用的 `retryEvent()`（`SupabaseSyncEventRepository.ts` 第 327 行），
没有证据显示有自动调用。

**请求的修复方向**：镜像现有清扫函数的模式，新增一个
`fn_expire_stalled_sync_events(p_timeout_interval INTERVAL DEFAULT '5 minutes')`，
把超过超时时间仍处于 `PROCESSING` 的事件重置回 `PENDING`（或直接标记为需要人工
介入的异常状态，具体选择请 DBA 结合 `fn_apply_sync_event` 的幂等性设计决定），
并建议挂到 `pg_cron`（参照 `unWMS_Setup_Cron_Jobs_V2.1.sql` 的既有模式）。

---

## 5. INFO（非阻塞，production 不受影响）：8 份迁移全部没有显式 GRANT 语句，CI 首次真机跑通时暴露

**背景**：本轮把迁移脚本接入 CI（`.github/workflows/db-integration.yml`，从零 `supabase start` 一个全新的本地 Postgres 沙盒并应用 001-008），第一次真实运行即失败：全部涉及数据库的测试都报
`permission denied for table tenants`。排查确认 `grep -c GRANT supabase/migrations/*.sql` 对全部 8 个文件返回 0——没有任何一处 `GRANT`/`ALTER DEFAULT PRIVILEGES` 语句。

**为什么 production 没事**：生产环境的 Supabase 项目是通过 Supabase 官方托管的
Dashboard/自动化 provisioning 流程创建的，这层默认会把 `anon`/`authenticated`/
`service_role` 的表级权限一并配置好；而在一个全新的、纯粹通过 `supabase start` +
`supabase db reset` 启动的本地/CI Postgres 沙盒里，这层托管侧的隐式配置不会被
复现——迁移脚本创建的表默认不会自动拿到这三个角色的权限。

**当前处理方式**：应用团队在 CI 里加了一个明确标注"仅供 CI 复现环境使用、非 DBA
迁移"的补充脚本（`scripts/ci-db-grants.sql`），在 `supabase db reset` 之后单独用
`psql` 执行，不改动 `supabase/migrations/` 任何文件。

**请 DBA 团队评估的方向性建议（非阻塞、无需立即处理）**：如果未来有自建/自托管
Postgres（而非 Supabase 托管）部署这套 schema 的场景，或者想让"从空库到可用"这个
过程不依赖 Supabase Dashboard 的隐式行为，可以考虑在迁移脚本末尾（或专门一个
`999_grants.sql`）显式补上等价的 GRANT 语句，让迁移本身自包含、不隐式依赖托管平台
的旁路配置。这不是本轮的阻塞项，只是 CI 集成过程中顺带发现，记录在案供参考。

---

## 处理建议

1-3 项建议作为一次 addendum 迁移（例如 `unWMS_Migration_Addendum_2026-07_V1.sql`）
一并提交，因为都是对已部署迁移的收尾修正，风险可控、改动面小。第 4 项优先级较低，
可以合并处理也可以单独排期。第 5 项仅供参考，不阻塞任何工作。

所有改动请按 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 逐条自查并附验证
证据。本文档不代为决定具体 DDL 写法，以上 SQL 片段仅为方向性参考。

**关联文档**：`docs/00-project/ROADMAP.md`「阶段 1.5」、
`docs/03-database/REPOSITORY_ROADMAP.md`「剩余缺口清单」、
`HiWmsSupabase` 仓库 README「当前已知待办」（与本文档保持同步）。
