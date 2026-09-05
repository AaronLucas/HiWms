# WMS7 PDA 同步链路端到端黑盒验证 V1

> 日期：2026-09-05
> 方法：独立子会话（general-purpose）执行 council 裁决要求的"黑盒验证 PDA 同步链路
> 死活"——通过真实 HTTP 请求走完整 device-api 认证链路，不绕过认证、不直接调用
> 数据库函数。只验证，不修复任何代码。

---

## 结论：链路确认死亡，且失效点比此前三份分析预判的更早、更彻底

之前的怀疑是"`sync_events` 提交后卡在 PENDING/SKIPPED"。**真实端到端测试发现失效点更靠前**：
设备认证成功之后，**任何**受保护端点都会被 `DeviceAuthMiddleware` 里对 `tenants` 表的
RLS 保护查询统一拦截，返回 `403 Invalid or inactive tenant`——即使传入的是货真价实、
`is_active=true` 的租户。一次真实的 PICK 同步事件提交在这一步就被拒绝，`sync_events`
表里从未产生对应记录，根本谈不上"卡在 PENDING"，它连数据库这一步都没到。

---

## 复现步骤

环境：本地 Docker Postgres（容器 `supabase_db_hiwms-supabase`），迁移+权限脚本已应用。

1. **准备测试数据**（仅测试数据，未改动 `src/` 任何生产代码）：建测试租户
   （`is_active=true`）、建测试设备（用与 `device-credentials.ts::generateApiKey()`
   相同的 argon2id 参数生成 API Key）、用 Supabase Auth Admin API 建操作员账号并赋权。

2. **启动 device-api**：`npx tsx src/apps/device-api/main.ts`，`GET /health` → 200 ok。

3. **真实 HTTP 请求序列**：
   - ① `POST /api/device/device/auth/login`（真实凭证）→ **200**，拿到真实 HS256
     device token（iss=hiwms-device-api, aud=hiwms-devices, tenant_id 正确）——
     **设备登录本身是活的**。
   - ② `POST /api/device/auth/operator-checkin`（带①的 token）→
     **`403 {"error":"Invalid or inactive tenant"}`**。
   - ③ 换 `X-API-Key` 认证重试任意受保护端点（`GET /api/device/sync/policy`）→
     同样 **403**——证明不是 JWT 特有问题，是认证方式无关的统一步骤。
   - ④ `POST /api/device/sync/events`（提交真实 PICK 事件）→ 同样 **403**。
     查库确认：`SELECT * FROM sync_events WHERE id='...'` **返回 0 行**——事件
     从未写入。

---

## 根因（精确到代码行）

`DeviceAuthMiddleware.ts:188-192` 认证成功后统一调用：
```ts
const isValidTenant = await tenantResolver.validateTenant(tenantId);
if (!isValidTenant) return res.status(403).json({ error: 'Invalid or inactive tenant' });
```

`SupabaseTenantResolver.validateTenant()`（`.ts:111-124`）：
```ts
async validateTenant(tenantId, authToken?) {
  const { data } = await this.getClient(authToken)  // authToken 未传 → 匿名客户端
    .from('tenants').select('id, is_active').eq('id', tenantId).single();
  ...
}
```

`tenants` 表启用 RLS（`tenant_id = fn_current_tenant_id()`）。匿名请求下
`fn_current_tenant_id()` 恒为 NULL（既无 JWT claim 也无 `auth.uid()`），查询被 RLS
完全过滤（用 anon key 直接查 PostgREST 验证：`GET /rest/v1/tenants?id=eq.<真实存在
的租户ID>` → `200 []`）。于是 `validateTenant()` 对**任何**租户都返回 `false`，
`DeviceAuthMiddleware` 对**任何**已认证设备的**任何**受保护请求都返回 403。

**这个 bug 独立于此前 Track A-1 讨论的"authToken 贯通"问题，是一个更早期、更根本
的断点**——`validateTenant()` 做的是"系统级校验租户是否存在/激活"，理应用 admin
client（service_role），而不是受限于用户 RLS 的匿名客户端。

---

## 分层验证：即便绕过①处的403，链路后面还有两道独立的同款拦截

静态代码交叉核实（未修改代码，仅读取当前数据库里已生效的函数定义）：

- **第二道**：`SupabaseSyncEventRepository.applyEvent()` 调用
  `this.rpcClient.raw('fn_apply_sync_event', {...})`，同样未传 authToken，走匿名
  客户端。当前生效的 `fn_apply_sync_event`（"第四轮"修复版，已移除 NULL-租户
  fail-open 分支）要求 `tenant_id = fn_current_tenant_id()` 硬性相等，匿名会话下
  恒为 NULL，事件永远匹配不上，返回 `SKIPPED_NOT_PENDING`，状态永远停在 PENDING。
- **第三道**：`fn_apply_pick_action` 入口有 `v_user_id := fn_current_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION` —— 同样必然触发。

即：认证中间件、事件分发函数、具体动作函数——**三层各自独立地**假设"应该有一个
真实 Supabase 会话"，而 device-api 的整条调用链上从未产生过这样一个会话。当前
数据库里 `sync_events` 状态分布（PENDING=125, EXCEPTION=14, APPLIED=7,
REJECTED=7，共153条既有数据）与"事件普遍卡住/异常"的图景一致。

---

## 影响范围

不只是 `/sync/events`。**任何**需要设备认证的端点都同源受阻：`/sync/events`、
`/sync/policy`、`/auth/operator-checkin`、`/putaway`、`/count`、`/pack`、
`/tasks/:id/claim` 等全部受影响。这印证了此前技术诊断"需要全仓库范围普查条件式
租户防护"的判断——DBA"第四轮"权限加固是硬性收紧，不只影响 sync_events 这一处。

---

## 本次验证的操作记录

未修改 `src/` 下任何生产代码，仅创建/清理测试用的租户/设备/操作员账号（已在
数据库清理，遗留一条因子表触发合规冻结无法级联删除、已标记 `is_active=false`
的空壳测试租户）。

**关键文件位置（供复核）**：
- `src/apps/device-api/DeviceAuthMiddleware.ts:188-192`
- `src/adapters/supabase/auth/SupabaseTenantResolver.ts:15-19, 111-124`
- `src/adapters/supabase/SupabaseClient.ts:130-165`（`getClient()`/`getAdminClient()`/
  `getAuthenticatedClient()` 三者区别）
- `src/adapters/supabase/repositories/SupabaseSyncEventRepository.ts:69-134`
- `src/adapters/supabase/rpc/SupabaseRpcClient.ts:126-137`
- 数据库函数 `fn_apply_sync_event`、`fn_apply_pick_action`、`fn_current_tenant_id`
  （当前生效版本）
