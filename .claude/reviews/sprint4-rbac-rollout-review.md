# Local Review: Sprint 4 — RBAC 全面接入 + 操作员签到 + config 一致性修复

**Reviewed**: 2026-07-28
**Branch**: docs/sprint4-planning (base: origin/main @ 84e02bf)
**Decision**: APPROVE (with comments)

## Summary

Sprint 4 任务 4.5/4.6：给 tenant-api 10 个端点 + device-api 15 个业务端点接入 RBAC
权限校验。过程中发现并修复了 3 个真实的、独立于本任务范围的生产级问题：① device-api
`issueTokenPair()` 接受 `userId` 参数但从未转发给 `issueAccessToken()`；② `publicAuthRoutes.ts`
签发 token 用硬编码 `jwtIssuer: 'hiwms'`，但 `DeviceAuthMiddleware` 验证用的是环境变量驱动的
`config.device.jwtIssuer`（未设置时默认 `'hiwms-device-api'`），两者不一致导致登录签发的
Bearer token 验证恒失败；③ `createDeviceApiApp(config)` 的 `config` 参数从未真正传给
`createDeviceApiDependencies()`，导致该函数内部重新独立 `loadDeviceApiConfig()`，是 ②
的根因。三处均已修复并有真实 HTTP 测试覆盖（不是仅代码审查）。新增操作员签到端点
`POST /device/auth/operator-checkin`，解决了"device-api 业务端点 RBAC 需要 userId，
但设备正常登录流程从不产生 userId"的架构性阻塞（此前在 Sprint 3 review 里被记录为
MEDIUM #2 遗留项，本次是刚好触发才处理，不是重新翻出来找茬）。

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

1. ~~**`POST /device/auth/operator-checkin` 存在基于响应时长的用户名枚举侧信道**~~
   **已修复**：查询未命中/用户未激活/无密码哈希时，现在会先对固定 dummy bcrypt hash
   跑一次 `verifyOperatorPassword`（结果丢弃）再返回 401，使"用户名不存在"与"用户名
   存在但密码错误"两条路径耗时基本一致。原发现：`username` 不存在时代码直接跳过
   bcrypt compare 直接 401，响应时长差异会暴露某个用户名在该租户下是否存在。

2. **`POST /device/auth/operator-checkin` 没有速率限制**（`src/apps/device-api/routes.ts`）：
   `ExpressMiddlewareFactory` 已有现成的 `rateLimit()` 中间件，但 device-api 的
   `main.ts` 从未对任何端点接入过它——这是一个既有缺口（login/refresh 同样没有），
   本次新增的 operator-checkin 端点继承了同样的暴露面，且它是一个新的密码校验端点，
   理论上可被用于暴力破解操作员密码。
   **建议修复**：给 `/device/auth/login`、`/device/auth/refresh`、
   `/device/auth/operator-checkin` 这三个凭证类端点统一接入 `rateLimit()`。
   **不阻塞合并的理由**：这是继承的既有缺口，不是本次改动新引入的回归，且超出本次
   "RBAC 接入"任务范围，适合单独排期。

### LOW
None.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass (0 errors) |
| Tests (`RUN_DB_CONCURRENCY_TESTS=true vitest run`) | Pass — 313 passed, 22 skipped, 0 failed |
| Build | Not run separately; tsc clean |
| Lint | Not run separately (no dedicated lint script invoked this pass) |

## Files Reviewed

- `src/apps/device-api/auth/device-credentials.ts`（Modified — `verifyOperatorPassword` 新增，`issueTokenPair` 哑参数修复）
- `src/apps/device-api/routes.ts`（Modified — operator-checkin 端点新增，15 处 `requireDevicePermission` 接入）
- `src/apps/device-api/publicAuthRoutes.ts`（Modified — jwtIssuer/jwtAudience 一致性修复）
- `src/apps/device-api/di.ts`（Modified — `createDeviceApiDependencies` 接受 config 参数）
- `src/apps/device-api/main.ts`（Modified — 透传 config）
- `src/apps/device-api/validation.ts`（Modified — `operatorCheckinSchema` 新增）
- `src/apps/tenant-api/routes.ts`（Modified — 10 处 `requirePermission` 接入）
- `package.json`/`pnpm-lock.yaml`（Modified — 新增 `bcryptjs` 依赖）
- `src/__tests__/integration/device-api/{auth,routes}.http.test.ts`（Modified — 操作员签到测试、RBAC 种子数据、config 修复）
- `src/__tests__/integration/tenant-api/{orders,orders-allocate,inventory,products}.http.test.ts`（Modified — 播种真实 RBAC 权限数据，改回 `isSystemUser: false`）
- 文档：`docs/00-project/{BACKEND_GAP_ANALYSIS,ECC_EXECUTION_PLAN,ROADMAP}.md`、`docs/02-api/API_SPEC.md`、`docs/03-database/{DB_SCHEMA,DBA_ADDENDUM_REQUEST_AUTH_IDENTITY_BRIDGE_2026-07-27}.md`（Sprint 4 规划 + RBAC 矩阵 + 一处大小写摘录订正）
