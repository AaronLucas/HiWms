# PR Review: #75 — feat(tenant-api): 接入登录路由 + 自助/管理员密码管理（ROADMAP 6.2 + 5.4）

**Reviewed**: 2026-08-02
**Author**: AaronLucas
**Branch**: feat/tenant-api-auth-routes → main
**Decision**: APPROVE

## Summary
三个新增路由质量良好：方案 B 登录路由正确放在 tenant-api 挂载点（未经认证，限流+校验覆盖完整），自助改密码路由放在 `apiRouter` 内（有 `authenticate()` 保护），管理员重置密码路由放在 `adminRouter` 内（有 `isSystemUser` 门禁）。zod schema 新增符合项目既有模式，集成测试覆盖了登录→改密码→验证新旧密码互换生效的完整链路。

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
1. **`auth.http.test.ts:11` — 未使用的 `afterAll` 导入**。测试体中没有 `afterAll` 调用，可以从 import 中移除。
2. **`admin-api/main.ts:149-150` — 密码长度校验在路由内手写 `typeof` 判断，没有用 zod**。tenant-api 的 `/users/me/password` 用 `changePasswordBodySchema` 做 zod 校验，这里用内联手写逻辑，两个 App 对同一操作（改密码）的校验方式不一致。建议在 admin-api 彻底重构时统一（Sprint 5 5.2），不作为本次 PR 的阻塞项。

### LOW
1. **Login 路由的 catch 分支（`main.ts:52`）捕获异常后没有日志**——生产排障时看不到具体失败原因。admin-api 的 login 路由有同样的问题，建议在 Sprint 5 统一补上。不影响本次合并。

## Validation Results

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Auth integration tests | 2/2 Pass |
| Tenant-api regression | 32/32 Pass |
| Admin-api regression | 1/1 Pass |

## Files Reviewed
| File | Type |
|---|---|
| `src/__tests__/integration/tenant-api/auth.http.test.ts` | Added |
| `src/apps/admin-api/main.ts` | Modified (+16) |
| `src/apps/tenant-api/main.ts` | Modified (+25) |
| `src/apps/tenant-api/routes.ts` | Modified (+16) |
| `src/apps/tenant-api/validation.ts` | Modified (+18) |
