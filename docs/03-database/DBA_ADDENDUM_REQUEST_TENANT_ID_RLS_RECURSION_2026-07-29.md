# DBA Addendum 请求 —— `fn_current_tenant_id()` 回退路径触发 `users` 表 RLS 无限递归（CRITICAL）

> **性质**：应用团队在真实本地环境实测复现的运行时 CRITICAL 缺陷，不修改任何
> `.sql` 文件——`fn_current_tenant_id()` 的权威定义在 DBA 团队管理的
> `HiWmsSupabase` 仓库（本仓库 `supabase/` 整个目录被 gitignore）。
>
> **触发背景**：本次是在验证迁移 024/025/026（issue #56/#55/#54）落地效果时，
> 用真实 Supabase Auth API 走完整注册流程首次发现——024/025/026 三份迁移**本身
> 没有问题**，是它们第一次让"真实用户注册成功、且 JWT 里暂时没有
> `app_metadata.tenant_id`"这个场景在本地环境里真实可达，从而暴露了一个更早
> 存在、此前从未被实际执行路径触发过的旧缺陷。

## 问题描述

`fn_current_tenant_id()`（当前生效定义：`022_security_hardening_batch3.sql:214-245`，
最初定义：`001_enterprise_core_schema.sql:1759-1786`，两处回退逻辑相同）的实现：

```sql
CREATE OR REPLACE FUNCTION fn_current_tenant_id()
RETURNS UUID AS $$
DECLARE
    v_claim TEXT;
    v_tenant_id UUID;
BEGIN
    -- 优先从 JWT app_metadata 中读取
    BEGIN
        v_claim := current_setting('request.jwt.claims', true)::json -> 'app_metadata' ->> 'tenant_id';
    EXCEPTION WHEN OTHERS THEN
        ...
        v_claim := NULL;
    END;

    IF v_claim IS NOT NULL THEN
        RETURN v_claim::UUID;
    END IF;

    -- 回退：按当前登录用户 (auth.uid()) 在 users 表中查其所属租户
    BEGIN
        SELECT tenant_id INTO v_tenant_id
        FROM users
        WHERE id = auth.uid();
        RETURN v_tenant_id;
    EXCEPTION WHEN OTHERS THEN
        ...
        RETURN NULL;
    END;
END;
$$ LANGUAGE plpgsql STABLE;
```

而 `001_enterprise_core_schema.sql:1792-1817` 的批量 RLS 建策略 `DO` 块里，
`users` 表本身也在被套用通用策略的表清单内（`:1796-1797` 数组第一项即为
`'users'`）：

```sql
CREATE POLICY tenant_isolation ON users
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());
```

**这构成了一个自引用死循环**：

1. 任意查询命中 `users` 表（或任何依赖 `fn_current_tenant_id()` 的表，只要该表
   当前不是空表）→ Postgres 需要对匹配到的行求值 RLS 谓词 → 调用
   `fn_current_tenant_id()`；
2. 该函数 JWT 路径为空（新注册用户的 `app_metadata.tenant_id` 按 ADR-015/
   Issue #54 设计是应用层异步写入的，注册完成的第一时间必然为空）→ 走回退
   路径 `SELECT tenant_id FROM users WHERE id = auth.uid()`；
3. 这条 `SELECT ... FROM users` 本身又要对 `users` 表求值同一条 `tenant_isolation`
   策略 → 再次调用 `fn_current_tenant_id()` → 回到第 2 步；
4. 无限递归，直到撞上 Postgres 的 `max_stack_depth` 限制，抛出
   `stack depth limit exceeded`（SQLSTATE `54001`）。

`022_security_hardening_batch3.sql:239-243` 加过的 `EXCEPTION WHEN OTHERS` +
`RAISE WARNING` 只能捕获*单次*调用失败并记日志，无法阻止递归本身——从实测
日志看，这个异常处理反而让问题表现为**大量重复 WARNING 后耗尽连接**，而不是
一次干净的报错，进一步加长了排障链路。

## 复现步骤（已在本地 `supabase start` + `db reset`，含真实 `auth` schema 的环境实测，非推断）

1. 应用 001-026 全部迁移（`019` 因 `CREATE INDEX CONCURRENTLY` 与本地事务化
   迁移不兼容，按既有约定本地/CI 跳过，与本问题无关）。
2. 通过真实 Auth API 完成一次注册（未接入 wms7 应用层路由，直接调 GoTrue
   REST 接口，效果等价于 `SupabaseAuthProvider.signUp()`）：
   ```bash
   curl -X POST "$API_URL/auth/v1/signup" -H "apikey: $ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"email":"authtest@example.com","password":"Test1234!","data":{"company_name":"测试公司ABC","username":"tester1"}}'
   ```
   返回 200，`access_token` 正常签发（本地默认自动确认邮箱）。
3. 验证触发器链路本身完全正确（`handle_new_user` → 024 的
   `fn_provision_tenant_defaults` 联动全部符合预期，这部分**没有问题**）：
   - `public.users` 生成对应行（`tenant_id`/`username`/`email`/`role='ADMIN'` 均正确）
   - `public.tenants` 生成对应新租户（名称取自 `company_name`）
   - `role_permissions` 挂了 22 项权限，`check_user_permission(user_id, 'orders', 'CREATE')` 返回 `true`
4. 用第 2 步拿到的 `access_token`（`authenticated` 角色，JWT `app_metadata` 为空，
   符合注册后 `app_metadata.tenant_id` 尚未被应用层异步写入的正常时序）发起
   一次最基础的查询：
   ```bash
   curl "$API_URL/rest/v1/users?select=id,tenant_id,username,email" \
     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN"
   ```
   返回：
   ```json
   {"code":"57014","details":null,"hint":null,
    "message":"canceling statement due to statement timeout"}
   ```
   HTTP 500。同一 token 查 `tenants` 表（`anon` 角色同样复现）结果一致。
5. 用 `psql` 直连、显式设置 3 秒 `statement_timeout` 复现根因（而非仅仅是网关
   超时）：
   ```sql
   BEGIN;
   SET LOCAL statement_timeout = '3s';
   SET LOCAL role authenticated;
   SET LOCAL request.jwt.claims = '{"sub":"<user_id>","role":"authenticated","app_metadata":{}}';
   SELECT count(*) FROM users;
   ROLLBACK;
   ```
   输出：246 条 `WARNING: fn_current_tenant_id(): 无法从 users 表读取租户标识
   (auth.uid() 可能不可用) — stack depth limit exceeded (SQLSTATE: 54001)` /
   `无法从 JWT claims 读取租户标识 — stack depth limit exceeded`交替出现，
   PL/pgSQL 调用栈显示同一条 `SELECT tenant_id FROM users WHERE id = auth.uid()`
   语句反复嵌套数百层，最终因 3 秒超时被中止。

**对照组（证明不是环境问题，是该特定递归路径的问题）**：同一 token 查询
`orders`（该新租户下无任何订单、物理空表）返回 `200 []`，正常——因为空表
扫描无需对任何行求值 RLS 谓词，从未真正触发 `fn_current_tenant_id()` 的回退
分支。这也解释了为什么这个缺陷至今没被发现：只要业务表是空的，或者查询走的
是 `service_role`（RLS 天然绕过，此前全部 DB 并发/集成测试都是这么跑的），
这条递归路径永远不会被执行到。

## 影响范围

- **触发条件**：`authenticated`（或 `anon`）角色发起的、JWT `app_metadata` 里
  没有 `tenant_id` 的请求，只要命中 `users`/`tenants` 或其余 26 张套用
  `tenant_isolation` 策略的表中**任意一张非空表**，即会触发递归崩溃，不限于
  刚注册的新用户——**任何现有账号只要其会话 JWT 恰好没带
  `app_metadata.tenant_id`（例如 Admin API 建号未补写、或补写失败，见
  Issue #54 回复里"已知限制"一节提到的时序依赖），都会命中同一个坑**。
- **业务影响**：不是"功能降级"，是**请求直接 500/超时崩溃**，且报错信息
  （`statement timeout`）对前端/运维完全不指向根因，排障成本高。这条链路是
  Issue #54（`auth.users → public.users` 触发器）落地后，注册用户能否正常使用
  系统的**最后一环**——数据库侧建号、挂权限全部正确，但用户建好号后几乎无法
  查询任何自己的数据。
- **不是本次三份迁移（024/025/026）引入的新问题**，是 001/022 就存在的既有
  缺陷；只是在此之前没有任何真实执行路径能触发它（旧的注册链路本身就是断的，
  见 Issue #54 背景），024/025/026 落地后这条路径第一次变得可达。
- 已确认**不是安全问题**（不会导致跨租户越权——失败模式是拒绝/崩溃而不是
  放行），纯粹是可用性/稳定性问题，但严重到会让 Issue #54 交付的注册功能
  实质不可用。

## 请求

请 DBA 团队修复 `fn_current_tenant_id()` 的回退路径，使其不再触发对
`users` 表自身 RLS 策略的递归求值。可能的方向（供参考，具体方案由 DBA 判断）：

1. 回退路径改用 `SECURITY DEFINER` 的辅助函数读取 `users.tenant_id`（绕过
   `users` 表 RLS，函数内部逻辑单纯、攻击面可控——类似本次 024/026 里
   `fn_provision_tenant_defaults`/`handle_new_user` 已经采用的模式）；或
2. 在查询 `users` 时显式加 `SET LOCAL row_security = off`（仅在这一条内部
   查询范围内生效，同样需要评估权限模型是否允许 `fn_current_tenant_id()`
   本身具备读取任意用户 `tenant_id` 的能力——它本来就需要这个能力才能完成
   自己的职责，只是不应该经过会递归回自己的 RLS 通道）。

## 处理建议

**建议按 CRITICAL 优先级处理，且应视为 Issue #54（登录/注册身份桥接）功能性
可用的前置阻塞项**——024/025 可以独立于本问题正常推进，但 026
（`handle_new_user` 触发器）对应的注册链路在本问题修复前，新用户注册成功后
无法正常使用系统，不建议在此之前把 wms7 侧的注册路由接入生产。

**关联文档**：`docs/01-architecture/ADR/015-auth-identity-bridge.md`、
`docs/03-database/DBA_ADDENDUM_REQUEST_AUTH_IDENTITY_BRIDGE_2026-07-27.md`
（Issue #54 原始请求）、HiWmsSupabase Issue #54/#55/#56 处理评论（2026-07-29）。
