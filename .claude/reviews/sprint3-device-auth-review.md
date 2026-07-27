# Local Review: Sprint 3 — Device API Auth Fixes (fix/sprint3-device-auth)

**Reviewed**: 2026-07-27 (initial), 2026-07-28 (addendum round)
**Mode**: Local Review (branch vs `origin/main`, pre-PR)
**Branch**: `fix/sprint3-device-auth` → `main`
**Decision**: APPROVE

## Addendum (2026-07-28): tasks #29/#30 — pg_cron DBA request + first RBAC wiring

Two additions after the initial review: (1) a DBA addendum doc requesting
`pg_cron` registration for `fn_expire_task_claims` (doc-only, no app code) and
(2) wiring `ExpressMiddlewareFactory`'s underlying permission-check RPC
(`check_user_permission` via `SupabasePermissionChecker.check()`) into
`POST /device/provision` for the first time anywhere in the codebase
(`devices:CREATE`), resolving the standing `TODO: 验证 RBAC devices:CREATE
权限` comment.

Reviewed the diff directly: the check runs after context validation but
before any side effect (API key generation, insert), so it fails closed with
no partial state; `SupabasePermissionChecker.check()` swallows internal
errors and returns `false` (fail-closed default, not fail-open); the RPC
itself (`check_user_permission`) was already reviewed as safe in the Sprint 1
pass (SECURITY DEFINER + explicit cross-tenant-query denial). No new
attack surface — this only *narrows* who can call provision (previously any
caller with a valid `actorUserId`/`actorTenantId` could provision; now they
additionally need the permission row). One note, non-blocking: unlike
`ExpressMiddlewareFactory.requirePermission()`, device-api's flat context has
no `isSystemUser` bypass, so this check applies uniformly with no
system-user exception — consistent with fail-closed, not a gap.

Tests: seeded `devices:CREATE` for the existing provision test's real user
(role/permission/role_permission/user_role, 4-table insert in `beforeAll`),
added a new 403 case for a user with no role. Full suite: 277 passed / 22
skipped, `tsc` clean.

**Decision unchanged: APPROVE.**

## Summary

Task #28 set out to write HTTP-level integration tests for device-api's auth
endpoints (login/refresh/provision/pairing-qr), which previously had zero
real-HTTP-request coverage (only a mocked unit test for the middleware).
Writing those tests against a real local Supabase sandbox surfaced 4 distinct,
previously-undetected production bugs across the full device-auth lifecycle;
all 4 are fixed here, each confirmed by a failing-then-passing test, not by
code inspection alone.

## Findings

### CRITICAL
None remaining. Four CRITICAL-severity defects were found and fixed during
this task (see commit message for full narrative); each is covered by a
regression test:

1. `POST /device/auth/login` / `/refresh` were unreachable — the device auth
   middleware gated the entire router, including its own bootstrap endpoints.
   Fixed by extracting them into `publicAuthRoutes.ts`, mounted before the
   auth gate in `main.ts`.
2. `verifyDeviceToken`/`verifyRefreshToken` could never succeed — the dynamic
   key-resolution callback read `tenant_id` off jose's raw unverified JWS
   input, which has no such field (confirmed against jose's own
   `GenericGetKeyFunction` type docs: *"No token components have been
   verified at the time of this function call"*). Fixed via
   `extractUnverifiedTenantId()`, which base64url-decodes the payload segment
   before reading the claim.
   **Security note (explicitly reviewed)**: this decoded value is used only
   to select a *candidate* signing key; trust still comes entirely from the
   subsequent HS256 signature check against that key. A forged `tenant_id`
   claim cannot pass verification without possessing the corresponding
   tenant's secret (never exposed to clients) — same trust model as standard
   JWKS `kid`-based key selection. Verified with a dedicated test
   (`GET /api/device/sync/policy`: forged-payload token → 401).
3. Login/refresh (`publicAuthRoutes.ts`) and the auth middleware
   (`DeviceAuthMiddleware.ts`) each built their own independent
   `tenantSigningKeys: new Map()` — a key generated at login was invisible to
   the middleware verifying it. Fixed by exporting one process-level
   singleton (`sharedTenantSigningKeys`) from `device-credentials.ts`,
   referenced by both construction sites.
4. `POST /device/provision` always failed: its insert wrote a `device_name`
   column that doesn't exist on the real `devices` table (confirmed via
   `psql \d devices`), and the catch-all error handler mislabeled every
   failure as `409 DEVICE_ALREADY_EXISTS`, masking the real cause. Fixed by
   dropping `device_name` from the insert (not persisted; flagged as a
   product/DBA decision, not resolved here) and branching the error handler
   on Postgres code `23505` (real unique-key conflict → 409) vs. anything
   else (→ 500). Also tightened `device_id` to `uuidSchema` (the column is a
   `uuid` PK; a non-UUID input threw a raw Postgres type error before this
   fix).

### HIGH
None.

### MEDIUM
1. **In-memory-only signing key store, single-instance assumption** —
   `sharedTenantSigningKeys` (and its predecessor two-Map version) lives only
   in process memory: lost on restart, and — more importantly now that it's
   a *shared* singleton — would silently diverge across multiple server
   instances in a horizontally-scaled deployment (each instance would mint
   its own keys, and tokens signed by instance A would fail verification on
   instance B). This is a pre-existing limitation, not introduced by this
   fix (the previous two-Map version had the same single-instance
   assumption, just with an *additional* bug on top). Documented inline in
   `device-credentials.ts`; migrating to a persisted key store must happen
   before any multi-instance deployment of device-api.
2. **`/device/provision`'s human-operator auth path has no real caller** —
   the route requires `req.context.userId`, populated only when the incoming
   device JWT carries a `user_id` claim; `issueTokenPair()` accepts a
   `userId` parameter but never forwards it to `issueAccessToken()`, and no
   current caller passes one anyway. This is a separate, pre-existing
   integration gap (not a regression from this branch) — explicitly scoped
   out of this task per user decision; provision/pairing-qr tests use the
   same context-injection convention as the pre-existing
   `routes.http.test.ts` rather than a real token, matching how every other
   test in that file already works.

### LOW
None.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass (0 errors) |
| Tests (`RUN_DB_CONCURRENCY_TESTS=true vitest run`) | Pass — 276 passed, 22 skipped, 0 failed |
| Build | Not run separately; tsc clean |
| Lint | Not run separately (no dedicated lint script invoked this pass) |

## Files Reviewed

- `src/apps/device-api/publicAuthRoutes.ts` (Added)
- `src/apps/device-api/main.ts` (Modified — mount order fix)
- `src/apps/device-api/DeviceAuthMiddleware.ts` (Modified — shared key store)
- `src/apps/device-api/auth/device-credentials.ts` (Modified — tenant_id extraction fix, shared key store, 477 lines)
- `src/apps/device-api/routes.ts` (Modified — login/refresh extracted out, provision fix; 731 lines)
- `src/apps/device-api/validation.ts` (Modified — `device_id` tightened to `uuidSchema`)
- `src/apps/device-api/index.ts` (Modified — barrel export addition)
- `src/__tests__/integration/device-api/auth.http.test.ts` (Added — 6 cases)
- `src/__tests__/integration/device-api/routes.http.test.ts` (Modified — +6 provision/pairing-qr cases)
