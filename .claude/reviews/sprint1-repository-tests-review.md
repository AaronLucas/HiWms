# Code Review: Sprint 1 — Repository Concurrency Tests + Status Literal Fixes

**Review mode**: Local Review Mode (`/ecc:code-review`), base = `origin/main`, 21 commits, 30 files changed.
**Reviewer**: independent re-review per user request (not a rerun of the prior self-review).
**Date**: 2026-07-27

## Scope

- New: `src/core/constants/status.ts` (single source of truth for 13 tables' status/result CHECK-constraint literals)
- 20 repository adapters updated to import from `status.ts` instead of hand-written string literals
- 3 use case files updated (`CreateOrderUseCase.ts`, `GenerateWaveUseCase.ts`, `CreateWorkOrderUseCase.ts`)
- 7 new concurrency/correctness integration test files (Tenant/Product/ProductConstraint/Inventory/Order/WorkOrder/SortingChute), gated behind `RUN_DB_CONCURRENCY_TESTS=true`
- 3 docs files (BACKEND_GAP_ANALYSIS.md, ECC_EXECUTION_PLAN.md, REPOSITORY_ROADMAP.md)

Each status-literal diff was cross-checked against the real CHECK constraints in
`HiWmsSupabase/supabase/migrations/001_enterprise_core_schema.sql` (e.g. `chk_quality_inspections_status`,
`chk_quality_inspections_result`, `product_constraints` PK). All spot-checked fixes (ORDER_STATUS,
WAVE_STATUS, WORK_ORDER_STATUS, VEHICLE_STATUS, CROSS_DOCK_JOB_STATUS, QUALITY_INSPECTION_STATUS,
SHIPPING_DOCUMENT_STATUS, SORTING_CHUTE_STATUS, SORTING_TASK_STATUS, PACKING_TASK_STATUS,
LOADING_TASK_STATUS, INBOUND_RECEIPT_STATUS, `product_constraints.idColumn`) match the schema.

## Findings

### CRITICAL — 0

None found. No hardcoded production secrets, no SQL injection via user input, no auth bypasses.

### HIGH — 0

None found.

### MEDIUM — 1

**[MEDIUM] Fragile hand-built PostgREST `.or()` filter string, unbounded size**
File: `src/adapters/supabase/repositories/SupabaseInventoryRepository.ts:88-99` (`findReplenishmentNeeded`)

```ts
const needs = await this.getReplenishmentNeeds(tenantId);
if (needs.length === 0) return [];
const pairFilter = needs
  .map((n) => `and(location_id.eq.${n.loc_id},product_id.eq.${n.sku_id})`)
  .join(',');
...
.or(pairFilter);
```

- `loc_id`/`sku_id` come from the `v_replenishment_needs` view (DB-generated UUIDs), not from
  end-user input, so this is not an injection vector across a trust boundary — but it is still a
  string-built PostgREST filter with no size cap. If a tenant has a large number of low-fill-rate
  (location, product) pairs, `pairFilter` grows unbounded and could hit PostgREST's URL/query-length
  limits or become a slow query. Also note `getReplenishmentNeeds()` itself does not filter by
  `tenantId` (acknowledged in its own comment, pre-existing, out of scope for this diff) — the
  final `.eq('tenant_id', tenantId)` still narrows correctly, so no cross-tenant data leak, just
  wasted work building filter terms for other tenants' pairs.
- Suggested fix: batch the `.or()` calls (e.g. chunks of ~50-100 pairs) or resolve via a join/RPC
  instead of building a client-side filter string proportional to view result size.

### LOW — 1

**[LOW] Three intentionally-unfixed status-literal mismatches, tracked only as inline comments**
Files:
- `src/adapters/supabase/repositories/SupabaseCrossDockJobRepository.ts:46-49` (`findPendingMatch`, dead code — always returns `[]`)
- `src/adapters/supabase/repositories/SupabaseQualityInspectionRepository.ts:106-111,132-136` (`'reinspect'`/`'discrepancy'` have no matching CHECK value)
- `src/adapters/supabase/repositories/SupabaseInboundReceiptRepository.ts:167-174` (`getInspectionSummary` queries a non-existent `receipt_id` column on `inspection_items`)

These are well-documented with NOTE comments explaining exactly why they were left unfixed
(structural schema gaps requiring a product/DBA decision, not simple literal fixes), and are also
cross-referenced in `docs/03-database/REPOSITORY_ROADMAP.md` §"Sprint 1 附带发现" with a table.
This is good practice, not a defect — flagging only so these three known-broken methods get a
tracking ticket/issue number rather than living purely as code comments long-term.

## Non-findings (checked, no issue)

- No `console.log`/`console.debug` statements introduced.
- No literal `TODO`/`FIXME` residue (only false-positive substring match on `'NONEXISTENT_SKU_XXXXX'` test fixture string).
- No file exceeds 800 lines; largest changed file is `SupabaseInventoryRepository.concurrency.test.ts` at 492 lines (test file, table-style repeated setup, not complex).
- No function exceeds ~50 lines in the changed repository/use-case code.
- No nesting >4 levels.
- No mutation of shared/external state; all repository methods return new objects (`this.update(...)`, spread-free but no in-place mutation of input parameters observed).
- Hardcoded fallback Supabase JWT in test files (`SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGci...'`) is the
  well-known public Supabase CLI local-dev demo key (issuer `supabase-demo`), used only against a
  local Docker instance gated behind `RUN_DB_CONCURRENCY_TESTS=true`. Not a real credential — this
  is the standard fallback shipped with every fresh `supabase init` project. Not flagged as CRITICAL.
- `product_constraints.idColumn` fix (`'sku_id'` → `'product_id'`) verified correct against
  `product_constraints(product_id UUID PRIMARY KEY REFERENCES products(id) ...)` in
  `001_enterprise_core_schema.sql:178-189`.
- `SupabaseQualityInspectionRepository` `result` comparisons (`'PASS'`/`'REJECT'`) verified against
  `chk_quality_inspections_result CHECK (result IS NULL OR result IN ('PASS','REJECT','QUARANTINE','REWORK'))`.
- Test files that shell out to `docker exec ... psql` (`SupabaseInventoryRepository.concurrency.test.ts:51-61`)
  interpolate only internally-generated `randomUUID()` values into the SQL/shell string, not
  user-controlled input — acceptable for local test-only tooling gated behind an explicit env flag.

## Phase 4 — Validation

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | PASS (0 errors) |
| Unit/component tests | `npx vitest run` | PASS (84 passed, 203 skipped) |
| DB-backed concurrency/integration tests | `RUN_DB_CONCURRENCY_TESTS=true npx vitest run src/__tests__/integration/repositories/` | PASS (99 passed, 10 test files) |

All three commands were re-run independently in this review session against the local Docker
Supabase instance (`supabase_db_hiwms-supabase`), not taken on faith from the prior session's report.

## Phase 5 — Decision

**Verdict: APPROVE (with comments)**

Zero CRITICAL, zero HIGH. One MEDIUM (non-blocking, pre-existing-adjacent robustness concern) and
one LOW (recommend converting the three documented known-unfixable methods into tracked
issues/tickets rather than comment-only). All three validation gates pass. The status-literal
constant refactor (`status.ts`) is a clean, well-motivated fix for a real class of production bugs
(queries silently returning empty results due to case/value mismatches with CHECK constraints), and
every non-trivial mapping decision is documented inline with the actual constraint values.
