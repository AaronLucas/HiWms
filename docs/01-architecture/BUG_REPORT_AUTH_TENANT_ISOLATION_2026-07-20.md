# 鉴权/租户隔离调查报告（2026-07-20）

> **性质**：本报告是排查记录，未修改任何代码。触发原因：处理
> `docs/03-database/REPOSITORY_ROADMAP.md` §「剩余缺口清单」HIGH 第 3 项
> （"补充 `authenticated` 角色 RLS/权限路径测试"）前的可达性核查，过程中发现该缺口
> 描述的前提本身需要重新核实，遂暂停原计划，改为完整调查并汇报。

## 一句话结论

**不是"DBA 脚本缺少登录/注册功能函数"**。`fn_current_tenant_id()`（DBA 交付的 SQL 函数）本身实现正确，符合 Supabase 官方推荐做法。真正的问题分两层：

1. **一个真实的 TS 应用层 bug**：`SupabaseAuthProvider.signUp()` 把租户信息写进了 `user_metadata`（客户端可自行篡改的字段），而不是 RLS 依赖的 `app_metadata`（只能服务端写入）。
2. **一个更大的架构事实（不是 bug，是既有设计）**：真正在跑、被测试覆盖的生产路径（device-api）**故意用 `service_role` 绕过 Postgres RLS**，租户隔离靠应用层每次查询显式 `.eq('tenant_id', ...)` 实现——这是代码注释里明写的设计决定，不是遗漏。这意味着 HIGH 第 3 项"补 `authenticated` 角色 RLS 测试"这个缺口条目，原始描述可能把测试对象搞错了：`authenticated` 角色 RLS 路径目前不是 device-api 的真实安全边界。

---

## 分层拆解

### 第 1 层：SQL 层（DBA 交付）—— 正确，无需修改

`fn_current_tenant_id()`（`supabase/migrations/001_enterprise_core_schema.sql:1759`）：

```sql
-- 优先从 JWT app_metadata 中读取
v_claim := current_setting('request.jwt.claims', true)::json -> 'app_metadata' ->> 'tenant_id';
...
-- 回退：按当前登录用户 (auth.uid()) 在 users 表中查其所属租户
SELECT tenant_id INTO v_tenant_id FROM users WHERE id = auth.uid();
```

这个实现是对的：只信任 `app_metadata`（服务端可控），不信任 `user_metadata`（客户端可篡改）——这正是 Supabase 官方文档反复强调的安全前提。**这一层没有问题，不需要 DBA 补任何函数。**

### 第 2 层：TS 应用层 —— 发现一个真实 bug

`SupabaseAuthProvider.signUp()`（`src/adapters/supabase/auth/SupabaseAuthProvider.ts:140-158`）：

```ts
const { data, error } = await this.client.auth.signUp({
  email, password,
  options: { data: metadata },   // ← 写入的是 user_metadata，不是 app_metadata
});
```

Supabase JS SDK 里，`signUp({ options: { data } })` 写入的是 `raw_user_meta_data`（对外暴露为 `user.user_metadata`），**不是** `app_metadata`。`app_metadata` 只能通过管理员 API 写入（如 `auth.admin.createUser({ app_metadata })` 或 `auth.admin.updateUserById(uid, { app_metadata })`），这是 Supabase 有意的设计——防止用户通过改自己的 profile 篡改租户/权限声明。

**后果**：如果真的走这条 `signUp()` 注册出一个新用户，`fn_current_tenant_id()` 的 JWT 优先路径永远读不到租户信息，会掉进回退路径（按 `auth.uid()` 查本项目 `users` 表）——但下一条发现说明这条回退路径大概率也走不通。

**另一个关联发现**：本项目 `users` 表的 `id` 是独立的 `uuid_generate_v4()`，与 Supabase Auth 的 `auth.users.id` **没有任何触发器/回填逻辑关联**（已确认迁移脚本里没有 `on_auth_user_created` 之类的触发器）。也就是说，即便通过 `auth.signUp()` 真的创建了一个 `auth.users` 行，这个 `auth.uid()` 也大概率查不到本项目 `users` 表里的任何一行。

**净效果（并非数据泄露方向的安全洞，是可用性问题）**：两条路径都读不到租户 → `fn_current_tenant_id()` 返回 `NULL` → RLS 策略 `tenant_id = fn_current_tenant_id()` 对 `NULL` 的比较恒为假 → **该用户所有行都被拒绝**，是"全部拒绝"而不是"越权放行"。不是安全漏洞方向的风险，但意味着如果真的有人调用这条注册流程，注册出来的账号基本不可用。

### 第 3 层：可达性核查 —— 缺口条目的前提需要重新核实

| 方法 | 是否被路由调用 | 证据 |
|---|---|---|
| `SupabaseAuthProvider.signIn()` | ✅ 是 | `src/apps/admin-api/main.ts:49-52`，`POST /auth/login` |
| `SupabaseAuthProvider.signUp()` | ❌ 否 | 全仓库搜索 `src/apps` 无任何调用点 |
| `SupabaseAuthProvider.verifyToken()` | ❌ 否 | 全仓库搜索 `src/apps` 无任何调用点 |

即：`signUp()` 目前是"已实现未接入路由"的代码（上面发现的 bug 暂时不会在生产触发，但一旦有人把注册端点接上就会立刻触发）；`verifyToken()`（校验 JWT、解析用户角色权限）目前也没有任何 middleware 或路由在用——`admin-api` 现在只有 `/health` 和 `/auth/login` 两个端点，登录之后拿到的 JWT 交给谁验证、怎么验证，目前代码里还没有答案。

**更关键的发现**：真正被测试覆盖、被文档反复确认"已部署生产"的 **device-api**（本轮会话一直在测的 `SupabaseSyncEventRepository`/`SupabaseTaskClaimRepository` 等仓储的调用方），走的是完全不同的另一套认证——`DeviceAuthMiddleware`（自签 Device JWT 或 API Key，与 Supabase Auth/`auth.users` 无关）。而且它的 DI 配置明确写着（`src/apps/device-api/di.ts:18`）：

```ts
// 初始化 Supabase 适配器（使用 service role key 绕过 RLS，设备端通过 middleware 注入 tenant_id）
const supabaseAdapters = createSupabaseAdapters({ ... serviceRoleKey: config.supabase.serviceRoleKey });
```

**这是代码注释里明写的既有设计，不是本次新发现的 bug**：device-api 的所有数据库操作都用 `service_role`（Postgres 层面完全绕过 RLS），租户隔离完全靠应用层每次查询显式 `.eq('tenant_id', tenantId)` 实现——这也正是本轮会话里从 CRITICAL #1 到 HIGH #2 所有测试文件里反复出现的那个 `.eq('tenant_id', ...)` 过滤模式。

---

## 对 HIGH 第 3 项缺口条目的影响

`docs/03-database/REPOSITORY_ROADMAP.md` 原缺口描述："当前所有并发测试使用 `service_role` 绕过 RLS，未覆盖生产 `authenticated` 角色路径"，建议方向是"补充以 `authenticated` 角色调用的集成测试"。

现在核实下来：**`authenticated` 角色 + Postgres RLS，目前不是 device-api（真正在跑的生产路径）的安全边界**——它是 `service_role` + 应用层过滤。如果按原缺口描述去补"用 `authenticated` 角色跑一遍现有并发测试"，测的其实是一条设计上就不会被生产流量真正走到的路径，投入产出比存疑。

`authenticated` 角色 RLS 路径**目前唯一可能相关的地方是 admin-api**——但 admin-api 现在只有登录一个端点，其余人类可操作的管理界面/API 尚未开发（`docs/00-project/ROADMAP.md` 阶段 2 前端应用列表里的"系统管理"模块也还是 `[ ]` 未完成）。也就是说，`authenticated` 角色 RLS 要不要测、怎么测，取决于 admin-api 未来到底会不会真的按"客户端持有 JWT 直连 PostgREST、靠 RLS 做隔离"这个模式来建，还是也会像 device-api 一样走"后端用 service_role + 应用层过滤"这个已经验证过的模式。这是一个产品/架构方向的决策，不是我能替你定的。

---

## 建议的后续处理方向（仅供参考，未执行任何一项）

1. **`signUp()`/`app_metadata` 这个具体 bug**：即使 `signUp()` 目前未接入路由（暂不会在生产触发），建议还是登记为独立缺口条目跟踪，因为一旦有人后续把注册端点接上，会立刻复现"新用户注册后什么都查不到"的问题。修复本身范围很小（改成走 `auth.admin.createUser({ app_metadata })`，需要判断是否要新增一个用 admin/service client 的路径），不涉及任何 `.sql` 改动。
2. **`verifyToken()` 零调用点**：登录端点返回 JWT 之后，目前没有任何地方校验/消费这个 JWT——如果 admin-api 未来打算走"JWT + RLS"模式，这是必须补的一环；如果打算跟 device-api 一样走"service_role + 应用层过滤"，那 `verifyToken()`/`IAuthProvider` 里跟 RLS 相关的这部分设计可能需要重新评估。
3. **HIGH 第 3 项本身**：建议先由你/团队决定 admin-api 的鉴权模式方向，再回头决定"`authenticated` 角色 RLS 测试"这个缺口条目要不要做、做在哪个端点上，而不是照搬原描述去测一条可能不是真实安全边界的路径。

## 涉及文件（仅列出，未修改）

- `src/adapters/supabase/auth/SupabaseAuthProvider.ts`
- `src/core/ports/auth/IAuthProvider.ts`
- `src/apps/admin-api/main.ts`
- `src/apps/device-api/di.ts`、`src/apps/device-api/DeviceAuthMiddleware.ts`
- `supabase/migrations/001_enterprise_core_schema.sql`（`fn_current_tenant_id`，第 1759 行起）
