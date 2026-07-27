# DBA Addendum 请求 —— RBAC 基础种子数据缺失（2026-07-28）

> **性质**：应用团队复核发现的种子数据缺口，不修改任何 `.sql` 文件——
> `supabase/seed.sql` 的权威版本在 DBA 团队管理的 `HiWmsSupabase` 仓库
> （本仓库 `supabase/` 整个目录被 gitignore，见 `.gitignore` 注释）。

## 背景

排查 Sprint 3 任务「permissions 种子数据补全」时发现：`roles`、`role_permissions`
两张表在本地沙盒里完全是空的（`SELECT count(*)` 均为 0），`permissions` 表只有
5 条零散记录，看不出是有意的最小种子集还是遗留测试数据。同时确认
`ExpressMiddlewareFactory.requirePermission()` 这个 RBAC 中间件此前在整个代码库
里**从未被任何路由实际调用过**——之前是完全未启用的状态，种子数据缺失不会造成
可观察的故障，容易被忽略。

本次顺带把 RBAC 校验实际接上了第一个真实端点：`POST /device/provision`
（`devices:CREATE`，对应 `docs/02-api/DEVICE_PROTOCOL_SPEC.md` 里 ADR-019 §4.2
一直标着 TODO 的那一项），调用路径是 `SupabasePermissionChecker.check()` →
`check_user_permission` RPC（已确认实现正确：`SECURITY DEFINER` + 跨租户查询
安全默认拒绝 + `user_roles`/`role_permissions`/`permissions` 三表联查）。**这意味着
从现在起，`devices:CREATE` 这条权限如果没有种子数据，生产环境里任何用户的
设备配发请求都会被拒绝（403）**——这是本次改动第一次让种子数据缺失从"没人用不
影响"变成"真的会挡住业务操作"。

## 请求

请 DBA 团队在 `supabase/seed.sql` 里补上一套最小可用的 RBAC 基础数据：

1. **每个租户至少一个管理员角色**，拥有当前已在使用的全部 `resource:action`：
   - `devices:CREATE`（本次新接，`POST /device/provision` 已强制校验）
   - 其余在 `IPermissionChecker`/`ExpressMiddlewareFactory.requirePermission()`
     设计文档或未来端点里预留的 resource（`orders`/`inventory`/`products`/
     `waves`/`work_orders` 等）暂时还没有路由实际调用 `requirePermission()`，
     是否现在就一并建议种子由 DBA/产品决定——不强制现在补全，只是提醒后续
     每接一个新的 `requirePermission()` 调用，都需要同步检查种子数据是否跟上，
     否则会重复今天这种"功能悄悄从未生效变成会拒绝真实请求"的情况。
2. **新租户创建时自动生成默认角色**的机制（例如 `handle_new_user` 触发器或
   独立的 `fn_provision_tenant_defaults`）——如果这个机制目前不存在，新注册的
   租户会连一个能创建设备的管理员用户都没有，需要 DBA 确认现状。

## 处理建议

低风险、纯数据/种子脚本改动，不涉及 DDL。建议作为下一次常规 seed 更新的一部分，
不需要单独走 addendum 迁移流程；但**建议在合并本仓库 PR #59（把 `devices:CREATE`
接成强制校验）之前或同时处理**，否则会出现"代码已经要求权限、数据库里没人有这个
权限"的空窗期。

**关联文档**：`docs/02-api/DEVICE_PROTOCOL_SPEC.md`（ADR-019 §4.2）、
`docs/00-project/ECC_EXECUTION_PLAN.md`「3.4 permissions 种子数据补全」、
本仓库 PR #59（`fix/sprint3-device-auth`，`devices:CREATE` 校验的实际代码）。
