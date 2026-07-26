# 迁移 023 Impact Analysis：Ghost Function 修复 + 安全加固

> **日期**: 2026-07-26  
> **源仓库**: HiWmsSupabase (DBA 团队)  
> **迁移文件**: `023_fix_ghost_function_and_hardening.sql`  
> **前置依赖**: 迁移 001-022 全部按编号顺序执行  
> **对应 Issue**: HiWmsSupabase #50, #51, #52

---

## 1. 业务维度（Business Impact）

### 1.1 变更概要

| 变更项 | 级别 | 说明 |
|--------|------|------|
| DROP ghost function `fn_purge_old_action_logs(INT)` | **CRITICAL** | 消除安全漏洞：旧单参数签名可被任意 authenticated 用户调用，执行无界单事务 DELETE |
| `fn_purge_old_action_logs(INT,INT)` 参数校验 | **HIGH** | 新增 `p_days >= 1` 和 `p_batch_size ∈ [1, 100000]` 校验，防止负数/零值导致全表删除或无限循环 |
| `fn_expire_stalled_sync_events` 租户过滤 | **HIGH** | 在 SELECT 循环中补显式 `tenant_id` 过滤，与迁移 010 的 REVOKE EXECUTE 形成双重保护 |
| pg_cron 定时任务注册 | **HIGH** | 幂等注册 `purge-old-action-logs` job（每 2 小时），之前只靠 ops-scripts 手动注册 |
| 清理性能索引 | **MEDIUM** | `wo_action_logs.start_at` 和 `inventory_history.changed_at` 新增索引，避免批量清理时的全表扫描 |

### 1.2 业务影响评估

- **数据安全**: CRITICAL 级别的 ghost function 被删除，消除未授权批量删除风险。
- **运维可靠性**: pg_cron 自动注册到迁移中，不再依赖运维人员手动执行 ops-scripts。
- **清理性能**: 新增索引将批量清理从全表扫描优化为索引扫描，千万行级别性能提升显著。
- **多租户隔离**: `fn_expire_stalled_sync_events` 补租户过滤，形成纵深防御。

---

## 2. 架构维度（Architecture Impact）

### 2.1 Schema 变更

**无表结构变更**。迁移 023 不创建/修改任何表、列、视图、枚举或复合类型。

变更集中在：函数层（DROP 1, CREATE OR REPLACE 2）、索引层（+2 B-tree）、定时任务层（pg_cron 幂等注册）。

### 2.2 函数签名变化

| 函数 | 变更类型 | 说明 |
|------|----------|------|
| `fn_purge_old_action_logs(INT)` | **DROP** | Ghost function — 旧单参数签名 |
| `fn_purge_old_action_logs(INT, INT)` | **CREATE OR REPLACE** | 新增参数校验（p_days >= 1, p_batch_size ∈ [1, 100000]） |
| `fn_expire_stalled_sync_events(INTERVAL)` | **CREATE OR REPLACE** | 新增防御性租户过滤 |

---

## 3. 功能维度（Functional Impact）

### 3.1 应用层代码影响

| 文件 | 影响 | 变更 |
|------|------|------|
| `src/types/database.ts` | 类型更新 | 移除 fn_purge_old_action_logs 旧单参数重载 union member |
| `src/core/ports/rpc/IPurgeOldLogsRpc.ts` | 接口清理 | 移除 PurgeOldLogsResultLegacy、isBatchedResult()；重命名为 PurgeOldLogsResult |
| `src/core/ports/rpc/IRpcClient.ts` | 返回类型简化 | purge() 返回从联合类型简化为单一 PurgeOldLogsResult |
| `src/core/ports/rpc/index.ts` | 导出更新 | 移除 isBatchedResult, PurgeOldLogsResultLegacy 导出 |
| `src/__tests__/.../SupabaseRpcClient.purge.test.ts` | 测试清理 | 移除 7 个 isBatchedResult() 测试，更新类型引用，13 个核心测试保留 |
| `src/adapters/supabase/rpc/SupabaseRpcClient.ts` | **无运行时变更** | 代码已强制 p_batch_size 必填 |

### 3.2 向后兼容性

- **无 breaking change**。应用层代码一直使用双参数签名（p_batch_size 必填），从未调用旧 ghost function。

---

## 4. 设计维度（Design Impact）

迁移 023 体现纵深防御原则：
1. Ghost Function 清理：消除 PostgreSQL 函数重载语义陷阱
2. 参数校验前移：数据库层 + 应用层双重校验
3. 双重租户保护：REVOKE EXECUTE（权限） + WHERE 过滤（数据）
4. 幂等性设计：unschedule + schedule、DROP IF EXISTS、CREATE INDEX IF NOT EXISTS

---

## 5. 测试维度（Test Impact）

- 单元测试: 13/13 通过 ✅（移除 7 个 isBatchedResult 测试，保留核心覆盖）
- TypeScript: 零类型错误 ✅
- 建议后续补充：跨租户过滤集成测试（HIGH）

---

## 6. 总结

| 维度 | 评级 | 关键发现 |
|------|------|----------|
| 业务 | 🟢 正面 | 消除 CRITICAL 安全漏洞，提升运维可靠性 |
| 架构 | 🟢 无影响 | 无 schema 变更，仅函数/索引/定时任务层 |
| 功能 | 🟢 向后兼容 | 应用层代码零运行时变更 |
| 设计 | 🟢 改进 | 纵深防御、幂等性、优雅降级 |
| 测试 | 🟡 需跟进 | 类型/单元测试已更新；集成测试建议后续补充 |

**迁移 023 对 wms7 项目的影响: 低风险、高收益。**
