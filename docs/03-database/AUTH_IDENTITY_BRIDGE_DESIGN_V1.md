# unWMS 登录/注册身份模型桥接 —— 设计文档 V1.0（草案，待评审）

> 依赖（只读引用，不修改）：`.readonly/unWMS_Full_Init_Schema_V2.1.sql`（`users` 表定义见第 126 行，
> `fn_current_tenant_id()` 见第 1759-1786 行）
> 对应 DDL：**尚未产出** `unWMS_Auth_Identity_Bridge_V1.sql` —— 本文档是设计评审稿，评审通过后
> 才由 DBA 团队按 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 流程编写配套迁移脚本；
> `.readonly/` 目录本身是只读参考材料，不在本文档写入范围内。
>
> 状态：🟡 设计草案，未评审、未实施、未编写 DDL
>
> 背景：开发团队在推进《数据库仓储测试补齐路线图》排期任务 #5（补充 `authenticated` 角色的
> RLS/权限路径集成测试）时发现，当前系统里**没有任何一条真实可用的路径能让一个普通租户用户
> 完成注册并登录**——不是这条任务本身的 bug，是登录/注册这条业务线在数据库 schema 设计阶段和
> 应用代码实现阶段用了两套互不兼容的身份模型，从未被真正打通过。本文档只覆盖**数据库侧**需要
> 评审的设计决策；应用代码侧（`SupabaseAuthProvider` 等 TS 改动）的设计与实施计划见
> `docs/01-architecture/ADR/015-auth-identity-bridge.md`，两份文档配套阅读。

---

## 一、问题现状：两套身份模型互不相认

`users` 表（V2.1 全量脚本第 126 行）的设计：

```sql
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'OPERATOR',
    is_system_user BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, username)
);
```

这是一张**为自建用户名密码认证设计的表**：`id` 自己生成，不引用 `auth.users(id)`；有自己的
`password_hash`；**没有 `email` 列**。

但应用代码（`SupabaseAuthProvider`）从头到尾都是围着 **Supabase Auth**（`auth.users`/GoTrue）写的：
`signInWithPassword`/`signUp`/`auth.getUser(token)`，隐含假设 `auth.users.id` 就是 `public.users.id`。
全仓库没有任何 `handle_new_user` 一类的触发器把两张表接起来。

`docs/01-architecture/ADR/ADR-001-multi-tenant-rls.md` 里其实写明了设计意图——"兼容 Supabase Auth (JWT)
与自建用户表两种认证模式"，`fn_current_tenant_id()` 的取值顺序是：①优先读 JWT
`request.jwt.claims.app_metadata.tenant_id`；②回退按 `auth.uid()` 查 `users` 表。但应用代码里这两条
路径都没有被正确实现（详见配套 ADR 文档的根因分析），所以即使真的注册成功，RLS 也解析不出这个
用户的租户，业务查询会被判定为"无租户上下文"。

**本文档的目标**：把身份模型统一到 Supabase Auth 一侧（即选定 ADR 文档中的"方案 A"），让
`fn_current_tenant_id()` 的两条既定取值路径都能被正确满足，不需要改动 RLS 函数本身。

## 二、设计决策：`public.users` 与 `auth.users` 如何桥接

### 2.1 `id` 列的处理

将 `public.users.id` 的定义从 `DEFAULT uuid_generate_v4()` 改为**直接引用 Supabase Auth 分配的
`auth.users.id`**（`REFERENCES auth.users(id) ON DELETE CASCADE`，不再自带默认生成器）。这样
`fn_current_tenant_id()` 的回退路径（按 `auth.uid()` 查 `users` 表）天然成立，不需要额外维护一份
映射表。

### 2.2 新增 `email` 列

`users` 表新增 `email VARCHAR(255)`。**开放问题**：是否需要 `UNIQUE` 约束、是否需要跨租户唯一
（同一邮箱能否属于多个租户的不同账号）——见第六节待确认问题。

### 2.3 `password_hash` / `username` 的处理

登录密码校验交给 Supabase Auth（`auth.users` 内部管理，应用侧不再接触明文/哈希），
`password_hash NOT NULL` 这个约束需要放开（改可空或整列废弃）。**开放问题**：`username` 是否保留
作为"显示名"用途，还是也一并废弃改用 `email`——见第六节。

### 2.4 新增 `handle_new_user` 触发器（自助注册闭环）

在 `auth.users` 上挂 `AFTER INSERT` 触发器，触发时机是 Supabase Auth 完成 `signUp` 之后。触发器
需要完成：

1. 在 `public.users` 插入一行，`id` = 新增的 `auth.users.id`，`email` 回填。
2. **自助注册场景**（用户注册时没有提供邀请码/已有租户上下文）：同时在 `tenants` 表新建一个
   租户，把这个新用户设为该租户的管理员角色（`role`/`user_roles` 按现有 RBAC 表结构关联到
   "租户管理员"角色）。
3. 通过 Supabase Admin API（`auth.admin.updateUserById`）把新建的 `tenant_id` 写入这个用户的
   **`app_metadata`**（不是 `user_metadata`——这是当前 `SupabaseAuthProvider.signUp()` 代码里
   写错位置的那个字段，`app_metadata` 用户自己改不了，`fn_current_tenant_id()` 读的也是这个）。
   这一步是 Postgres 触发器还是应用层在 `signUp` 之后异步调用 Admin API 完成，是个需要评审的
   实现选择，见第六节。

**开放问题（本节最关键、需要产品/DBA 一起拍板）**：自助注册时新租户怎么命名？如果两个用户在
注册表单里都填了同一个租户名（比如都填"默认仓库"），是允许重名、自动加后缀去重、还是报错要求
改名？这是一个业务规则问题，不是技术实现细节，本文档不代为决定,见第六节。

### 2.5 与 `fn_current_tenant_id()` 的对应关系

`fn_current_tenant_id()`（V2.1 脚本第 1759-1786 行）本身**不需要任何改动**——2.1～2.4 的设计目标
就是让它现有的两条取值路径（JWT `app_metadata.tenant_id` 优先，`users` 表 `auth.uid()` 回退）都能
被正确满足。这是选择"方案 A"而非"自建认证体系"的核心理由：不用碰 RLS 层，改动面更小、风险
更可控。

## 三、不在本次范围内

- **不新建 Tenant API 应用**（`src/apps/tenant-api` 的 HTTP 路由、前端登录/注册页面）——按项目负责人
  确认，本轮只解决数据库侧的身份模型桥接问题，Tenant API 的路由设计与实现留到后续单独排期。
- **不处理现有 `public.users` 里可能已存在的种子/测试数据**如何迁移到新模型——这属于第六节的
  开放问题，需要先确认现状（是否已有生产数据）才能定迁移策略，本文档不假设答案。

## 四、验证计划（供未来 DDL PR 使用，本文档本身不含可执行 SQL）

未来编写 `unWMS_Auth_Identity_Bridge_V1.sql` 时（由 DBA 团队在 `.readonly/` 体系下产出），除了
`.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 的通用 9 条，还需要针对本次改动额外验证：

- [ ] 触发器测试：调用 Supabase Auth `signUp()` 后，`public.users` 是否确实出现对应行、
      `tenants` 是否新建、`app_metadata.tenant_id` 是否正确写入（用 `auth.admin.getUserById` 核实，
      不能只看 `public.users` 表）。
- [ ] `fn_current_tenant_id()` 用真实注册产生的 JWT 实测一次，确认两条取值路径（JWT 优先 /
      `users` 表回退）在去掉其中一条的情况下，另一条仍能独立生效。
- [ ] 现有 `admin-api` 超管登录路径（`SupabaseAuthProvider.signIn` → `isPlatformAdmin` 检查）改动
      前后各跑一遍回归，确认平台超管账号（如果已存在于 `public.users` 而不在 `auth.users`）的
      处理方案已在第六节问题 3 确认后落地，不能默认"顺带兼容"。
- [ ] `UNIQUE(tenant_id, username)` 约束调整后（如果 username 保留），确认不会因为多个自助注册
      租户使用相同默认 username 而冲突。

## 五、部署检查清单补充

- 触发器上线前，需要确认 Supabase 项目的 `auth.users` 是否已有历史数据（如果这是全新项目则没有
  存量问题；如果已有测试/演示账号，需要一次性回填脚本，不在本设计文档编写范围内，属于第六节
  待确认事项）。

## 六、待确认的开放问题（需要产品/DBA/项目负责人拍板，本文档不代为决定）

1. **`email` 列是否需要唯一约束、是否跨租户唯一？** 影响触发器/注册逻辑的冲突处理方式。
2. **自助注册时新租户重名如何处理？**（拒绝 / 自动加后缀 / 允许重名）—— 纯业务规则，非技术问题。
3. **现有 `public.users` 里是否已有生产或重要测试数据（比如已手工建的平台超管账号）？**
   如果有，这些账号当前只存在于 `public.users`、不在 `auth.users`，方案 A 落地后无法直接登录，
   需要一次性迁移（在 Supabase Auth 侧用 Admin API 重新创建对应账号并关联）。这一步需要先由
   项目负责人确认现状，再决定是否需要迁移脚本、迁移时间窗口。
4. **`username` 列去留**：完全废弃改用 `email` 登录，还是保留作为"显示名"（与登录无关）？
5. **触发器 vs 应用层：`app_metadata.tenant_id` 的写入放在 Postgres 触发器里（需要 `pg_net`/
   HTTP 扩展调用 Supabase Admin API，或者用 Supabase 的 Auth Hooks 机制），还是放在应用层
   `signUp()` 成功后紧接着异步调用一次 Admin API？** 两种实现各有维护成本和一致性风险
   （触发器方式更强一致但依赖数据库能直接调用外部 API；应用层方式实现简单但存在"Auth 建号
   成功、Admin API 调用失败"的中间态需要处理），这是一个需要评审的技术选型问题。

## 七、后续流程

本文档评审通过后，涉及 `.sql` 的实际 DDL 编写与提交，按项目约定属于**独立于开发团队应用代码
任务的一条单独流程**：需产出配套 `unWMS_Auth_Identity_Bridge_V1.sql`，并按
`.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 逐条自查、附验证证据后再提交 PR，
不与本 ADR「实施计划」里的应用代码步骤（第 3 项）混在同一个 PR 里。
