# PR Review: #76 — authToken 贯通 + generateTokens 清理 + 死端口删除

**Reviewed**: 2026-08-02
**Author**: AaronLucas
**Branch**: feat/tenant-api-auth-routes → main
**Decision**: APPROVE

## Summary
核心安全修复：将 authToken 从中间件层贯通到权限检查、租户解析、库存查询三层，使 RLS 的 auth.uid() 不再是 NULL。同步清理 generateTokens 死接口和 20 个零引用死文件。validateTenantOwnership 填补了 x-tenant-id 无归属校验的长期安全缺口。代码质量良好，全量回归通过。

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
1. **SupabaseAuthProvider.ts:52-53 — `(client as any).supabaseUrl` cast**。`supabaseUrl`/`supabaseKey` 是 supabase-js 的 protected 属性，此处用 `as any` 绕过。如果 supabase-js 后续版本变更这些属性名，会在构造时静默拿到空字符串（`?? ''`），verifyToken 中 `createClient('', '', ...)` 不会立即报错，但 profile/role 查询会静默失败（authTokenForDb 路径下退化为匿名 client 的行为不易察觉）。建议在 verifyToken 的 `authTokenForDb` 分支中加一层防御：若 `!this.supabaseUrl` 则回退到 `this.client` 并 warn。

### LOW
1. **SupabaseTenantResolver.ts:90 — `if (!userId) return true` 缺注释**。此分支的含义是"无用户上下文时无法校验归属，放行（用于 service_role / 非认证路径调用）"，建议加一行注释以免误读为安全漏洞。

## Validation Results

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Unit/Integration tests | 85/85 Pass |
| Regression | 0 regressions |

## Files Reviewed

### Core changes (authToken passthrough)
| File | Type |
|---|---|
| `src/core/ports/auth/IAuthProvider.ts` | Modified |
| `src/core/ports/auth/IPermissionChecker.ts` | Modified |
| `src/core/ports/auth/ITenantResolver.ts` | Modified |
| `src/core/ports/db/IInventoryRepository.ts` | Modified |
| `src/adapters/supabase/auth/SupabaseAuthProvider.ts` | Modified |
| `src/adapters/supabase/auth/SupabasePermissionChecker.ts` | Modified |
| `src/adapters/supabase/auth/SupabaseTenantResolver.ts` | Modified |
| `src/adapters/supabase/repositories/SupabaseInventoryRepository.ts` | Modified |
| `src/adapters/express/ExpressMiddlewareFactory.ts` | Modified |

### Dead code deletion
| Directory | Type |
|---|---|
| `src/core/auth/` (4 files) | Deleted |
| `src/core/db/` (7 files) | Deleted |
| `src/core/cache/` (3 files) | Deleted |
| `src/core/external/` (4 files) | Deleted |
| `src/core/queue/` (2 files) | Deleted |

### Documentation
| File | Type |
|---|---|
| `docs/00-project/ROADMAP.md` | Modified |
| `docs/02-api/API_SPEC.md` | Modified |
| `docs/01-architecture/ADR/017-platform-rbac-scope-design.md` | Added |
