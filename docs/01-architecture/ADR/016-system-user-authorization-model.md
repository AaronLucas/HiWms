# ADR-016: 系统账号（`is_system_user`）授权模型——现状分析与演进方向

## 状态
🟡 部分实施——本次仅落地「收窄 RBAC bypass」这一小步（见「决策」），其余演进方向记录为
后续待办，未拍板具体排期。

## 背景

排查 `ExpressMiddlewareFactory.requirePermission()`（`src/adapters/express/ExpressMiddlewareFactory.ts:117-148`）
时发现：第 124-126 行对 `is_system_user=true` 的账号做了无条件的权限校验跳过——

```typescript
// 系统用户跳过权限检查
if (req.context.user.isSystemUser) {
  return next();
}
```

该中间件同时被 `tenant-api`（业务接口：订单/库存/商品/波次）和 `device-api` 复用（`device-api`
实际未调用 `requirePermission()`，仅注释提及）。这意味着任何被数据库标记为
`is_system_user=true` 的账号，访问 `tenant-api` 业务端点时会完全绕过 RBAC 角色权限检查，
不需要分配任何角色。由此展开了对 `is_system_user` 整体授权模型的分析。

## 现状分析

### 1. `is_system_user` 承担了两种不同性质的授权语义

| 使用位置 | 语义 | 是否绕过 RLS |
|---|---|---|
| `src/apps/admin-api/main.ts`（平台超管后台，独立 app） | "你是不是真正的平台超管，放你进这个完全独立、跨租户的后台" | ✅ 是（`main.ts` 注释原文："不注入 RLS（平台级访问）"，用 `service_role` key） |
| `src/adapters/express/ExpressMiddlewareFactory.ts`（`tenant-api` 复用的中间件） | "你在自己所在的这一个租户内，要不要过 RBAC 细粒度检查" | ❌ 否（`tenant-api` 路由把调用者真实 JWT 通过 `authToken` 传给仓储层，RLS 独立生效） |

**同一个布尔字段在两个 app 里做两件不同的事**，是本次分析的核心发现，也是设计异味的根源。

### 2. 验证结论：`is_system_user` 不能在 `tenant-api` 路径下变成跨租户超管

依据（均为读代码验证，非推断）：

- `docs/03-database/DB_SCHEMA.md` §2.4：`users.tenant_id` 是 `NOT NULL`——包括
  `is_system_user=true` 的账号，也必须挂在某一个具体租户下（迁移 024
  `fn_provision_tenant_defaults` 是把这类账号关联到"自己所在租户"的 ADMIN 角色，不是脱离租户）。
- `src/apps/tenant-api/routes.ts` 每个路由都把 `req.context?.supabaseToken`（调用者真实 JWT）
  作为 `authToken` 传给仓储层（如 `orders.findByTenant(tenantId, { ..., authToken })`）。
- `SupabaseBaseRepository.getClient()`（`src/adapters/supabase/repositories/SupabaseBaseRepository.ts:30-35`）：
  只要传了 `authToken`，就返回 `getAuthenticatedClient(authToken)`——以调用者真实身份发起查询，
  而不是万能的 `service_role`。
- 因此不管应用层代码算出的 `tenantId` 是什么、请求里塞了什么 `?tenant_id=` 参数，Postgres RLS
  （`fn_current_tenant_id()`，本仓库同批次已修复其自引用递归问题，见
  `docs/03-database/DBA_ADDENDUM_REQUEST_TENANT_ID_RLS_RECURSION_2026-07-29.md`）都会用调用者
  自己 JWT/档案里的真实 `tenant_id` 再筛一遍——两层筛选必须同时满足，结果只可能是"自己的租户"
  或"空结果"。

**结论：`is_system_user` 在 `tenant-api` 内的实际效果是"在本租户范围内免过 RBAC 角色检查"，
不是"跨租户可见任意数据"。** 真正的全平台跨租户能力只存在于 `admin-api`（独立 app，
`service_role`，无 RLS），且该能力目前必需的门禁检查是独立实现的
（`if (!req.context?.user?.isSystemUser) return 403`，见 `admin-api/main.ts`），与本 ADR
讨论的 `tenant-api` RBAC bypass 是两回事。

### 3. 相邻发现（未在本次范围内处理，需单独跟踪）

`SupabaseTenantResolver.resolveFromRequest()`（`src/adapters/supabase/auth/SupabaseTenantResolver.ts:34-66`）
优先级 1/2（`x-tenant-id` 请求头、`?tenant_id=` 查询参数）对**任何已登录用户生效，不限于
`is_system_user`**，且 `validateTenant()` 只检查"该租户是否存在且启用"，**不检查调用者是否真的
属于这个租户**。今天没有造成实际风险，是因为 §2 所述的 RLS 兜底顶住了——但这个兜底成立的前提是
"仓储方法确实把 `authToken` 传下去"。`ADR-015`「实施记录」已提到：`authToken` 机制目前只打通了
`SupabaseBaseRepository` 的通用 CRUD 方法，还有相当一部分具体业务查询方法未接入。**如果某个
仓储方法漏传 `authToken`（走无 RLS 保护的连接），"传一个不属于自己的 `tenant_id` 参数"这件事
会对任何用户（不限于系统账号）变成真实可利用的越权。** 已记录为独立待办（见下方 ROADMAP 条目），
不与本 ADR 的 RBAC bypass 收窄合并处理，避免改动范围失控。

## 决策

### 本次落地（低风险、小改动）

移除 `requirePermission()` 里的硬编码 bypass，让 `is_system_user` 账号在 `tenant-api` 内也走
真实的 `check_user_permission` RPC。数据库侧已提前就绪：迁移 024 已把
`role='ADMIN'`/`is_system_user=true` 的账号关联到一个挂了 18 组 `resource/action` 权限的
真实 ADMIN 角色（每租户一份，`roles.tenant_id NOT NULL`）。核对后确认 `tenant-api` 当前全部
`requirePermission()` 调用点（`orders` 的 READ/CREATE/UPDATE、`inventory` 的 READ、`products`
的 READ、`waves` 的 READ/CREATE）均在这 18 组权限范围内——移除 bypass 不会导致现有系统账号
在这些端点上突然 403。

同步修复：`src/__tests__/integration/tenant-api/waves.http.test.ts`（唯一显式依赖该 bypass 的
测试，第 38-40 行）改为给测试账号挂真实角色权限，而非继续用 `isSystemUser: true` 走捷径。

### 演进方向对比（供后续排期参考，本次不实施）

多租户 SaaS 平台管理员/系统账号的授权模型，成熟实践大致分四类，不互斥、常组合使用：

| | 1. 控制面/数据面分离 | 2. 独立身份体系 | 3. RBAC 原生 scope 权限 | 4. 限时影子登录+审计 |
|---|---|---|---|---|
| **核心思路** | 平台运维/管理功能独立成另一个 app/服务，不与客户业务数据面混跑 | 平台员工账号不进客户 `users` 表，走另一套认证入口 | 不设特殊布尔开关，"平台级权限"是权限表里 `scope='platform'` 的正常记录 | 不给永久权限，运维要看某租户数据时临时"变身"，限时+留痕 |
| **解决的问题** | 防止管理功能 bug/漏洞波及客户数据查询路径；职责分离 | 防止客户数据表字段被误标记成系统权限开关 | 消除"一个字段两种含义"、"权限表说了不算"的分裂真相 | 防止长期免检查账号成为常驻攻击面/内部滥用风险 |
| **改动成本** | 大（本项目已具备：`admin-api` vs `tenant-api`） | 大（要迁移认证体系、改造登录/建号流程） | 小～中（本次收窄 bypass 是起步） | 中～大（会话短期化+审批流+审计日志基础设施） |
| **本项目现状** | ✅ 已有 | ❌ 未做 | 🟡 部分（数据库权限表已就绪，本次开始接入应用层） | ❌ 未做 |
| **代表案例** | Stripe Connect 平台后台、Salesforce 内部工具 | Auth0/WorkOS/Clerk 的 Organizations + 独立员工身份 | AWS IAM、Auth0 Fine-Grained Authorization | GitHub/Zendesk/Intercom 的客服"以用户身份登录" |
| **主要局限** | 两个 app 边界要维护好，否则等于白分离 | 历史账号一次性迁移成本高 | 需要权限模型设计足够细，不能偷懒退回布尔值 | 工程量最大，往往是团队规模扩大后才投入 |

**建议的长期方向**：1（已具备）+ 3（渐进重构，引入独立的 `scope='platform'` 概念而非复用租户级
角色）+ 4（视运维团队规模决定是否投入）。2 对当前团队规模投入产出比可能不划算，可以先不做。

## 后果

### 正面
- `tenant-api` 内系统账号的权限从"代码硬编码全放行"变为"读数据库真实权限表"，DBA 后续可以
  单独调整某个系统账号的权限范围，不需要改代码发版。
- 消除了一处"数据库权限表数据形同虚设"的死代码路径。

### 负面/风险
- 如果未来出现全新的、未经过迁移 024 backfill 的 `is_system_user` 账号（例如手工插入、没有关联
  任何角色），移除 bypass 后这些账号访问 `tenant-api` 会变成全部 403——这是变严格后的预期行为，
  不是 bug，但需要留意生产环境是否存在这类"裸"账号（本地/种子数据未发现）。

## 关联文档
- `docs/01-architecture/ADR/015-auth-identity-bridge.md` —— RLS/`fn_current_tenant_id()`/
  per-request authenticated client 机制的原始设计
- `docs/03-database/DBA_ADDENDUM_REQUEST_TENANT_ID_RLS_RECURSION_2026-07-29.md` —— RLS 自引用
  递归修复（本 ADR §2 的验证依赖此修复已生效）
- `docs/00-project/ROADMAP.md` Sprint 4 §4.4-4.6（RBAC 覆盖矩阵）—— 本次改动的任务归属

---

*决策者：主工程师 | 状态：部分实施（RBAC bypass 收窄） | 记录日期：2026-07-31*
