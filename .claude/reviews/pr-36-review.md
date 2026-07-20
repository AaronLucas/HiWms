# PR Review: #36 — fix(sync/task-claims): backfill HIGH #1-#3 test gaps, investigate auth/RLS premise

**Reviewed**: 2026-07-20
**Author**: AaronLucas
**Branch**: worktree-ecc-fix-processPendingEvents → main
**Decision**: COMMENT (draft PR — would be APPROVE if marked ready)

## Summary
Three well-scoped, independently-verified bug fixes (concurrency race + timezone drift in `extendLease`, swallowed secondary error in `applyEvent`'s catch branch, first HTTP-layer integration tests for device-api) plus a no-code-change investigation doc. Each fix has a documented revert→red→restore→green verification cycle. No CRITICAL or HIGH issues found. Branch was rebased onto current `main` during this review to eliminate a duplicate CRITICAL #1 commit that had already landed via #34 — this repo now merges cleanly.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None blocking. Two pre-existing patterns carried over (not introduced by this diff) worth a follow-up ticket rather than blocking this PR:
- `SupabaseSyncEventRepository.ts:170,192` — `console.error` used for error-path logging (`markStalledEventAsException`, `findExceptionIdForEvent`). Project convention favors a real logging library over `console.*` in production code. Pre-existing in both cases (moved, not added, by this PR).

### LOW
- `SupabaseTaskClaimRepository.ts` — file has no trailing newline (diff shows `\ No newline at end of file`).
- `findExceptionIdForEvent` silently returns `undefined` on lookup failure (logs via `console.error` only) — acceptable given it's best-effort enrichment of a secondary field, not the primary result, but worth a code comment noting this is intentional.

## Validation Results

| Check | Result |
|---|---|
| Type check (`npx tsc --noEmit`) | Pass (0 errors) |
| Lint (`tsc --noEmit`, project's lint script) | Pass |
| Tests (`npx vitest run`, non-DB suite) | Pass — 59/59, 82 DB-integration tests skipped (no local Postgres sandbox in this environment) |
| Build | Not run (no changes to build-affecting code; type check covers this) |

DB-integration tests (82 cases across 12 files, including the ones extended by this PR) were not re-run live in this environment, but each fix has a documented local-sandbox verification cycle in `docs/03-database/REPOSITORY_ROADMAP.md` §9 with concrete before/after failure messages.

## Files Reviewed
- Modified: `.gitignore`
- Modified: `package.json`, `pnpm-lock.yaml` (added `supertest`/`@types/supertest` as devDependencies)
- Modified: `docs/03-database/REPOSITORY_ROADMAP.md`
- Added: `docs/01-architecture/BUG_REPORT_AUTH_TENANT_ISOLATION_2026-07-20.md`
- Modified: `src/adapters/supabase/repositories/SupabaseTaskClaimRepository.ts` (HIGH #1)
- Modified: `src/adapters/supabase/repositories/SupabaseSyncEventRepository.ts` (HIGH #2)
- Modified: `src/__tests__/integration/tasks/fn_claim_task.concurrency.test.ts`
- Modified: `src/__tests__/integration/sync/fn_apply_sync_event.concurrency.test.ts`
- Added: `src/__tests__/integration/device-api/routes.http.test.ts` (HIGH #3)
