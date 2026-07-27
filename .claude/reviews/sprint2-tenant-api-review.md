# Local Review: Sprint 2 — Tenant API (feat/sprint2-tenant-api)

**Reviewed**: 2026-07-27
**Mode**: Local Review (branch vs `origin/main`, pre-PR)
**Branch**: `feat/sprint2-tenant-api` → `main`
**Decision**: APPROVE (after in-round fixes)

## Summary

New Tenant API (`src/apps/tenant-api/`): 7 HTTP endpoints (orders CRUD + allocate,
inventory read, products read/search, waves read/generate), reusing the existing
`ExpressMiddlewareFactory` auth chain (`authenticate → resolveTenant →
injectRlsContext`) instead of a bespoke device-style JWT middleware. ADR-015
per-request auth token threading was extended from `SupabaseBaseRepository`'s base
CRUD methods into business-specific repository methods, use cases
(`CreateOrderUseCase`, `AllocateOrderUseCase`, `GenerateWaveUseCase`), and the RPC
layer (`WmsSupabaseClient.rpc()` / `RpcOptions`). Two real issues were found and
fixed in this review round before opening the PR.

## Findings

### CRITICAL
None.

### HIGH
1. **PostgREST filter-string injection surface newly made public** — `SupabaseProductRepository.search()`
   (`src/adapters/supabase/repositories/SupabaseProductRepository.ts:72`) builds its `.or()` filter via
   unescaped template-literal interpolation of the caller-supplied `query`:
   `` .or(`name.ilike.%${query}%,sku.ilike.%${query}%`) ``. This method pre-dates this PR but had zero
   callers before it; this PR wires it to a public `GET /api/products?q=` endpoint for the first time,
   making it network-reachable. A crafted `q` containing PostgREST filter-syntax delimiters (`,`, `(`, `)`)
   could manipulate the `or()` clause's logical structure. Real-world impact is bounded (still AND-ed with
   `.eq('tenant_id', tenantId)`, and same-tenant users can already list the full catalog via the endpoint
   without `q`), but it's a real, easily-fixed defect.
   **Fix applied**: `listProductsQuerySchema.q` now enforces `max(100)` + a
   `/^[\p{L}\p{N} _-]+$/u` character whitelist at the HTTP boundary
   (`src/apps/tenant-api/validation.ts`), closing the injection surface without touching the shared
   repository method. Regression test added in `products.http.test.ts`.

### MEDIUM
1. **Inconsistent enum validation for `strategyType`** — `listWavesQuerySchema.strategyType` accepted any
   string while the sibling `status` field in the same schema was enum-validated. `waves.strategy_type` is
   stored uppercase (`GenerateWaveUseCase` calls `.toUpperCase()` before insert), so a lowercase filter value
   would silently match zero rows instead of failing loudly.
   **Fix applied**: `strategyType` is now `z.enum(['BATCH','ZONE','CLUSTER','WAVE'])`. Regression tests added
   (reject lowercase, accept uppercase and verify filtering).
2. **System-user bypass is neutralized at the route layer** — `ExpressMiddlewareFactory.resolveTenant()`
   lets `isSystemUser` requests through without a `tenantId`, but every Sprint 2 route independently does
   `if (!tenantId) return 403` with no `isSystemUser` exception, so system/admin callers can never actually
   reach any Sprint 2 endpoint today. Fails closed (not a security bug), but is an incomplete/inconsistent
   feature. Not fixed in this round — no current caller needs system-user access to tenant-api; tracked here
   for whenever that requirement appears.

### LOW
1. Routes rely on non-null assertions (`req.context!.user!.isSystemUser`) rather than an explicit type guard.
   Safe today only because `main.ts`'s middleware chain always populates `req.context.user` before these
   handlers run — test files replicate this by convention, not by the type system. No action taken; flagging
   for awareness if `createTenantApiRouter` is ever mounted without the full middleware chain.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass (0 errors) |
| Tests (`RUN_DB_CONCURRENCY_TESTS=true vitest run`) | Pass — 295 passed, 22 skipped, 0 failed |
| Build | Not run (no separate build step invoked; tsc clean) |
| Lint | Not run separately (no dedicated lint script found for this pass) |

## Files Reviewed

- `src/apps/tenant-api/{config,di,main,index,routes,validation}.ts` (Added)
- `src/adapters/supabase/SupabaseClient.ts` (Modified — `from()`/`rpc()` authToken support)
- `src/adapters/supabase/repositories/{SupabaseOrderRepository,SupabaseProductRepository,SupabaseWaveRepository}.ts` (Modified)
- `src/core/ports/db/{IOrderRepository,IProductRepository,IWaveRepository}.ts` (Modified)
- `src/core/ports/rpc/IRpcClient.ts` (Modified — `RpcOptions.authToken`)
- `src/core/usecases/order/CreateOrderUseCase.ts` (Modified — `CreateOrderUseCase`, `AllocateOrderUseCase`)
- `src/core/usecases/wave/GenerateWaveUseCase.ts` (Modified)
- `src/__tests__/integration/tenant-api/{health,orders.http,orders-allocate.http,inventory.http,products.http,waves.http}.test.ts` (Added)
