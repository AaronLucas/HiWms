# PR Review: #60 — Sprint 4 RBAC 全面接入 + 操作员签到 + Sprint 0-3 后规划文档

**Reviewed**: 2026-07-28
**Author**: AaronLucas
**Branch**: docs/sprint4-planning → main
**Decision**: COMMENT（draft PR，按规则不使用 approve/request-changes）

## Summary

本 PR 起初只是 Sprint 0-3 合并后的 ECC 六维度复核 + Sprint 4-6 规划文档，随后在同一分支
上追加了 Sprint 4 任务 4.4-4.6 的实际实现：RBAC 覆盖矩阵设计、给 tenant-api 10 个端点 +
device-api 15 个业务端点接入权限校验，以及为解决"device-api 业务端点需要 user_id 才能做
RBAC 校验，但设备正常登录流程从不产生 user_id"这一架构性阻塞而新增的
`POST /device/auth/operator-checkin` 端点。过程中额外发现并修复了 3 个独立于本任务范围的
真实生产级问题（详见下方 HIGH 分类下的历史记录，均已修复，不再是遗留问题）。本地
`/ecc:code-review`（Local Review Mode）已跑过一轮，产出 `.claude/reviews/sprint4-rbac-rollout-review.md`；
本次 PR Review Mode 复核结论与之一致，未发现新增问题。

## Findings

### CRITICAL
None.

### HIGH
None remaining。以下 3 处曾是真实缺陷，均已在本 PR 内修复并有真实 HTTP 测试回归覆盖：

1. `issueTokenPair()`（`device-credentials.ts`）接受 `userId` 参数但从未转发给
   `issueAccessToken()`——已修复为正确转发。
2. `publicAuthRoutes.ts` 签发 token 用硬编码 `jwtIssuer: 'hiwms'`，但
   `DeviceAuthMiddleware` 验证用的是环境变量驱动的 `config.device.jwtIssuer`
   （`DEVICE_JWT_ISSUER` 未设置时默认 `'hiwms-device-api'`），两者不一致会导致
   任何真实部署环境下登录签发的 Bearer token 验证恒 401——已修复为统一读取
   `deps.config.device.jwtIssuer/jwtAudience`。
3. `createDeviceApiApp(config)` 的 `config` 参数从未真正传给
   `createDeviceApiDependencies()`（该函数内部无条件重新 `loadDeviceApiConfig()`），
   是第 2 项的根因——已修复为透传 `config`。

### MEDIUM

1. ~~operator-checkin 端点响应时长枚举用户名侧信道~~ **已在本 PR 内修复**：
   用户不存在/未激活/无密码哈希时，现在会先对固定 dummy bcrypt hash 跑一次比对
   再返回 401，消除耗时差异。
2. **operator-checkin（以及既有的 login/refresh）没有接入 `ExpressMiddlewareFactory.rateLimit()`**：
   该中间件已存在但从未被 device-api 使用，属于既有缺口，非本 PR 引入的回归。
   建议后续单独排期，给这三个凭证类端点统一接入限流。

### LOW
None.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass（本地 + CI 均 0 错误） |
| Lint | Pass（CI `Lint & TypeCheck` job） |
| Tests | Pass（本地 `RUN_DB_CONCURRENCY_TESTS=true vitest run`：313 passed / 22 skipped / 0 failed；CI `Unit Tests`/`DB Migrations + Concurrency Tests` 均 pass） |
| Build | Pass（CI `Build` job） |

GitHub Actions 全部 5 个 job（Lint & TypeCheck / Unit Tests / Build / CI Success /
DB Migrations + Concurrency Tests）均为 pass，`mergeStateStatus: CLEAN`，
`mergeable: MERGEABLE`。

## Files Reviewed

23 个改动文件（详见 `gh pr diff 60 --name-only`），已在本地 review 中逐一读取完整
diff 上下文：核心变更集中在 `src/apps/device-api/{routes,di,main,publicAuthRoutes,
validation,auth/device-credentials}.ts`、`src/apps/tenant-api/routes.ts`，配套 6 个
集成测试文件更新，以及 5 份规划/设计文档 + `package.json`/`pnpm-lock.yaml`（新增
`bcryptjs` 依赖）。完整分类见 `.claude/reviews/sprint4-rbac-rollout-review.md`。
