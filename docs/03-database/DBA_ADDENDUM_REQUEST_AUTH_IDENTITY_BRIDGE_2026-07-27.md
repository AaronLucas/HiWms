# DBA Addendum 请求 —— 登录/注册身份模型桥接 schema 缺口（2026-07-27）

> **性质**：新功能使能请求，不是对已有迁移的缺陷复核。
> **只读请求**——本文档不修改、不触碰 `HiWmsSupabase` 仓库任何文件，具体 DDL
> 由 DBA 团队编写。本文档也不预设任何未决业务规则的答案（见下方「未决问题」
> 一节），仅提出功能需求与技术背景。
>
> **背景（这个缺口是怎么被发现的）**：开发团队在推进
> `docs/03-database/REPOSITORY_ROADMAP.md`「剩余缺口清单」排期任务 #5
> （补充以 `authenticated` 角色调用的集成测试）时，发现系统里没有一条真实可用
> 的路径能让普通租户用户完成注册并登录。深入排查后确认这是"登录/注册"整条
> 业务线的架构层面身份模型分裂问题，原始排查记录见
> `docs/01-architecture/BUG_REPORT_AUTH_TENANT_ISOLATION_2026-07-20.md`，
> 完整根因分析与决策见 `docs/01-architecture/ADR/015-auth-identity-bridge.md`
> （ADR-015，问题 3），数据库侧详细设计草案见
> `docs/03-database/AUTH_IDENTITY_BRIDGE_DESIGN_V1.md`。本文档是把这份设计
> 草案正式提交给 DBA 团队评估的请求文档，三份文档配套阅读。

---

## 背景问题：`public.users` 与 Supabase Auth（`auth.users`）是两套不兼容的身份模型

`.readonly/unWMS_Full_Init_Schema_V2.1.sql` 第 126 行 `users` 表的设计：

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

`id` 自带 `uuid_generate_v4()` 默认值、不引用 `auth.users(id)`；表内是自建的
`username`+`password_hash`；**没有 `email` 列**——这是为自建用户名密码认证
设计的表。但应用代码（`SupabaseAuthProvider`）全部基于 Supabase Auth
（`signInWithPassword`/`signUp`/`auth.getUser(token)`）编写，隐含假设
`auth.users.id` 等于 `public.users.id`。**全仓库没有任何 `handle_new_user`
一类的触发器把两张表接起来。**

结果：即使 `signUp()` 被正确接上路由调用成功，`public.users` 里也不会自动
出现对应行；`fn_current_tenant_id()`（`.readonly/unWMS_Full_Init_Schema_V2.1.sql`
第 1759-1786 行）的取值路径——①优先读 JWT `app_metadata.tenant_id`，
②回退按 `auth.uid()` 查 `users` 表——两条路径都因为这个断链而永远拿不到值。
注册"成功"但账号功能性锁死，`authenticated` 角色的任何业务查询都会被判定为
"无租户上下文"。

**应用层代码侧的改动**（`IAuthProvider`/`SupabaseAuthProvider`/
per-request authenticated Supabase client 等）**已经在开发团队这边完成**，
不需要 DBA 改动；本文档只涵盖数据库侧需要 DBA 团队评估实施的部分。

---

## 请求 1：`public.users.id` 列定义调整为引用 `auth.users(id)`，新增 `email` 列

**对应现有表**：`users`（`.readonly/unWMS_Full_Init_Schema_V2.1.sql` 第 126 行）

**需求**：按 `docs/03-database/AUTH_IDENTITY_BRIDGE_DESIGN_V1.md` §2.1-2.3 的
设计，将身份模型统一到 Supabase Auth 一侧，让 `fn_current_tenant_id()` 的回退
取值路径（按 `auth.uid()` 查 `users` 表）天然成立，不需要额外维护一份映射表。

**请求的修复方向**：
```sql
-- id 列：不再自带 uuid_generate_v4() 默认值，改为直接引用 auth.users(id)
-- ALTER TABLE users ALTER COLUMN id DROP DEFAULT;
-- ALTER TABLE users ADD CONSTRAINT users_id_fk_auth_users
--   FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 新增 email 列
-- ALTER TABLE users ADD COLUMN email VARCHAR(255);

-- password_hash 约束放开（是否整列废弃见「未决问题」#4）
-- ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
```
以上仅为示意方向，具体 DDL 语法、是否需要分步迁移（存量数据处理见「未决问题」
#3）、`email` 是否加唯一约束（见「未决问题」#1）均由 DBA 团队按评审结论决定。

**是否需要 RLS/GRANT 复核**：`users` 表现有 RLS 策略（若有）在 `id` 列语义
变化后是否仍然成立，请一并确认。

---

## 请求 2：新增 `handle_new_user` 触发器（自助注册闭环）

**背景**：产品侧已确认租户注册模式为**自助注册**（用户可自行注册并创建新
租户，无需邀请码），见 ADR-015「决策」章节。当前没有任何机制在用户完成
Supabase Auth 注册后，把对应的 `public.users` 行、新租户、租户管理员角色
自动建立起来。

**需求**（按 `docs/03-database/AUTH_IDENTITY_BRIDGE_DESIGN_V1.md` §2.4）：
在 `auth.users` 表挂一个 `AFTER INSERT` 触发器，完成：

1. 在 `public.users` 插入对应行（`id` = 新增的 `auth.users.id`，`email` 回填）。
2. **自助注册场景**：同时在 `tenants` 表新建一个租户，把这个新用户设为该
   租户的管理员角色（`role`/`user_roles` 按现有 RBAC 表结构关联到"租户
   管理员"角色）。
3. 把新建的 `tenant_id` 写入这个用户的 **`app_metadata`**（不是
   `user_metadata`——`app_metadata` 用户自己改不了，`fn_current_tenant_id()`
   读的也是这个字段），可通过 Supabase Admin API
   （`auth.admin.updateUserById`）或触发器内机制完成。

**需要 DBA 团队评估的技术选型（本文档不预设答案）**：第 3 步
"`app_metadata.tenant_id` 的写入"是放在 Postgres 触发器里（需要 `pg_net`/
HTTP 扩展调用 Supabase Admin API，或使用 Supabase Auth Hooks 机制），还是放
在应用层 `signUp()` 成功后紧接着异步调用一次 Admin API——这是
`AUTH_IDENTITY_BRIDGE_DESIGN_V1.md` 第六节开放问题 5，两种实现各有维护成本
和一致性风险（触发器方式更强一致但依赖数据库直接调用外部 API；应用层方式
实现简单但存在"Auth 建号成功、Admin API 调用失败"的中间态需要处理），需要
DBA 团队结合 HiWmsSupabase 项目现有的 Postgres 扩展/网络出站策略评估后再定，
本文档不预设答案。

---

## 未决问题：以下 5 项业务规则需要产品/DBA/项目负责人先拍板

以下问题原样引用自 `docs/03-database/AUTH_IDENTITY_BRIDGE_DESIGN_V1.md`
第六节，**这份 Addendum 只是提出功能需求和技术背景，不代为决定**——正式
迁移脚本必须等这 5 项确认后才能编写：

1. **`email` 列是否需要唯一约束、是否跨租户唯一？** 影响触发器/注册逻辑的
   冲突处理方式。
2. **自助注册时新租户重名如何处理？**（拒绝 / 自动加后缀 / 允许重名）——
   纯业务规则，非技术问题。
3. **现有 `public.users` 里是否已有生产或重要测试数据（比如已手工建的平台
   超管账号）？** 如果有，这些账号当前只存在于 `public.users`、不在
   `auth.users`，方案落地后无法直接登录，需要一次性迁移（在 Supabase Auth
   侧用 Admin API 重新创建对应账号并关联）。需要先由项目负责人确认现状，
   再决定是否需要迁移脚本、迁移时间窗口。
4. **`username` 列去留**：完全废弃改用 `email` 登录，还是保留作为"显示名"
   （与登录无关）？
5. **触发器 vs 应用层**：`app_metadata.tenant_id` 的写入放在 Postgres
   触发器里还是应用层 `signUp()` 之后异步调用 Admin API——见上方「请求 2」
   的技术选型说明，需要 DBA 团队评估后再定。

---

## 暂不请求的部分

- **应用层代码改动**（`IAuthProvider` 补充 `signIn`/`signUp` 声明、
  `SupabaseAuthProvider.signUp`/`signIn` 修正 `app_metadata` 写入位置与
  `tenantId` 断言、per-request authenticated Supabase client 等）——
  这部分已由开发团队完成（ADR-015 Sprint 0），不需要 DBA 改动。
- **Tenant API 应用本身**（`src/apps/tenant-api` 的 HTTP 路由、前端登录/
  注册页面）——按项目负责人确认，本轮不在范围内，留到后续单独排期；本次
  Addendum 只解决数据库侧的身份模型桥接问题，为其打地基。
- **现有 `admin-api` 超管登录路径的回归验证**——这是应用代码侧任务，
  数据库侧改动落地后由开发团队执行回归测试，不需要 DBA 额外操作（但需要
  「未决问题」#3 先确认超管账号现状，才能判断是否需要配合的数据迁移）。

---

## 处理建议

请 DBA 团队按 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 逐条自查
并附验证证据（2026-07-16 DBA 团队新增要求，涉及 `.sql` 的迁移类改动均需
遵循）。除通用条目外，建议针对本次改动额外验证：

- [ ] 触发器测试：调用 Supabase Auth `signUp()` 后，`public.users` 是否确实
      出现对应行、`tenants` 是否新建、`app_metadata.tenant_id` 是否正确写入
      （用 `auth.admin.getUserById` 核实，不能只看 `public.users` 表）。
- [ ] `fn_current_tenant_id()` 用真实注册产生的 JWT 实测一次，确认两条取值
      路径（JWT 优先 / `users` 表回退）在去掉其中一条的情况下，另一条仍能
      独立生效。
- [ ] 现有 `admin-api` 超管登录路径改动前后各跑一遍回归（依赖「未决问题」
      #3 先确认现状）。

两处 schema 请求（请求 1 的列调整 + 请求 2 的触发器）关联紧密，建议合并为
一次迁移评审，但具体是否拆分为多个迁移脚本由 DBA 团队按仓库既有迁移编号
规范决定。

**关联文档**：
- `docs/01-architecture/ADR/015-auth-identity-bridge.md`（ADR-015，完整
  根因分析与决策，含"方案 A vs 方案 B"对比）
- `docs/03-database/AUTH_IDENTITY_BRIDGE_DESIGN_V1.md`（数据库侧详细设计
  草案，§2.1-2.5 桥接设计、第六节开放问题清单）
- `docs/01-architecture/BUG_REPORT_AUTH_TENANT_ISOLATION_2026-07-20.md`
  （问题发现的原始排查记录）
- 待创建镜像 Issue（HiWmsSupabase 仓库）
