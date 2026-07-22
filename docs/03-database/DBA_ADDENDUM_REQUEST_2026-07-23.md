# DBA Addendum 请求（第二轮）—— 迁移 009-016 复核发现（2026-07-23）

> **性质**：应用团队对 DBA 团队合并到 `HiWmsSupabase` `main` 分支的迁移 009-016
> （`unWMS_Migration_Addendum_2026_07_V1.sql` 起，至
> `unWMS_FastFollow_Indexes_And_Recount_Guard_V1.sql` 止）的复核记录。
> **只读复核**——本文档不修改、不触碰 `HiWmsSupabase` 仓库任何文件（该仓库由 DBA
> 团队独立维护，应用团队只有读取访问权限）。本文档只提出需求、给出证据与复现方式，
> 具体 DDL 由 DBA 团队编写并按其自有的
> `design-docs/unWMS_PR_Pre_Submission_Checklist_V1.md` 自查。
>
> 本文档是 [DBA_ADDENDUM_REQUEST_2026-07-20.md](./DBA_ADDENDUM_REQUEST_2026-07-20.md)
> 的续篇——该文档提出的 5 项发现中，4 项已由 009/010/015/016 修复（含 1 项修复过程中
> 反复发现更深层同类问题，详见下方「上一轮追踪」），1 项（INFO，GRANT 缺失）仍按
> 原文档结论保持非阻塞、暂不处理。

---

## 上一轮追踪：DBA_ADDENDUM_REQUEST_2026-07-20 五项发现的处置结果

| # | 原发现 | 处置结果 |
|---|------|---------|
| 1 | CRITICAL：4 个动作函数缺 EXECUTE 收口 | **历时 4 个迁移才完全收口**：009 REVOKE 后意外拖垮 dispatcher 自身调用链（010 修复，改 SECURITY DEFINER）；015 发现还有更底层的 3 个库存写入原语从未被 009 覆盖，一并收口；016 追加防御性状态守卫。详见下方「新发现 1」——这个模式本身还没有被认为彻底关闭 |
| 2 | HIGH：`zone_type` 级联单向 | ✅ 009 已按建议方向修复（新增 `AFTER UPDATE OF zone_type ON zones` 触发器） |
| 3 | HIGH：两张 daily_summary 表缺 `updated_at` | ✅ 009 已修复（补列 + 触发器） |
| 4 | MEDIUM：`sync_events` 卡 PROCESSING 无清扫 | ⚠️ **部分处置**：009 新增了 `fn_expire_stalled_sync_events`，但设计文档只是"建议"挂 `pg_cron`，本次复核未在 `ops-scripts/` 找到对应的 `cron.schedule` 注册。详见下方「新发现 3」 |
| 5 | INFO：全仓库无显式 GRANT | 保持原结论不变，非阻塞，不要求本轮处理。详见下方「新发现 2」给出的正式化建议 |

**关联**：[HiWmsSupabase#1](https://github.com/AaronLucas/HiWmsSupabase/issues/1) 目前仍是 OPEN 状态——建议 DBA 团队根据上表结论更新该 issue（4/5 已关闭，1 项非阻塞保留），避免看起来像是"整批未处理"。这一步需要 DBA 团队在自己仓库操作，应用团队不代为编辑。

---

## 新发现 1（延续原 CRITICAL 项）：`fn_resolve_exception` 信任调用方传入的 `p_resolver_user_id`，存在越权冒用可能

**对应迁移**：005（`fn_resolve_exception` 首次引入）， 未被 009/010/013/015/016 任一版本修正

**问题**：015 的设计文档自己指出了这一点（"P0.9 同类风险，需要单独评估"），但截至 016 仍未修复。`fn_resolve_exception(p_resolver_user_id UUID, ...)` 把"谁解决了这个异常"作为**调用方直接传入的参数**，而不是从会话身份（例如 `auth.uid()` 或已有的 `fn_current_tenant_id()` 同类模式）推导。这与 013 修复的 `check_user_permission` 跨租户信息泄露是**同一类漏洞模式**——"SECURITY DEFINER 函数信任调用方自称的身份，而不是校验会话真实身份"。按 DBA 团队自己 PR 清单第 9 条（"发现一种漏洞模式要全仓库排查同类"），013 修复时理应连带排查到这处。

**复现方式（供 DBA 复核）**：以租户 A 的 `authenticated` 身份登录，调用
`fn_resolve_exception(p_exception_id := '<租户A的某个异常>', p_resolver_user_id := '<租户B某用户的UUID>', ...)`。
预期看到：异常的解决人字段/审计轨迹记录成了租户 B 的用户，而实际操作者是租户 A 的会话——审计链条被污染，且理论上如果异常解决逻辑里有基于 `p_resolver_user_id` 的权限分支（例如"只有主管角色能解决 COMPLIANCE 类异常"），可以被伪造身份绕过。

**请求的修复方向**（参考 013 的既有模式）：

```sql
-- 013 已建立的模式：不信任参数，从会话推导
v_actual_user_id := auth.uid();  -- 或本项目已有的等价会话身份获取方式
IF p_resolver_user_id IS DISTINCT FROM v_actual_user_id THEN
  RAISE EXCEPTION 'p_resolver_user_id 必须与当前会话身份一致';
END IF;
```

或直接移除 `p_resolver_user_id` 参数，函数内部自行从会话推导，不再接受调用方传入——具体取舍请 DBA 团队结合应用层调用方式决定。

**补充（2026-07-23，应用层已修复）**：进一步核实发现这不只是理论风险——
`fn_resolve_exception` 虽然没有直接对应的 HTTP 路由，但 `fn_confirm_label_applied`/
`fn_identify_unidentified_goods`（004 迁移引入）内部会调用它关闭异常，而这两个
函数已经通过 `POST /missing-label/confirm`、`POST /unidentified/identify` 两条
真实可达的应用层路由暴露在外，且这两条路由此前把 `resolver_user_id` 直接从
客户端请求体读取——**应用层已经把这个漏洞模式暴露在生产可达的 API 上**。应用
团队已把这部分改为从 `DeviceAuthMiddleware` 已验证的 `req.context.userId` 派生
（详见本仓库 `docs/01-architecture/ADR/018-resolver-identity-trust-fix.md`），
今天已知的两条可达路径已收口。本项请求的数据库层加固仍然建议处理——作为独立
于应用层的纵深防御，避免未来有新调用方（内部工具、直接 RPC、新路由）绕开
应用层中间件重演同一问题。

---

## 新发现 2：GRANT 策略正式化——建议由「非阻塞观察」升级为一次性 ADR 决策

**背景**：上一轮第 5 项已记录此问题，结论是"生产不受影响，非阻塞"。本轮复核 009-016 共 16 个迁移文件，确认这个结论依然成立，且没有新增反例。

**请求**：这不是一个缺陷修复请求，而是建议 DBA 团队正式写一份简短的 ADR（无论结论是"维持现状，理由是 XXX"还是"计划补一份 `999_grants.sql`"），把这个已经讨论过两轮的问题正式关闭，避免它作为一条"待办"无限期挂在 README 里被后续每一轮复核重新提起。

---

## 新发现 3（延续原 MEDIUM 项）：`fn_expire_stalled_sync_events` 未确认已挂载 `pg_cron`

**对应迁移**：009

**问题**：009 按上一轮请求新增了 `fn_expire_stalled_sync_events`，但函数本身只是定义，设计文档里写的是"建议每 5 分钟跑一次"，本轮复核 `ops-scripts/unWMS_Setup_Cron_Jobs_V2.1.sql` 未发现对应的 `cron.schedule(...)` 调用。如果这个函数从未被实际调度，那么 009 对上一轮 MEDIUM 项的修复只完成了"清扫逻辑存在"，没有完成"清扫逻辑会被自动触发"——`sync_events` 卡死 PROCESSING 依然无法自愈，只是现在多了一个需要手动调用才会生效的函数。

**请求**：确认 `fn_expire_stalled_sync_events` 是否已在生产环境的 `pg_cron` 里注册；如果没有，请补充到 `ops-scripts/unWMS_Setup_Cron_Jobs_V2.1.sql`，并说明该文件"幂等、按环境单独执行一次"的既有约定是否已在最新环境执行过。

---

## 新发现 4（信息记录，不要求立即处理）：`containers` 表跨租户共享可见性模型

**对应迁移**：014（RLS hardening batch 2+3）

**背景**：014 的设计文档明确记录了这个权衡——空闲/未占用的 `containers`（共享物理资产，没有可靠的租户归属路径）目前对所有租户可见（只暴露 `lpn_code`/类型/状态/库位，不含业务数据），并标注"如果'严格租户容器池'成为真实产品需求就要重新设计"。

**请求**：这是一个产品决策，不是工程缺陷——应用团队会把"是否需要严格租户容器池"作为产品侧待确认事项单独跟踪（见 `docs/00-project/ROADMAP.md` 对应条目）。此处记录只是为了让 DBA 团队知道，如果未来收到"container 需要租户隔离"的需求，这不是一个新问题，而是 014 已经预见并权衡过的已知设计决策点，重新设计时可以直接参考 014 设计文档里的权衡记录。

---

## 新发现 5（文档卫生，非阻塞）：`unWMS_Full_Init_Schema_V2.1.md` 模块总览表滞后于实际部署层数

**问题**：该表此前同步到 layer 12（对应一次专门的 `docs:` commit），但 013-016 四个迁移合并后，总览表未跟进更新到 layer 16。这份表是"部署顺序存在硬约束"的唯一权威索引（后续迁移可能用 `CREATE OR REPLACE` 覆盖前面层的函数定义），保持它与实际迁移文件数一致，对新加入的协作者/未来的复核都很重要。

**请求**：建议在下一次迁移 PR 里顺带补齐（不需要单独开一个 PR），或按 DBA 团队自己流程决定处理时机。

---

## 新发现 6（测试卫生，非阻塞）：View RLS 回归测试断言强度不足

**对应迁移**：011（view security_invoker hardening）

**问题**：011 的评审笔记自己指出，当前针对 11 个视图的 RLS 回归测试只断言 `view_count <= direct_count`（视图返回行数不多于直接查表），没有断言"视图返回的 `tenant_id` 集合是调用者自己租户的子集"。前者能测出"视图完全没有生效"这类明显退化，但测不出"视图对某个特定其他租户的数据发生了泄露但总行数恰好没变多"这类更细的退化。

**请求**：建议下次涉及这批视图的测试维护时，把断言收紧为对 `tenant_id` 集合做子集校验，而不是单纯的行数比较。不要求单独排期，可在下次触碰该测试文件时顺带处理。

---

## 处理建议

新发现 1（`fn_resolve_exception` 身份冒用）优先级最高，建议参照 013 的既有模式独立排期；新发现 3（cron 调度确认）次之，是"回答一个是否已配置的问题"而非设计工作，成本很低；新发现 2（GRANT ADR）建议合并到下次迁移 PR 顺带关闭；新发现 4/5/6 均为非阻塞记录，供 DBA 团队自行决定处理时机。

所有改动请按 DBA 团队自有的
`design-docs/unWMS_PR_Pre_Submission_Checklist_V1.md` 逐条自查并附验证证据。本文档
不代为决定具体 DDL 写法，以上 SQL 片段仅为方向性参考。

**关联文档**：`docs/00-project/ROADMAP.md`「阶段 1.5」、
`docs/01-architecture/ARCHITECTURE.md`「§11 待决策架构问题」、
`docs/03-database/REPOSITORY_ROADMAP.md`「跨仓库同步与状态核实」、
`docs/04-workflows/WORKFLOWS.md`「§8 独立评审流程缺口」、
`HiWmsSupabase` 仓库自身 `design-docs/`（009-016 各自的设计文档，本文档所有发现均来自对其只读复核）、
[HiWmsSupabase#18](https://github.com/AaronLucas/HiWmsSupabase/issues/18)（本文档的镜像 Issue）、
[HiWmsSupabase#1](https://github.com/AaronLucas/HiWmsSupabase/issues/1)（上一轮 addendum，已追加状态更新评论）。
