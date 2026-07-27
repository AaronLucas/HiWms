# DBA Addendum 请求 —— `fn_expire_task_claims` 缺少 pg_cron 定时注册（2026-07-28）

> **性质**：应用团队复核发现的运维缺口，不修改任何 `.sql` 文件——按项目约定，
> `.sql` 改动是 DBA 团队所有权范围，本文档只提出需求、给出证据，具体 DDL 由
> DBA 编写并按 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 自查。

## 问题

`fn_expire_task_claims()` 函数本身已经完整实现（负责竞争性任务租约到期清扫：
把过期的 `ACTIVE` 状态 `task_claims` 标记为 `EXPIRED`，并对尚未完成的工单登记
`TASK_CLAIM_EXPIRED` 异常），也已有并发测试覆盖
（`src/__tests__/integration/tasks/fn_claim_task.concurrency.test.ts`），函数内部
用 `UPDATE ... WHERE status = 'ACTIVE'` + `FOUND` 判断做了正确的乐观并发守卫，
可以安全地被多次/重叠调用。

但它**从未被注册为 `pg_cron` 定时任务**。现有已注册的 3 个 cron job
（`cross-dock-timeout-sweep`、`purge-old-action-logs`、`expire-stalled-sync-events`，
均为 `SECURITY INVOKER`，与 `fn_expire_task_claims` 权限模型一致）里没有它，
`docs/00-project/ROADMAP.md` 也已把这条记在案（"🟡 `fn_expire_task_claims` 未注册为
cron job"）。

**实际影响**：设备/PDA 抢占任务租约（`fn_claim_task`）之后，如果因为设备离线、
应用崩溃等原因既没有正常释放（`fn_release_task_claim`）也没有完成工单，这个租约
会**永久卡在 `ACTIVE`**——没有任何自动机制会把它清扫成 `EXPIRED` 并登记异常。
其他设备也就永远无法重新抢占同一个工单的任务（`fn_claim_task` 大概率会因为已存在
一个 `ACTIVE` 租约而拒绝新的抢占请求）。这不是理论风险：设备离线/崩溃在仓库现场是
常态场景，目前这条恢复路径完全不存在，只能靠人工介入排查+手动清理。

## 请求

参照现有 3 个 cron job 的注册模式（迁移 023 已经把 cron 注册从 ops-scripts 移入了
正式迁移，`purge-old-action-logs` 是先例），新增第 4 个 job：

```sql
SELECT cron.schedule(
  'expire-task-claims',
  '*/2 * * * *',  -- 每 2 分钟，具体间隔请 DBA 结合任务租约典型时长决定
  $$SELECT fn_expire_task_claims();$$
);
```

建议幂等注册（`cron.unschedule` 已存在同名 job 再 `cron.schedule`，与
`purge-old-action-logs` 迁移 023 的写法保持一致），并同步更新
`v_pg_cron_jobs` 监控视图涉及的 job 清单（如果该视图对 job 名单有硬编码而非
动态查询 `cron.job`）。

## 处理建议

单项、低风险、改动面极小（一条 `cron.schedule` 语句），可以合并进下一次常规
migration，不需要单独走 addendum 迁移流程。

**关联文档**：`docs/00-project/ROADMAP.md`「阶段 1.4」、
`docs/03-database/REPOSITORY_ROADMAP.md`「TaskClaimRepository」条目、
`docs/03-database/DB_OPS_SCRIPTS_ECC_ANALYSIS.md`（现有 3 个 cron job 的详细分析）。
