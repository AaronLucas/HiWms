# DB 团队新脚本 ECC 多维度分析报告

> 分析日期：2026-07-25  
> 来源：HiWmsSupabase 仓库（AaronLucas/HiWmsSupabase）→ 本地 `supabase/` 同步  
> 分析维度：业务 / 架构 / 功能 / 设计 / 测试 / 安全 / 运维  
> ECC 代理：database-reviewer / architect / security-reviewer  
> 状态：✅ 本地脚本已同步至最新版本

---

## 一、变更概览

### 1.1 变更文件清单

| 类别 | 文件 | 状态 | 说明 |
|------|------|------|------|
| **ops-scripts** | `unWMS_Monitoring_Views_V1.sql` | 🆕 新增 | 6 个生产监控视图 |
| **ops-scripts** | `unWMS_Setup_Cron_Jobs_V2.1.sql` | 🆕 新增 | 3 个 pg_cron 定时任务 |
| **ops-scripts** | `unWMS_PgBouncer_Config_V1.ini` | 🆕 新增 | PgBouncer 连接池配置 |
| **ops-scripts** | `unWMS_Production_Index_Deploy_V1.sql` | ⚠️ 已废弃 | 已被迁移 019 替代 |
| **design-docs** | 19 个 `unWMS_*_V1.md` | 🆕 新增 | 每个迁移对应一份设计文档 |
| **design-docs** | 7 个 `.svg/.png` 架构图 | 🆕 新增 | 架构/流程图 |
| **design-docs** | `unWMS_Operations_Guide_V1.md` | 🆕 新增 | 生产运维指南 |
| **design-docs** | `unWMS_PR_Pre_Submission_Checklist_V1.md` | 🆕 新增 | PR 提交前自查清单（9 条，基于真实踩坑） |
| **migrations** | `001-019` | ✅ 无变更 | 与上游逐字节一致 |

### 1.2 核心变更总结

DB 团队本次交付的是一个**完整运维体系**，并非单一功能变更：

1. **生产监控体系**（Monitoring Views）：6 个视图覆盖慢查询、无用索引、表膨胀、RLS 性能、定时任务状态
2. **自动化运维**（Cron Jobs）：3 个定时任务实现直通超时降级、日志清理、卡死事件清扫
3. **连接管理**（PgBouncer）：生产级连接池配置，transaction 模式
4. **设计文档体系**（Design Docs）：19 层架构的完整设计文档 + 7 张架构图
5. **质量保障**（PR Checklist）：基于历史踩坑经验总结的 9 条提交前自查清单

---

## 二、业务维度分析

### 2.1 业务影响评估

| 业务领域 | 影响程度 | 说明 |
|----------|----------|------|
| 库存管理 | 🟢 无直接影响 | Cron job 清扫直通超时作业，间接保障周转效率 |
| 离线同步 | 🟢 无直接影响 | 卡死事件清扫提升同步可靠性 |
| 数据合规 | 🟡 需关注 | 日志清理任务硬删除 180 天前数据，无外部归档 |
| 设备管理 | 🟢 无影响 | 018 迁移（device identity）已在此前部署 |
| 订单履约 | 🟢 间接正面影响 | 直通超时降级避免货物无限期滞留暂存区 |

### 2.2 业务关键点

1. **`purge-old-action-logs` 硬删除风险**：`wo_action_logs`/`inventory_history` 的 180 天前数据被物理删除，无自动归档。如有审计/合规需求，需在 cron job 执行前自行 COPY 到对象存储。**这应在 OPS.md 和业务 SLA 中明确记录**。

2. **`expire-stalled-sync-events` 对离线同步体验的改善**：PDA 客户端崩溃/网络中断导致的 PROCESSING 卡死事件，5 分钟后自动标记 EXCEPTION，避免后续同步请求被积压事件阻塞。

3. **`cross-dock-timeout-sweep` 对仓库运营效率的影响**：直通作业超时自动 FALLBACK 到常规拣货流程，避免暂存区积压。需确认业务方对 `timeout_at` 阈值设定的期望值。

---

## 三、架构维度分析

### 3.1 19 层架构模型

DB 团队的严格顺序依赖架构（1 → 2 → ... → 19），每层有独立 SQL 迁移 + 设计文档 + 测试场景：

```
Layer  1: 核心库存/订单/履约链路
Layer  2: 离线同步骨架 + 统一异常领域
Layer  3: 同步动作扩展 (PUTAWAY/COUNT/PACK)
Layer  4: 唯一追踪策略 + 无码/未识别货物
Layer  5: 并发安全加固
Layer  6: 跨租户归属校验修复
Layer  7: 库区建模 + 序列号持久追踪
Layer  8: 分层存储管理
Layer  9: 迁移复核收尾 (Addendum)
Layer 10: Dispatcher 权限模型修复
Layer 11: 视图 security_invoker 加固
Layer 12: RLS 加固第一批
Layer 13: check_user_permission 跨租户修复
Layer 14: RLS 加固第二批+第三批
Layer 15: 库存写入原语 EXECUTE 权限收口
Layer 16: Fast-follow 索引 + recount 守卫
Layer 17: fn_resolve_exception 信任修复
Layer 18: Device Identity Schema
Layer 19: 生产环境索引 (CONCURRENTLY)
```

**ops-scripts 位于架构层之外**：不属于 1-19 层编号体系，是按需手动执行的运维脚本。

### 3.2 新架构组件

| 组件 | 类型 | 在架构中的位置 |
|------|------|---------------|
| `v_slow_queries` | 监控视图 | 横切关注点 - 可观测性 |
| `v_unused_indexes` | 监控视图 | 横切关注点 - 存储治理 |
| `v_table_bloat` | 监控视图 | 横切关注点 - 存储治理 |
| `v_table_bloat_detailed` | 监控视图 | 横切关注点 - 存储治理（⚠️ 含 HIGH 风险，见安全/运维分析） |
| `v_rls_perf` | 监控视图 | 横切关注点 - 安全性能 |
| `v_pg_cron_jobs` | 监控视图 | 横切关注点 - 任务可观测性 |
| `cross-dock-timeout-sweep` | pg_cron job | 业务自动化层 |
| `purge-old-action-logs` | pg_cron job | 数据生命周期管理层（⚠️ 含 CRITICAL 风险） |
| `expire-stalled-sync-events` | pg_cron job | 同步可靠性层 |
| PgBouncer | 基础设施 | 连接管理 / 网络层 |

### 3.3 与 wms7 应用层的关系

```
┌─────────────────────────────────────────┐
│           wms7 Application               │
│  ┌─────────────┐  ┌───────────────────┐  │
│  │ React SPA   │  │ Express API       │  │
│  │ (PDA/Web)   │  │ (device-api/...)  │  │
│  └─────────────┘  └───────────────────┘  │
├─────────────────────────────────────────┤
│         Supabase Client (postgrest-js)    │
├─────────────────────────────────────────┤
│      PgBouncer (Connection Pool)  🆕     │
├─────────────────────────────────────────┤
│         PostgreSQL (Supabase)            │
│  ┌──────────────────────────────────┐    │
│  │  Migrations 001-019              │    │
│  │  Functions / Tables / Views / RLS│    │
│  ├──────────────────────────────────┤    │
│  │  🆕 Monitoring Views (6)         │    │
│  │  🆕 pg_cron Jobs (3)             │    │
│  └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**关键架构决策**：
- 监控视图和 cron jobs 是**数据库层能力**，不通过应用层 API 暴露
- PgBouncer 在应用和数据库之间透明代理，应用层无需代码变更
- 运维脚本由 DBA 团队维护在 HiWmsSupabase 仓库，wms7 仓库仅同步副本

---

## 四、功能维度分析

### 4.1 新功能详细清单

#### 4.1.1 监控视图（6 个）

| 视图 | 依赖扩展 | 查询频率建议 | 告警阈值 |
|------|----------|-------------|----------|
| `v_slow_queries` | `pg_stat_statements` | 每日/每周 | `mean_exec_time > 1000ms` |
| `v_unused_indexes` | 无 | 月度 | `recommendation='CANDIDATE_DROP' 且 > 10MB` |
| `v_table_bloat` | 无 | 每周 | `bloat_pct > 30% 且 > 100MB` |
| `v_table_bloat_detailed` | `pgstattuple` | 维护窗口按需 | `dead_tuple_percent > 20%`（⚠️ 不可全表扫描） |
| `v_rls_perf` | 无 | 新增 RLS 策略后 | Seq Scan 检测 |
| `v_pg_cron_jobs` | `pg_cron` | 每日 | `last_status != 'succeeded'` |

#### 4.1.2 定时任务（3 个）

| 任务 | 调度 | 调用函数 | 幂等性 | 数据操作 |
|------|------|----------|--------|----------|
| `cross-dock-timeout-sweep` | `*/5 * * * *` | `fn_cross_dock_timeout_sweep()` | ✅ 幂等 | UPDATE cross_dock_jobs.status |
| `purge-old-action-logs` | `0 3 * * *` | `fn_purge_old_action_logs(180)` | ✅ 幂等 | ⚠️ DELETE from wo_action_logs, inventory_history |
| `expire-stalled-sync-events` | `*/5 * * * *` | `fn_expire_stalled_sync_events()` | ✅ 幂等 | UPDATE sync_events |

#### 4.1.3 连接池配置（PgBouncer）

| 参数 | 建议值 | 说明 |
|------|--------|------|
| `pool_mode` | `transaction` | 事务完成后归还连接 |
| `default_pool_size` | `25` | 每库/用户对的服务端连接数 |
| `max_client_conn` | `100` | 前端连接总数上限 |
| `idle_transaction_timeout` | `30s` | 防死锁/连接泄漏 |
| `query_wait_timeout` | `10s` | 等待可用连接超时 |
| `server_lifetime` | `3600s` | 1 小时轮换连接 |

### 4.2 功能依赖关系

```
pg_stat_statements 扩展 ──→ v_slow_queries
pgstattuple 扩展 ──→ v_table_bloat_detailed
pg_cron 扩展 ──→ 3 个 cron jobs + v_pg_cron_jobs
001 迁移（核心 schema）──→ fn_cross_dock_timeout_sweep / fn_purge_old_action_logs
002 迁移（离线同步）──→ fn_expire_stalled_sync_events
009/010 迁移 ──→ fn_expire_stalled_sync_events (REVOKE 后 pg_cron 超级用户不受限)
```

---

## 五、设计维度分析

### 5.1 设计文档质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 完整性 | ⭐⭐⭐⭐⭐ | 每个迁移（001-019）均有独立设计文档，覆盖问题定位、方案、部署、回滚 |
| 可追溯性 | ⭐⭐⭐⭐⭐ | 设计文档 ↔ 迁移文件 ↔ 测试场景 ↔ CI 配置四重对照 |
| 版本管理 | ⭐⭐⭐⭐⭐ | v1.0 → v2.2 完整版本历史，每次变更均有记录 |
| 决策记录 | ⭐⭐⭐⭐⭐ | ADR 风格（问题-方案-决策-理由），如 Grant Strategy ADR |
| 踩坑记录 | ⭐⭐⭐⭐⭐ | PR Pre-Submission Checklist 基于 8+ 个真实生产事故总结 |

### 5.2 关键设计模式

1. **纵深防御**：权限模型从 PUBLIC GRANT → REVOKE → SECURITY DEFINER → 显式租户过滤，层层收紧
2. **幂等自愈**：迁移文件使用 `CREATE OR REPLACE` + `IF NOT EXISTS`，可安全重跑
3. **运行时守卫**：016/019 含 DO $$ 块检测前置依赖是否满足，不满足直接报错
4. **CI 显式跳过**：019（CONCURRENTLY）自动被 CI 跳过并打印 NOTICE，不静默忽略
5. **兼容性策略**：`fn_current_user_id() IS NULL` 时放行，兼容超级用户/无会话上下文

### 5.3 架构图资产

| 图表 | 内容 |
|------|------|
| `container_identity_model.svg` | 容器身份模型 |
| `internal_lpn_policy_flow.svg` | 内部 LPN 策略流程 |
| `pda_offline_sync_architecture.png/.svg` | PDA 离线同步架构 |
| `unidentified_goods_flow.svg` | 未识别货物处理流程 |
| `unified_exception_domain.svg` | 统一异常领域 |
| `unwms_document_family.svg` | 文档家族关系图 |

---

## 六、测试维度分析

### 6.1 测试现状

| 测试类型 | 覆盖范围 | 状态 |
|----------|----------|------|
| 场景测试 | 22 个测试场景文件（`supabase/tests/scenarios/`） | ✅ 与上游一致 |
| 复现场景 | 8 个复现场景（`supabase/tests/repro-scenarios/`） | ✅ 已同步 |
| 测试框架 | `bootstrap-roles.sql` + `fixtures.sql` harness | ✅ 已同步 |
| CI 集成 | `.github/workflows/ci.yml` 含 `migrations-apply-clean` job | ✅ 已同步 |

### 6.2 新增脚本的测试缺口

| 脚本 | 测试状态 | 建议 |
|------|----------|------|
| `unWMS_Monitoring_Views_V1.sql` | ❌ 无专项测试 | 建议至少验证 6 个视图可正常查询不报错 |
| `unWMS_Setup_Cron_Jobs_V2.1.sql` | ❌ 无专项测试 | 建议验证幂等性（重跑不重复注册）+ 函数调用成功 |
| `unWMS_PgBouncer_Config_V1.ini` | ❌ 无专项测试 | 建议压测环境验证 pool_size / max_client_conn 参数 |

### 6.3 回归测试建议

1. **Cron job 回归**：部署后确认 `cron.job_run_details` 中 3 个任务 `last_status = 'succeeded'`
2. **监控视图回归**：`SELECT count(*) FROM v_slow_queries` 等 6 条查询不报错
3. **PgBouncer 回归**：`SHOW POOLS` 确认连接数在预期范围

---

## 七、安全维度分析

### 7.1 ECC security-reviewer 评估（3 个 CRITICAL + 2 个 HIGH + 4 个 MEDIUM）

| ID | 严重度 | 发现 | 详情 |
|----|--------|------|------|
| **SEC-01** | 🔴 **CRITICAL** | 监控视图无访问控制——敏感数据暴露 | 6 个视图均为 `CREATE VIEW` 无 `GRANT`/`REVOKE`。`v_slow_queries.query_preview` 暴露原始 SQL（含可能的 PII）。`v_rls_perf` 暴露所有 RLS 策略的 USING/WITH CHECK 表达式，为攻击者提供精确的绕过地图 |
| **SEC-02** | 🔴 **CRITICAL** | Cron 函数以 superuser 身份运行——RLS 全绕过 | pg_cron 以超级用户运行，`fn_purge_old_action_logs`/`fn_cross_dock_timeout_sweep`/`fn_expire_stalled_sync_events` 均为 SECURITY INVOKER，绕过所有租户 RLS。函数内无 `WHERE tenant_id IN (...)` 防御，无异常阈值检测 |
| **SEC-03** | 🔴 **CRITICAL** | `fn_expire_stalled_sync_events` 将完整 payload 泄露到 exceptions 表 | `sync_events.payload`（含 PDA 操作数据：SKU/数量/库位）被整体写入 `exceptions.details`，导致敏感数据在异常表中冗余持久化。建议仅保留 `action_type` + payload hash |
| **SEC-04** | 🟡 **HIGH** | PgBouncer TLS 全部注释 | `client_tls_sslmode`、`server_tls_sslmode` 及证书路径全部注释。认证后所有查询结果和会话状态以明文传输 |
| **SEC-05** | 🟡 **HIGH** | `fn_purge_old_action_logs` 无逐租户审计 | 硬删除返回总数，无租户级明细。若租户争议删除数据，无审计轨迹。建议切换至 008 迁移的 `fn_run_storage_maintenance()`（含聚合+逐租户归档） |

| 检查项 | 状态 | 详情 |
|--------|------|------|
| 监控视图数据暴露 | 🟡 需关注 | `v_slow_queries.query_preview` 可能包含查询参数（如 tenant_id），需确保视图权限仅授予运维角色 |
| Cron job 权限 | 🟢 安全 | pg_cron 以超级用户身份运行，调用的函数已通过 REVOKE 保护（009/010/015） |
| PgBouncer 认证 | 🟢 安全 | `scram-sha-256` + TLS 可选配置 |
| 硬编码密钥 | 🟢 安全 | PgBouncer 配置中无硬编码密码 |
| 数据删除合规 | 🟡 需关注 | `purge-old-action-logs` 硬删除 180 天前数据，需确认合规要求 |
| SQL 注入 | 🟢 安全 | 无动态 SQL，均为静态视图/函数 |
| RLS 绕过 | 🟢 安全 | 监控视图不绕过 RLS（查询的是 pg_stat_* / pg_class 等系统表） |
| 审计轨迹 | 🟢 安全 | `cron.job_run_details` 记录每次执行的时间/状态/返回消息 |

### 7.2 安全建议

1. **监控视图权限**：建议创建专用运维角色（如 `unwms_ops`），仅授予 6 个监控视图的 SELECT 权限
2. **日志清理归档**：在 `purge-old-action-logs` 执行前，通过 pg_cron 增加归档步骤（COPY 到 Supabase Storage）
3. **PgBouncer TLS**：生产环境应启用 `client_tls_sslmode = require` + `server_tls_sslmode = require`

---

## 八、ECC database-reviewer 关键发现

### 8.1 CRITICAL 发现

| ID | 严重度 | 发现 | 详情 |
|----|--------|------|------|
| DB-01 | **CRITICAL** | `fn_purge_old_action_logs` 无批量删除 | 单条 `DELETE FROM wo_action_logs WHERE start_at < NOW() - '180 days'::INTERVAL` 在高频仓库中可能涉及数千万行。单事务 DELETE 会导致：① 长时间持锁阻塞写入 ② 海量 WAL 生成 ③ 可能超过 `statement_timeout` 失败 ④ 触发 aggressive autovacuum。**必须改为分批删除（每批 10,000 行 + COMMIT + pg_sleep(0.1)** |
| DB-02 | **HIGH** | `v_table_bloat_detailed` 可触发全库全表扫描 | `CROSS JOIN LATERAL (SELECT (pgstattuple(c.oid)).*) t` 无 WHERE 过滤。`SELECT * FROM v_table_bloat_detailed` 会对 public schema 下所有表执行 `pgstattuple()`（全表扫描）。**必须改为参数化函数**，要求传入具体表名。 |
| DB-03 | **HIGH** | 审计数据硬删除无归档 | `wo_action_logs` / `inventory_history` 的 180 天前数据被物理删除。函数注释明说"此函数是硬删除，不做外部归档"。对合规审计有影响。 |

### 8.2 MEDIUM 发现

| ID | 严重度 | 发现 | 详情 |
|----|--------|------|------|
| DB-04 | **MEDIUM** | PgBouncer `disable_pqexec` 未启用 | transaction 模式下 prepared statements 无法跨事务复用，应取消注释 `disable_pqexec = 1` |
| DB-05 | **MEDIUM** | PgBouncer `stats_users` 未配置 | 无监控用户无法执行 `SHOW POOLS` / `SHOW STATS` 等管理命令 |
| DB-06 | **MEDIUM** | 监控视图缺少显式 GRANT | 视图创建后仅 superuser 和创建角色可查询，无运维角色授权语句 |
| DB-07 | **MEDIUM** | `v_pg_cron_jobs` 对 cron schema 的隐式依赖 | 监控视图脚本未创建 pg_cron 扩展，若先跑监控再跑 cron jobs 会失败 |

---

## 九、影响总结

### 9.1 风险矩阵

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 日志清理无批量删除导致生产阻塞 | 🔴 CRITICAL | 改为分批删除 + COMMIT |
| 审计数据无归档被永久删除 | 🟡 HIGH | 增加 COPY 归档步骤 |
| 全表扫描视图误触发表扫描风暴 | 🟡 HIGH | 改为参数化函数 |
| 监控视图权限过大暴露查询数据 | 🟡 MEDIUM | 创建专用运维角色 |
| PgBouncer 配置不当导致连接不足 | 🟡 MEDIUM | 压测验证参数 + 配置 stats_users |
| ops-scripts 与 wms7 应用代码不一致 | 🟢 LOW | 同步机制建立后自动检测 |

### 9.2 总体评估

DB 团队本次交付的是一个**成熟的生产运维体系**。对 wms7 应用层代码**无直接变更需求**（ops-scripts 和监控视图均为数据库层能力），但需要在文档层面完成同步，并在运维层面完成部署。

**关键正面影响**：
- ✅ 补齐了生产可观测性短板（6 个监控视图）
- ✅ 自动化了 3 个运维任务（超时降级、日志清理、事件清扫）
- ✅ 提供了完整的设计文档追溯链（19 层 × 1 文档）
- ✅ 沉淀了踩坑经验为 PR 自查清单（9 条规则）

**需关注**：
- 🔴 `fn_purge_old_action_logs` 需改为批量删除
- ⚠️ `v_table_bloat_detailed` 需改为参数化函数
- ⚠️ 日志硬删除需配套归档方案
- ⚠️ 监控视图权限需收口到专用运维角色
- ⚠️ PgBouncer `disable_pqexec` 需启用

---

## 十、ECC 落地计划

### Phase 0：文档同步（本期完成）

| # | 任务 | 优先级 | 状态 |
|---|------|--------|------|
| P0-1 | 更新 `DB_SCHEMA.md` 至 v2.7.0，补充 ops-scripts 运维层 | P0 | ⏳ |
| P0-2 | 更新 `OPS.md`，新增监控/cron/PgBouncer 运维章节 | P0 | ⏳ |
| P0-3 | 更新 `ROADMAP.md`，记录本次 ECC 分析里程碑 | P1 | ⏳ |
| P0-4 | 提交 DB-01（批量删除）作为 HiWmsSupabase Issue | P0 | ⏳ |

### Phase 1：应用层适配验证

| # | 任务 | 优先级 | 状态 | 说明 |
|---|------|--------|------|------|
| P1-1 | 确认 `fn_current_user_id()` 在 Express API 会话中返回正确值 | P0 | ✅ 已验证（有 Gap） | 见 §11 详细分析 |
| P1-2 | 验证 Device API 的 `secret_hash` 写入格式（bcrypt/argon2） | P1 | ✅ 一致 | 三层验证通过 |
| P1-3 | PgBouncer transaction 模式对 Supabase client 兼容性验证 | P2 | ✅ 兼容（3 项建议） | 见下方详情 |

#### P1-3 验证详情（2026-07-26）

**结论**：PostgREST + Supabase JS client 与 PgBouncer transaction 模式**兼容**，
`unWMS_PgBouncer_Config_V1.ini` 配置基本合理。发现 3 项优化建议，无阻断性风险。

**兼容性扫描**（6 维度）：

| 维度 | 检测结果 | 交易模式兼容? |
|------|----------|:---:|
| Prepared statements | migrations 无 `PREPARE`/`DEALLOCATE`；PostgREST 用扩展查询协议的匿名语句 | ✅ |
| `SET LOCAL` / `current_setting` | 仅 `001:1767` `fn_current_tenant_id()` 读 `request.jwt.claims` — PostgREST 每请求 `SET LOCAL`，交易级作用域 | ✅ |
| `LISTEN`/`NOTIFY` | migrations 全量 grep，零使用 | ✅ |
| Advisory locks | migrations 全量 grep，零使用 | ✅ |
| Temp tables / `WITH HOLD` cursors | 零使用 | ✅ |
| Supabase Realtime / WebSocket | app 代码中零引用 | ✅ |

**发现的 3 项建议**：

| # | 配置项 | 当前 | 建议 | 原因 |
|---|--------|------|------|------|
| 1 | `disable_pqexec` (line 133) | ❌ 注释掉 | ✅ 取消注释为 `disable_pqexec = 1` | 虽然 PostgREST 不用命名 prepared statement，但任何直连 PG 的工具（psql、pgAdmin、DB migration 脚本）可能在交易池中意外触发。显式关闭是最佳实践 |
| 2 | `stats_users` (line 89) | ❌ 注释掉 | 配置一个只读监控用户 | 部署后无法执行 `SHOW POOLS`/`SHOW STATS` 监控池状态，运维盲区 |
| 3 | TLS (lines 119-127) | ❌ 全部注释 | 根据部署拓扑评估：若 PgBouncer 与 PG 部署在同一主机/内网，内网明文可接受；若跨网络，必须启用 | 注释标注"如需"是合理的，但部署前需明确决策并记录 |

**`server_reset_query` 与 Supabase 交互验证**：
- 配置：`ABORT; RESET ALL; SET SESSION AUTHORIZATION DEFAULT;`
- `RESET ALL` 清除 `role`、`request.jwt.claims` 等 — ✅ 正确，PostgREST 下个请求会重新 `SET LOCAL`
- `SET SESSION AUTHORIZATION DEFAULT` 重置认证用户 — ✅ 正确
- 这是 PgBouncer 官方推荐的交易模式清理语句

#### P1-2 验证详情（2026-07-26）

**结论**：三层一致，无问题。

**三层对照**：

| 层级 | 文件:行 | 内容 |
|------|---------|------|
| 迁移 | `018:38` | `secret_hash TEXT` |
| 设计文档 | `Device_Identity_Schema_V1.md:18` | "bcrypt/argon2 哈希" |
| 应用代码 | `device-credentials.ts:114-136` | `argon2id type=2, m=65536, t=3, p=4` |

**写入路径**（均用 `getAdminClient()` = service_role）：
- `POST /device/provision` (routes.ts:720-734): `generateApiKey()` → `INSERT` secret_hash
- `POST /admin/devices/{id}/pairing-qr` (routes.ts:804-809): `generateApiKey()` → `UPDATE` secret_hash

**验证路径**：
- `DeviceAuthMiddleware.ts:100-111`: `select secret_hash` → `verifyApiKeySecret(secret, hash)` → argon2 `verify()`

**小差异（无影响）**：设计文档表述"哈希 API key (`hiwms_dk_<id>_<random>`)"暗示 hash 整个 key，
但 `device-credentials.ts:123` 只 hash `randomPart`。这更正确——前缀和 device_id 可预测，验证时
从 API key 解析出 random 部分后只比对随机字节。代码自洽，不构成不一致。

#### P1-1 修复方案（2026-07-26）

**结论**：`fn_current_user_id()` 在 Express API 会话中**始终返回 NULL**。

**根因**：`WmsSupabaseClient` 是单例，用 `anonKey` 创建（`SupabaseClient.ts:92-95`），
无 per-request JWT 注入机制。Express auth middleware 提取 JWT 后仅存入 `req.context.user`
内存对象，未注入到下游 Supabase client。所有 DB 请求带着 `Authorization: Bearer <anonKey>`
发出，`auth.uid()` 无用户 JWT → 返回 NULL，`fn_current_user_id()` 的 EXCEPTION handler
捕获并返回 NULL。

**调用链**：
```
PDA/browser → Express API → auth middleware → verifyToken(JWT) → req.context.user ✅
                          → WmsSupabaseClient.getClient() → singleton, anonKey only
                          → Authorization: Bearer <anonKey> (NO user JWT!)
                          → PostgREST → auth.uid() → NULL
                          → fn_current_user_id() → EXCEPTION → NULL
```

**当前实际影响**（轻度，因 admin client 掩盖）：

| 调用方 | 文件:行 | NULL 路径行为 | 当前是否触发 |
|--------|---------|---------------|:---:|
| RLS policies | `008:101-102,139` | `fn_is_platform_admin(NULL)` → 永远 FALSE | ❌ 不触发 — app 所有查询用 `getAdminClient()` 绕过 RLS |
| `fn_resolve_exception` | `017:73-76` | 身份校验跳过，不防冒充 | ❌ 不触发 — 此函数从 admin client 调用 |
| `check_user_permission` | `013:55` | 自检场景降级 | ❌ 不触发 — 同上 |

> **注意**：当前"不触发"是因为全局滥用 `getAdminClient()`（service_role），并非设计合理。
> 如果未来安全加固把查询从 admin client 切回 anon client（正确做法），这些路径会立刻暴露。

**严重度评估**：🟠 中等架构债务。不是紧急 bug（admin client 掩盖了），但阻塞了从
service_role 到 RLS+JWT 的安全模型迁移。

---

#### P1-1 修复方案（代码级，开发团队可自主执行）

**目标**：让 `WmsSupabaseClient` 支持 per-request 携带用户 JWT，使 `auth.uid()` 返回真实用户 ID。

**方案选择**：在 `WmsSupabaseClient` 增加 `getAuthenticatedClient(userToken)` 方法，
每次调用创建临时 Supabase client 注入用户 JWT。这是 Supabase 社区推荐的标准做法。

##### Step 1：新增 `getAuthenticatedClient()` 方法

**文件**：`src/adapters/supabase/SupabaseClient.ts`

在 `getAdminClient()` 方法后（约 line 138）插入：

```typescript
/** 获取带用户 JWT 的认证客户端（per-request，使 auth.uid() 返回真实用户 ID）
 *
 *  每次调用创建新实例——不缓存，因为 token 随请求变化。
 *  调用方负责在请求结束后释放（Supabase JS client 无连接池，GC 即可回收）。
 */
getAuthenticatedClient(userToken: string): SupabaseClient<Database> {
  return createClient<Database>(this.config.url, this.config.anonKey, {
    auth: { persistSession: false },
    db: { schema: 'public' },
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    },
  });
}
```

##### Step 2：在认证中间件中注入到请求上下文

**文件**：`src/adapters/express/ExpressMiddlewareFactory.ts`

在 `authenticate()` 方法中，token 验证成功后挂载 authenticated client（约 line 59 后插入）：

```typescript
// 在 req.context = { user: {...}, correlationId: ... } 之后添加：

// 创建 per-request 认证 Supabase client，使 DB 层 auth.uid() 返回真实用户 ID
(req as any).supabaseAuthenticated = (supabaseClient: WmsSupabaseClient) =>
  supabaseClient.getAuthenticatedClient(token);
```

同时在 `ExpressRequestContext` 接口（约 line 13）增加可选字段：

```typescript
export interface ExpressRequestContext {
  user?: { ... };
  tenantId?: string | null;
  correlationId?: string;
  supabaseToken?: string;  // 新增：用于 per-request Supabase client 创建
}
```

并在 middleware 中存储 token：

```typescript
req.context = {
  user: { ... },
  supabaseToken: token,  // 新增
  correlationId: ...,
};
```

##### Step 3：改造路由中的 DB 调用

**文件**：各 route 文件（`src/apps/device-api/routes.ts` 等）

将需要用户身份的查询从 `getAdminClient()` 改为 `getAuthenticatedClient()`：

```typescript
// 改造前（用户身份不可见）：
const { data } = await supabaseAdapters.client.getClient()
  .from('some_table').select('*');

// 改造后（用户身份可见，auth.uid() = 真实 UUID）：
const authedClient = supabaseAdapters.client.getAuthenticatedClient(
  req.context!.supabaseToken!
);
const { data } = await authedClient
  .from('some_table').select('*');
```

> **迁移策略**：先只改需要 `fn_current_user_id()` 的场景（`fn_resolve_exception` 调用、
> RLS-protected 表的查询），不要一次性全量替换 `getAdminClient()`——service_role 有其
> 合理用途（跨租户操作、系统级维护）。

##### Step 4：验证方法

```bash
# 1. 单元测试：确认 getAuthenticatedClient 注入的 header
# 2. 集成测试：用真实 JWT 发请求，在 DB 端用 RAISE NOTICE 打印 auth.uid()
# 3. 手动验证：
curl -H "Authorization: Bearer <real_user_jwt>" \
  http://localhost:3001/api/some-route
# → 检查 PostgREST 日志确认 Authorization header 被转发
```

```sql
-- DB 端验证（在某个被调用的函数中临时加）：
RAISE NOTICE 'auth.uid() = %, fn_current_user_id() = %', auth.uid(), fn_current_user_id();
-- 预期：auth.uid() = '<调用者 UUID>'，fn_current_user_id() = '<调用者 UUID>'
```

##### 预估工时

| 步骤 | 内容 | 预估 |
|------|------|------|
| Step 1 | 新增 `getAuthenticatedClient()` | 30 分钟 |
| Step 2 | 中间件改造 + token 存储 | 30 分钟 |
| Step 3 | 路由渐进迁移 | 2-4 小时（取决于多少路由需要改） |
| Step 4 | 测试验证 | 1-2 小时 |
| **合计** | | **4-7 小时（约 1 个开发日）** |

##### 注意事项

1. **不要缓存 authenticated client** — 每个请求的 token 不同，用完即弃
2. **token 过期处理** — `getAuthenticatedClient()` 创建的 client 携带过期 token 时，
   PostgREST 返回 401，Supabase JS client 抛出 `AuthRetryableFetchError`，应用层应捕获并返回 401
3. **性能影响** — 每次 `createClient()` 开销极低（仅构造 JS 对象，不建连接），无实际性能影响
4. **与 PgBouncer 的交互** — PgBouncer transaction 模式下，有 JWT 的请求和 anon key 的请求
   共享同一连接池，无冲突（PostgREST 在事务开始时 `SET LOCAL` JWT claims）

### Phase 2：运维部署

| # | 任务 | 优先级 | 状态 | 执行人 | 预估工时 | 阻塞? |
|---|------|--------|------|--------|----------|-------|
| P2-1 | 生产维护窗口执行 019 迁移（CONCURRENTLY 索引） | P0 | ✅ 就绪（DBA 执行） | **DBA** | 1 次维护窗口 | 🟢 |

#### P2-1 审查详情（2026-07-26）

**结论**：019 迁移已就绪，独立于所有阻塞 Issue，**DBA 可以立即执行**。

**迁移内容**：019 将 016 的 4 个普通 `CREATE INDEX` 升级为 `CREATE INDEX CONCURRENTLY`：

| 索引 | 表 | 列 | 目的 |
|------|-----|-----|------|
| `idx_inventory_tenant` | `inventory` | `tenant_id` | RLS 策略全表扫描 → 索引扫描 |
| `idx_vas_boms_output_product` | `vas_boms` | `output_product_id` | RLS 策略关联 products.tenant_id |
| `idx_vas_bom_items_input_product` | `vas_bom_items` | `input_product_id` | 同上 |
| `idx_vas_bom_items_bom` | `vas_bom_items` | `bom_id` | FK 外键，替代全表扫描 |

**关键特性**：
- `CONCURRENTLY` — `SHARE UPDATE EXCLUSIVE` 锁，**不阻塞读写**，适合 `inventory` 等核心表
- `IF NOT EXISTS` — 全幂等，可重复执行
- 有运行时守卫 — 检测 016 的 4 个索引是否存在，缺失则 RAISE EXCEPTION

**独立性验证**：

| Issue | 与 019 的关系 |
|-------|---------------|
| #35 监控视图 ACL | ❌ 无关 — 监控视图不依赖索引 |
| #36 payload 泄露 | ❌ 无关 |
| #37 v_table_bloat | ❌ 无关 |
| #38 task_claims cron | ❌ 无关 |
| #39 批量删除 | ❌ 无关 |

**依赖链**：001 → … → 016 → 018（PR #47 已部署）→ **019（本次）**

**DBA 执行清单**：

```bash
# 1. 确认前置条件
psql $DATABASE_URL -c "
SELECT indexname FROM pg_indexes 
WHERE schemaname = 'public' 
  AND indexname IN (
    'idx_inventory_tenant',
    'idx_vas_boms_output_product', 
    'idx_vas_bom_items_input_product',
    'idx_vas_bom_items_bom'
  );
"
# 预期：4 行（016 已部署）

# 2. 维护窗口执行 019
psql $DATABASE_URL -v ON_ERROR_STOP=1 \
  -f supabase/migrations/019_production_indexes_concurrently.sql

# 3. 部署后验证
psql $DATABASE_URL -c "
SELECT indexrelname, idx_scan, idx_tup_read 
FROM pg_stat_user_indexes 
WHERE indexrelname IN (
  'idx_inventory_tenant',
  'idx_vas_boms_output_product',
  'idx_vas_bom_items_input_product',
  'idx_vas_bom_items_bom'
) AND schemaname = 'public';
"
```

**注意事项**：
- 不可包在事务里 — `CREATE INDEX CONCURRENTLY` 每条独立执行
- CI 不跑 019 — CONCURRENTLY 不能在事务块内执行，需手动部署
- 若 4 个索引已存在（016 已建），019 跳过全部（`IF NOT EXISTS`）
- 若建索引失败（极少见），不会影响已有索引，表保持可读写状态
| P2-2 | 注册 pg_cron 定时任务（幂等脚本） | P1 | 🔴 阻塞 | **DBA** | 执行 1 个 SQL 文件 | 等 #38 + #39 |
| P2-3 | 部署监控视图（6 views） | P1 | 🔴 阻塞 | **DBA** | 执行 1 个 SQL 文件 | 等 #35 |
| P2-4 | PgBouncer 部署评估 | P2 | ⏳ | **开发/运维** | 半天评估 + 半天部署压测 | 🟢 |

**P2-4 部署评估清单**：
1. 统计当前生产活跃连接数（`pg_stat_activity`），判断是否需要连接池
2. 按 P1-3 的 3 项建议修改配置（`disable_pqexec=1`、`stats_users`、TLS 决策）
3. 测试环境部署 PgBouncer → 指向测试 PG → 用 `SHOW POOLS`/`SHOW STATS` 确认池工作正常
4. 压测：模拟生产并发，确认 `default_pool_size=25` 是否够用，无 "too many clients" 错误
5. 生产上线后首周每日巡检 `SHOW POOLS`，按需调整 `pool_size`

### Phase 3：测试补全

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| P3-1 | 监控视图冒烟测试 | P1 | 6 条 `SELECT count(*)` 验证视图可查询 |
| P3-2 | Cron job 幂等性测试 | P1 | 重跑验证不重复注册 |
| P3-3 | Cron job 功能验证 | P2 | 确认 3 个任务在测试环境执行成功 |

### Phase 4：持续治理

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| P4-1 | 建立 HiWmsSupabase → wms7 定期同步 SOP | P1 | 每当 DB 团队更新脚本时自动同步 |
| P4-2 | 监控视图纳入日常巡检手册 | P2 | 运维手册化 |
| P4-3 | 数据归档方案落地（180 天清理前 COPY） | P2 | 需与 DBA 团队协同设计 |

---

## 十一、阻塞/非阻塞分析（逐任务）

> 以下分析基于 2026-07-25 向 HiWmsSupabase 提交的 5 个 Issue 的修复状态。
> 阻塞标记：🔴 = 无法执行，🟡 = 部分阻塞，🟢 = 可立即执行

### 11.1 依赖关系矩阵

| # | 任务 | 阻塞状态 | 依赖的 Issue | 能否先行 |
|---|------|----------|-------------|----------|
| **P1-1** | fn_current_user_id() 验证 | 🟢 无阻塞 | — | ✅ 可立即执行 |
| **P1-2** | Device API secret_hash 验证 | 🟢 无阻塞 | — | ✅ 可立即执行 |
| **P1-3** | PgBouncer 兼容性验证 | 🟢 无阻塞 | — | ✅ 可立即执行 |
| **P2-1** | 执行 019 迁移 (CONCURRENTLY 索引) | 🟢 无阻塞 | — | ✅ 可立即执行 |
| **P2-2** | 注册 pg_cron 定时任务 | 🔴 阻塞 | [#39](https://github.com/AaronLucas/HiWmsSupabase/issues/39) fn_purge_old_action_logs 无批量删除<br>[#38](https://github.com/AaronLucas/HiWmsSupabase/issues/38) fn_expire_task_claims 未注册为 cron job | ❌ 等 DBA 修复 |
| **P2-3** | 部署监控视图 (6 views) | 🔴 阻塞 | [#35](https://github.com/AaronLucas/HiWmsSupabase/issues/35) 监控视图无访问控制 | ❌ 等 DBA 修复 |
| **P2-4** | PgBouncer 部署评估 | 🟢 无阻塞 | — | ✅ 可立即执行 |
| **P3-1** | 监控视图冒烟测试 | 🟡 本地可跑 | [#35](https://github.com/AaronLucas/HiWmsSupabase/issues/35) (仅生产阻塞) | ✅ 本地/测试环境可跑 |
| **P3-2** | Cron job 幂等性测试 | 🟢 无阻塞 | [#39](https://github.com/AaronLucas/HiWmsSupabase/issues/39) (生产才触发，测试环境数据量小) | ✅ 可立即执行 |
| **P3-3** | Cron job 功能验证 | 🟢 无阻塞 | [#39](https://github.com/AaronLucas/HiWmsSupabase/issues/39) (测试环境不触发) | ✅ 可立即执行 |
| **P4-1** | 定期同步 SOP | 🟢 无阻塞 | — | ✅ 可立即执行 |
| **P4-2** | 监控巡检手册 | 🟢 无阻塞 | — | ✅ 可立即执行 |
| **P4-3** | 数据归档方案 | 🟢 无阻塞 | — | ✅ 可立即执行 |

### 11.2 统计

| 分类 | 数量 | 任务 |
|------|------|------|
| 🟢 可立即执行 | **9** | P1-1, P1-2, P1-3, P2-1, P2-4, P3-2, P3-3, P4-1, P4-2 |
| 🟡 本地/测试环境可跑 | **1** | P3-1 (生产环境需等 #35) |
| 🔴 阻塞 | **2** | P2-2 (等 #38 + #39), P2-3 (等 #35) |
| **总计** | **12** | — |

### 11.3 执行路径建议

```
立即执行（无需等 DBA）:
  P1-1 → P1-2 → P1-3 (应用层验证, 并行)
  P2-1 → P2-4 (运维基础设施, 顺序)
  P3-2 → P3-3 → P3-1 (测试, 测试环境)
  P4-1 → P4-2 → P4-3 (治理, 并行)
                                ↓ 等 DBA 修复后
  P2-2 → P2-3 (运维部署收尾)
```

### 11.4 关联 Issue 状态

| Issue | 仓库 | 标题 | 严重度 | 状态 |
|-------|------|------|--------|------|
| [#35](https://github.com/AaronLucas/HiWmsSupabase/issues/35) | HiWmsSupabase | 监控视图无访问控制：v_slow_queries 暴露原始 SQL | 🔴 CRITICAL | 待处理 |
| [#36](https://github.com/AaronLucas/HiWmsSupabase/issues/36) | HiWmsSupabase | fn_expire_stalled_sync_events 将 payload 写入 exceptions | 🔴 CRITICAL | 待处理 |
| [#37](https://github.com/AaronLucas/HiWmsSupabase/issues/37) | HiWmsSupabase | v_table_bloat_detailed 全库表扫描 | 🟡 HIGH | 待处理 |
| [#38](https://github.com/AaronLucas/HiWmsSupabase/issues/38) | HiWmsSupabase | fn_expire_task_claims 未注册 cron job | 🔵 MEDIUM | 待处理 |
| [#39](https://github.com/AaronLucas/HiWmsSupabase/issues/39) | HiWmsSupabase | fn_purge_old_action_logs 无批量删除 | 🔴 CRITICAL | 待处理 |

---

## 附录：部署顺序

```
1. 确认 001-018 迁移全部执行完成
2. 维护窗口手动执行 019（CONCURRENTLY 索引，CI 跳过）
3. 执行 unWMS_Setup_Cron_Jobs_V2.1.sql（注册 pg_cron 任务）
4. 执行 unWMS_Monitoring_Views_V1.sql（部署监控视图）
5. 部署 PgBouncer（基础设施层，与应用部署独立）
```
