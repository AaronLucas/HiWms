# ADR-015: 登录/注册身份模型桥接与 RLS 租户上下文注入

## 状态
🟡 Proposed（设计已完成，待评审确认后再进入实施；未实施任何代码/迁移改动）

## 背景

开发团队在推进 `docs/03-database/REPOSITORY_ROADMAP.md`「剩余缺口清单」排期任务 #5（补充以
`authenticated` 角色调用的集成测试——此前所有并发测试都用 `service_role` 绕过了 RLS）时发现：
系统里没有一条真实可用的路径能让普通租户用户完成注册并登录。深入排查后确认这不是单点 bug，
而是"登录/注册"整条业务线存在架构层面的身份模型分裂，具体拆解为四层问题：

### 问题 1：租户端根本没有登录/注册入口
`src/apps/` 下只有 `device-api`（设备走 device_id+api_key，非用户认证）和 `admin-api`（仅平台
超管 `/auth/login`）。ADR-010 描述的四端入口中 **Tenant API 从未实现**——`src/apps` 里没有这个
目录。`docs/00-project/ROADMAP.md` 阶段 2（前端 Uniapp）"登录/鉴权"整节仍是未开始状态，
`src/client` 也确实是空目录。

### 问题 2：注册方法已实现但从未接入任何路由
`src/adapters/supabase/auth/SupabaseAuthProvider.ts` 的 `signUp()` 实现完整，但全仓库搜索
`signUp\(` 只有定义那一处——没有任何路由调用它，是写了但没接线的悬空代码。

### 问题 3（根因）：`public.users` 与 Supabase Auth（`auth.users`）是两套不兼容的身份模型
`.readonly/unWMS_Full_Init_Schema_V2.1.sql` 第 126 行 `users` 表：`id UUID DEFAULT
uuid_generate_v4()`（不引用 `auth.users(id)`）、有自己的 `username`+`password_hash`、**没有
`email` 列**——这是为自建用户名密码认证设计的表。但 `SupabaseAuthProvider` 全部代码
（`signIn`/`signUp`/`verifyToken`）都基于 Supabase Auth 编写，隐含假设 `auth.users.id` 等于
`public.users.id`。全仓库没有任何 `handle_new_user` 触发器把两者接起来。结果：即使 `signUp()`
被接上路由调用成功，`public.users` 里也不会自动出现对应行，后续 `verifyToken()` 查不到
profile，永远返回 `tenantId: null`——注册"成功"但账号功能性锁死。

`docs/01-architecture/ADR/ADR-001-multi-tenant-rls.md` 已经写明设计意图是"兼容 Supabase Auth
(JWT) 与自建用户表两种认证模式"：`fn_current_tenant_id()` 优先读 JWT
`app_metadata.tenant_id`，回退按 `auth.uid()` 查 `users` 表。但两条路径当前都未被正确实现：
`signUp()`（第 147 行）把租户信息传进 `options: { data: metadata }`，这是 `user_metadata`（用户
自己可改），不是 RLS 读取的 `app_metadata`；回退路径又因为问题 3 描述的 id 不联动而失效。

### 问题 4（独立的系统性缺陷，与问题 1-3 正交但同样致命）：RLS 租户上下文从未真正传到查询连接上
`ADR-010` 曾承诺的机制是"`injectRlsContext` 设置 `req.supabaseHeaders`，`SupabaseClient`
拦截器自动读取"（见该 ADR 第 112 行），但实际代码里：

- `ExpressMiddlewareFactory.injectRlsContext()`（`src/adapters/express/ExpressMiddlewareFactory.ts:149-158`）
  只是把 `tenantId` 塞进 `(req as any).rlsContext`，**没有任何下游代码读取这个字段**。
- `src/apps/device-api/DeviceAuthMiddleware.ts:204` 设置 `req.headers['x-tenant-id'] = tenantId`，
  注释写"设置 RLS 所需的 x-tenant-id header"，但 `WmsSupabaseClient`（`src/adapters/supabase/SupabaseClient.ts`）
  是启动时创建一次的**单例 anon client**（`persistSession:false`），从不读取每次请求的 header，
  也不会把当前用户的 access_token 转发给 PostgREST。
- `SupabaseBaseRepository.getClient()`（`src/adapters/supabase/repositories/SupabaseBaseRepository.ts:16-18`）
  所有仓储查询走的都是这同一个单例连接。

结果：无论身份模型修不修，业务查询这条连接上 `request.jwt.claims`/`auth.uid()` 永远是空的，
`fn_current_tenant_id()` 两条路径在真实业务查询里都返回 `NULL`——RLS 要么全表拒绝要么只能靠
`service_role` 绕过（`admin-api` 就是这么"正常工作"的），**从未在租户级查询上真正拦截过跨租户
访问**。这是比登录注册本身更基础的一块拼图：即使方案 A 落地，如果不修这一条，RLS 仍不会按
预期生效。

## 决策

采用**方案 A：全面采用 Supabase Auth 作为唯一身份源**，理由见下方"方案对比"。具体决策拆成
三个独立但配套的改动：

1. **数据库侧**：`public.users` 桥接到 `auth.users`（详细设计见
   `.readonly/unWMS_Auth_Identity_Bridge_V1.md`，本 ADR 不重复）。
2. **应用代码侧**：修正 `SupabaseAuthProvider`/`IAuthProvider` 端口契约（本 ADR 详细设计）。
3. **连接层**：仓储查询改为按请求携带用户 access_token（本 ADR 详细设计），解决问题 4。

**产品决策（已与项目负责人确认）**：租户注册模式采用**自助注册**（用户可自行注册并创建新
租户，无需邀请码）。本轮范围**不包含**新建 `Tenant API` 应用（HTTP 路由/前端页面），只解决
身份模型与 RLS 租户上下文这两个底层问题，让后续排期任务 #5（authenticated 角色集成测试）以及
未来的 Tenant API 开发能建立在正确的地基上。

## 方案对比：方案 A（Supabase Auth）vs 方案 B（自建用户名密码）

| 维度 | 方案 A：全面采用 Supabase Auth | 方案 B：自建用户名密码体系 |
|---|---|---|
| 与 `ADR-001` 契合度 | **完全贴合**——`fn_current_tenant_id()` 的 JWT 路径本来就是为此设计，RLS 函数一行不改 | 部分冲突——自签 JWT 没有 Supabase 会话，`auth.uid()` 恒为 null，RLS 回退路径也失效，必须重构 RLS 或退回 ADR-001 已明确拒绝的"应用层 WHERE 过滤" |
| 对 `device-api` 影响 | 零影响（设备走独立的 device_id+api_key，不经过 `signIn`/`signUp`） | 同样零影响 |
| 对 `admin-api` 现有超管登录影响 | 中等：需一次性把超管账号迁入 `auth.users`（若尚不存在），迁移后 `verifyToken` 的 join 才真正成立——这条链路目前本就是坏的，方案 A 顺带修好 | 较低：超管数据留在 `public.users` 与现状一致，但整条 token 签发/校验链路要重写 |
| 新增依赖/维护面 | 复用 Supabase 托管的密码哈希、邮箱验证、密码重置、刷新令牌轮换 | 需自行引入 `bcrypt`/JWT 签名库，自行维护密钥管理、令牌撤销 |
| 净改动量 | 较小 | 较大（`SupabaseAuthProvider` 全部方法重写 + RLS 层需重新设计） |

**结论：采用方案 A。**（此对比由 `ecc:architect` agent 基于当前代码库独立复核确认。）

## 详细设计

### 1. 数据库侧
详见 `.readonly/unWMS_Auth_Identity_Bridge_V1.md`（`public.users` 桥接 `auth.users`、
`handle_new_user` 触发器、`app_metadata.tenant_id` 写入设计、开放问题清单）。**该文档尚未
产出配套 `.sql`，需先评审设计再编写迁移脚本**，迁移脚本 PR 必须按
`.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 逐条自查。

### 2. 应用代码侧改动清单（不涉及 `.sql`，属于开发团队任务）

| 文件 | 改动性质 |
|---|---|
| `src/adapters/supabase/auth/SupabaseAuthProvider.ts` | `signUp()`：改用 Supabase Admin API（`auth.admin.updateUserById`）正确写入 `app_metadata.tenant_id`，不再使用 `options.data`（当前第 147 行写错位置，落进 `user_metadata`）；配合数据库侧 `handle_new_user` 触发器已建好的 tenant/角色，调用时序需要与触发器设计对齐（先建 tenant 还是先注册用户，见 `.readonly` 文档开放问题 5）。`signIn()`：修正第 134 行 `(data.user as any).tenant_id` 恒为 `null` 的错误类型断言，改为从 profile/`app_metadata` 正确读取。`generateTokens()`（第 106 行当前直接 `throw`）：评估是否废弃或修复。 |
| `src/core/ports/auth/IAuthProvider.ts` | 补充声明 `signIn`/`signUp`（当前端口接口没有这两个方法，`admin-api` 能调用全靠拿到的是具体类 `SupabaseAuthProvider` 而非端口类型，违反 `ADR-007` 六边形架构契约，测试用 mock provider 替换时会直接编译不过） |
| `src/adapters/supabase/SupabaseClient.ts` | 新增"按请求 access_token 创建客户端"的能力：不再只有一个启动时创建的单例 anon client，需要能针对每次请求用该请求携带的用户 JWT 创建/复用一个 Supabase client（`createClient(url, anonKey, { global: { headers: { Authorization: \`Bearer ${accessToken}\` } } })`），这样 PostgREST 才能在这条连接上正确解析 `auth.uid()`/`app_metadata.tenant_id`，`fn_current_tenant_id()` 才会拿到真实值。具体是每请求新建 client 还是维护一个按 token 缓存的池，需要评审性能影响。 |
| `src/adapters/supabase/repositories/SupabaseBaseRepository.ts` | `getClient()` 需要能接收"当前请求的用户 client"而不是硬编码调用 `this.supabase.getClient()`（单例）；意味着仓储实例化方式或方法签名需要能传入请求级 client，这是本项改动里改动面最大的一处，涉及所有仓储的调用方式，需要与 `ExpressMiddlewareFactory` 的改法配套设计 |
| `src/adapters/express/ExpressMiddlewareFactory.ts` | `injectRlsContext()`（第 149-158 行）当前只是把 tenantId 塞进无人读取的 `req.rlsContext`，需要改为真正把请求的 access_token（而不是 ADR-010 原设想的 `x-tenant-id` header——header 不会被 PostgREST 解析进 `request.jwt.claims`，只有真实转发用户的 JWT 才能让 `fn_current_tenant_id()` 的 JWT 路径生效）传递到后续仓储调用链上 |
| `src/apps/device-api/DeviceAuthMiddleware.ts` | 第 204 行设置的 `req.headers['x-tenant-id']` 目前是无效代码（SupabaseClient 从不读取），需要评估设备端 RLS 上下文注入是否也要走同样的"按请求 token 建 client"路径，或设备端本来就应该走 `service_role`（需要单独确认设备 token 是否是可被 PostgREST 识别的 Supabase JWT） |

### 3. 与既有 ADR 的关系

- **`ADR-001`**：本 ADR 不修改 `fn_current_tenant_id()` 或任何 RLS 策略，只是让该 ADR 原本设计的
  两条取值路径第一次被正确满足。
- **`ADR-010`**：本 ADR 纠正其中一处"设计意图已写但从未实现"的描述——第 112 行"`SupabaseClient`
  拦截器自动读取 `req.supabaseHeaders`"这个机制在代码里不存在；本 ADR 落地后，`ADR-010` 该处
  描述应更新为"按请求 access_token 创建 Supabase client"。
- **`ADR-007`（六边形架构）**：本 ADR 顺带修复 `IAuthProvider` 端口缺少 `signIn`/`signUp` 声明的
  契约违反问题。

## 后果

### 正面
- 打通登录/注册的地基问题后，排期任务 #5（`authenticated` 角色集成测试）才具备可执行的前提。
- RLS 第一次能在真实业务查询里生效，而不是只在 `service_role` 绕过路径下"看起来正常"。
- 复用 Supabase 托管的密码安全能力，减少自建认证的长期维护负担。

### 负面/风险
- `SupabaseBaseRepository`/仓储调用方式改动面较大，涉及所有仓储的实例化/调用路径，需要仔细
  设计以避免大范围重构引入回归；建议先在一个仓储上做验证性改造，再推广。
- 数据库侧改动（`.readonly/unWMS_Auth_Identity_Bridge_V1.md` 第六节）有多个业务规则尚未确认
  （新租户重名策略、`email` 唯一性范围、现有超管账号迁移），必须先拍板才能编写迁移脚本。
- `admin-api` 超管登录路径需要一次性数据迁移验证，不能默认"顺带兼容"。

## 实施计划（开发团队任务，当前状态：仅设计，未实施）

> 按项目负责人要求，本阶段只产出设计与计划，不修改任何代码/迁移文件。以下步骤供后续排期，
> 每一步完成后仍需走 `/ecc:code-review` skill 评审（按 `.claude/rules/ecc/common/code-review.md`）。

1. 确认 `.readonly/unWMS_Auth_Identity_Bridge_V1.md` 第六节 5 个开放问题（产品/DBA/项目负责人）。
2. 数据库侧：按确认后的设计编写 `unWMS_Auth_Identity_Bridge_V1.sql`，按 PR 自查清单验证，DBA 评审。
3. 应用代码侧（可与步骤 2 并行设计、但需等步骤 2 迁移落地后才能联调）：
   a. `IAuthProvider` 端口补充 `signIn`/`signUp` 声明。
   b. `SupabaseAuthProvider.signUp`/`signIn` 修正（`app_metadata` 写入位置、`tenantId` 断言）。
   c. `SupabaseClient`/`SupabaseBaseRepository` 改造为支持按请求 access_token 建连接。
   d. `ExpressMiddlewareFactory.injectRlsContext` 改为真正传递 access_token 而非无效的 tenantId/header。
4. 补集成测试：验证自助注册 → `handle_new_user` 触发器 → `app_metadata.tenant_id` → 真实
   `authenticated` 角色查询 → RLS 正确隔离，全链路打通（这条测试同时就是排期任务 #5 的一部分）。
5. 现有 `admin-api` 超管登录路径回归验证。

## 关联文档
- `.readonly/unWMS_Auth_Identity_Bridge_V1.md` —— 数据库侧详细设计与开放问题
- `docs/01-architecture/ADR/ADR-001-multi-tenant-rls.md` —— RLS 设计原意
- `docs/01-architecture/ADR/010-middleware-factory.md` —— 需要同步更新的过时描述（第 112 行）
- `docs/01-architecture/ADR/007-hexagonal-ports-adapters.md` —— 端口/适配器契约
- `docs/03-database/REPOSITORY_ROADMAP.md`「剩余缺口清单」#7 —— 任务跟踪
- `docs/00-project/ROADMAP.md` —— 阶段 2 前端登录/鉴权模块依赖本 ADR 先行完成

---

*决策者：主工程师 | 状态：待评审 | 记录日期：2026-07-20*
