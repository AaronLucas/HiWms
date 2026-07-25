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
| P1-2 | 验证 Device API 的 `secret_hash` 写入格式（bcrypt/argon2） | P1 | ⏳ | 018 新增列 |
| P1-3 | PgBouncer transaction 模式对 Supabase client 兼容性验证 | P2 | ⏳ | 确认 prepared statements 行为 |

#### P1-1 验证详情（2026-07-26）

**结论**：`fn_current_user_id()` 在 Express API 会话中**始终返回 NULL**。

**根因**：`WmsSupabaseClient` 是单例，用 `anonKey` 创建（`SupabaseClient.ts:92-95`），
无 per-request JWT 注入机制。Express auth middleware 提取 JWT 后仅存入 `req.context.user`
内存对象，未注入到下游 Supabase client。所有 DB 请求带着 `Authorization: Bearer <anonKey>`
发出，`auth.uid()` 无用户 JWT → 返回 NULL，`fn_current_user_id()` 的 EXCEPTION handler
捕获并返回 NULL。

**调用链**：
```
Express auth middleware → verifyToken(JWT) → req.context.user ✅
WmsSupabaseClient.getClient() → singleton, anonKey only → DB request
→ Authorization: Bearer <anonKey> (NO user JWT)
→ auth.uid() → NULL
→ fn_current_user_id() → EXCEPTION → NULL
```

**影响**：

| 调用方 | 文件 | NULL 路径行为 |
|--------|------|---------------|
| RLS policies (storage) | `008:101-102,139` | `fn_is_platform_admin(NULL)` → 不识别管理员 |
| `fn_resolve_exception` | `017:73-76` | 身份校验跳过 → 失去防冒充保护 |
| `check_user_permission` | `013:55` | 自检场景降级 |

**修复方向**：在 `WmsSupabaseClient.rpc()` 增加 `userToken` 选项，支持 per-request 创建
带用户 JWT 的临时 Supabase client；或在 `ExpressMiddlewareFactory.authenticate()` 中
将 JWT 注入到请求级 Supabase client。详见 `src/adapters/supabase/SupabaseClient.ts` 和
`src/adapters/supabase/rpc/SupabaseRpcClient.ts`。

### Phase 2：运维部署

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| P2-1 | 生产维护窗口执行 019 迁移（CONCURRENTLY 索引） | P0 | 当前可能尚未执行 |
| P2-2 | 注册 pg_cron 定时任务（幂等脚本） | P1 | 需确认 pg_cron 扩展已启用 |
| P2-3 | 部署监控视图 | P1 | 需确认 pg_stat_statements/pgstattuple 扩展已启用 |
| P2-4 | PgBouncer 部署评估 | P2 | 评估当前连接数是否需连接池 |

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
