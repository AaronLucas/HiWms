# ECC 多维分析落地计划

**日期**: 2026-07-26
**来源**: HiWmsSupabase 迁移 019-022 同步 + ECC 四维度分析
**分析代理**: ecc:architect, ecc:security-reviewer, ecc:database-reviewer, ecc:code-reviewer

---

## 发现汇总

| 严重度 | 数量 | 归属 |
|--------|------|------|
| CRITICAL | 1 | HiWmsSupabase (DBA) |
| HIGH | 3 | HiWmsSupabase (DBA) |
| MEDIUM | 8 | 4 DBA + 4 wms7 |
| LOW | 3 | 文档/优化 |

---

## Phase 1: CRITICAL — 立即修复（HiWmsSupabase）

### P1-1 [CRITICAL] Ghost Function: 删除旧 `fn_purge_old_action_logs(INT)` 重载

**问题**: 迁移 021 创建了新的 `(INT, INT)` 签名函数，但旧 `(INT)` 签名函数未被删除或 REVOKE。任何 authenticated 用户可通过 PostgREST 调用旧签名，触发无界 DELETE。

**修复文件**: `supabase/migrations/023_fix_purge_ghost_function.sql`（新迁移，提交到 HiWmsSupabase）

**修复要点**:
1. REVOKE + DROP 旧的 `fn_purge_old_action_logs(INT)`
2. 在新函数中添加参数校验（`p_days >= 1`, `1 <= p_batch_size <= 100000`）
3. 注册 pg_cron 定时任务（每 2 小时）
4. REVOKE EXECUTE FROM PUBLIC, anon, authenticated

**验收标准**:
- `SELECT proname, pronargs FROM pg_proc WHERE proname = 'fn_purge_old_action_logs'` 只返回 1 行
- `SELECT fn_purge_old_action_logs(-1, 100)` 应报错
- authenticated 角色无法调用该函数

---

## Phase 2: HIGH — 本迭代修复（HiWmsSupabase）

### P2-1 [HIGH] 添加 `wo_action_logs.start_at` 和 `inventory_history.changed_at` 索引

**问题**: 批量清理的 ctid 子查询依赖日期过滤，无索引时每次扫描全表。

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wo_action_logs_start_at
    ON wo_action_logs(start_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_history_changed_at
    ON inventory_history(changed_at);
```

### P2-2 [HIGH] `fn_expire_stalled_sync_events` 防御性租户过滤

**问题**: 函数依赖 REVOKE EXECUTE 作为唯一防线，缺乏深度防御。在 SELECT 循环中加入 `AND tenant_id = fn_current_tenant_id()`。

---

## Phase 3: MEDIUM — wms7 应用层修复（本工作树可执行）

### P3-1 [MEDIUM] ✅ 已完成 — 为 purgeOldLogs 添加单元测试

**文件**: `src/__tests__/adapters/supabase/SupabaseRpcClient.purge.test.ts`

**已完成** (commit `2164566` + ECC 安全加固更新):
1. ✅ `purge({ p_days: 180, p_batch_size: 5000 })` 正确传递 batch 参数
2. ✅ 返回 `PurgeOldLogsResultBatched` 时正确解构
3. ✅ 返回 `PurgeOldLogsResultLegacy` 时向后兼容
4. ✅ p_batch_size 参数校验（零/负数/超限 → RpcError）
5. ✅ 错误传播 + 空结果处理

### P3-2 [MEDIUM] 修复 concurrency test 脚本的列名错误

**文件**: `supabase/tests/repro-scenarios/39-batched-purge-concurrency.sh`（HiWmsSupabase 仓库，DBA 侧）

**问题**: 引用了不存在的 `wo_action_logs.tenant_id`（实际表无此列，通过 FK `wo_id → work_orders.tenant_id` 关联）

### P3-3 [LOW] ✅ 已完成 — TypeScript 类型收窄辅助函数

在 `IPurgeOldLogsRpc.ts` 已添加类型守卫 (commit `ebc19f7`)：

```typescript
export function isBatchedResult(
  result: PurgeOldLogsResultLegacy | PurgeOldLogsResultBatched
): result is PurgeOldLogsResultBatched {
  return result.length > 0 && 'more_batches_available' in result[0];
}
```

### P3-4 [ECC REVIEW] ✅ 已完成 — 安全加固 + DRY 修复 (2026-07-26 ECC 审查)

- **H1 修复**: `p_batch_size` 改为必填，确保 PostgREST 路由到安全批量重载
- **H2 修复**: 添加 `1 <= p_batch_size <= 100_000` 参数校验
- **H3 修复**: `IRpcClient.ts` 导入命名类型 `PurgeOldLogsParams` / `PurgeOldLogsResultLegacy` / `PurgeOldLogsResultBatched`，消除内联类型重复
- **M1 修复**: 删除 `.orig` 合并残留 + `*.orig` 加入 `.gitignore`

---

## Phase 4: LOW — 后续优化

| ID | 问题 | 归属 |
|----|------|------|
| L4-1 | MD5 → SHA-256 替换 | HiWmsSupabase |
| L4-2 | `fn_raise_exception` p_raised_by 校验 | HiWmsSupabase |
| L4-3 | DB_SCHEMA.md 与 ADR-009 同步更新 | wms7 |
| L4-4 | migration header 引用的 design docs 补齐 | HiWmsSupabase |

---

## 执行顺序

```
Phase 1 (CRITICAL)           Phase 2 (HIGH)              Phase 3 (MEDIUM - wms7)
├─ P1-1: Ghost function ──── ├─ P2-1: Purge indexes ──── ├─ P3-1: ✅ Unit tests (done)
│   (DBA PR to HiWmsSupabase)│   (DBA PR to HiWmsSupabase)│   (wms7 PR #53)
│                            │                            │
│                            ├─ P2-2: Tenant filter ───── ├─ P3-2: Fix test script
│                            │   (DBA PR to HiWmsSupabase)│   (DBA — HiWmsSupabase)
│                            │                            │
│                            │                            ├─ P3-3: ✅ Type guard (done)
│                            │                            │   (wms7 PR #53)
│                            │                            │
│                            │                            └─ P3-4: ✅ ECC加固 (done)
│                            │                                (wms7 PR #53)
│                            │                                H1 p_batch_size必填
│                            │                                H2 1-100000校验
│                            │                                H3 DRY类型修复
│                            │                                M1 .orig清理
```

---

## 责任人

| 仓库 | 负责人 | 行动 |
|------|--------|------|
| HiWmsSupabase | DBA 团队 | Phase 1 + Phase 2 迁移 PR |
| wms7 | 应用团队 (AaronLucas) | Phase 3 PR（本工作树已包含 P3-1 基础类型修复） |

---

## 验证指标

| 指标 | 目标 | 验证方式 |
|------|------|----------|
| Ghost function 清除 | 0 个旧重载 | `SELECT count(*) FROM pg_proc WHERE proname='fn_purge_old_action_logs'` |
| 参数校验 | 非法输入报错 | `SELECT fn_purge_old_action_logs(-1)` |
| Purge 索引存在 | 2 个新索引 | `SELECT indexname FROM pg_indexes` |
| 应用层测试覆盖 | purgeOldLogs 有测试 | `grep -r "purgeOldLogs" src/__tests__/` |
| TypeScript 编译 | 0 errors | `npx tsc --noEmit` |
| 单元测试 | 全部通过 | `npx vitest run` |
