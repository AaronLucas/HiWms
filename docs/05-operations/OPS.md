# OPS.md

## 运维体系设计

本文档定义系统的监控、日志、报警、性能分析、容量规划及安全审计体系。

---

## 1. 监控体系

### 1.1 监控架构
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  应用/基础设施 │ ──► │  Prometheus  │ ──► │  Grafana    │
│  Exporters   │     │  (TSDB)      │     │  Dashboards │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Node/容器   │     │  Alertmanager │     │  通知渠道   │
│  级指标      │     │  (路由/抑制)  │     │ (钉钉/邮件) │
└─────────────┘     └─────────────┘     └─────────────┘
```

### 1.2 核心指标体系

#### 业务级指标 (SLA 关键)
| 指标名 | 类型 | 采集间隔 | 告警阈值 | 说明 |
|--------|------|----------|----------|------|
| `wms_api_latency_p99` | Histogram | 15s | > 500ms | API P99 延迟 |
| `wms_api_error_rate` | Counter/Rate | 30s | > 1% | API 错误率 |
| `wms_order_throughput` | Counter | 1m | < 100/min | 订单吞吐量异常低 |
| `wms_inventory_accuracy` | Gauge | 5m | < 99.9% | 库存准确率 |
| `wms_tenant_active` | Gauge | 5m | 突变告警 | 活跃租户数 |

#### 基础设施指标
| 指标名 | 采集源 | 告警阈值 |
|--------|--------|----------|
| `container_cpu_usage` | cAdvisor | > 80% (5m) |
| `container_memory_usage` | cAdvisor | > 85% (5m) |
| `postgres_connections` | PG Exporter | > 80% max_connections |
| `postgres_replication_lag` | PG Exporter | > 30s |
| `cloudflare_worker_cpu_time` | CF Analytics | > 50ms 平均 |
| `kv_operations_failed` | CF Analytics | > 0.1% |

### 1.3 关键仪表盘
| 仪表盘 | 刷新频率 | 核心面板 |
|--------|----------|----------|
| **业务概览** | 30s | 订单量、库存周转、计费金额、活跃租户 |
| **API 性能** | 15s | 延迟热力图、错误率趋势、Top 10 慢接口 |
| **数据库健康** | 30s | 连接池、慢查询、复制延迟、磁盘空间 |
| **边缘计算** | 1m | Worker 执行时间、KV 命中率、错误分布 |
| **租户隔离** | 5m | 租户级 QPS、错误率、资源配额使用率 |

### 1.4 DB 层监控视图（DBA 团队交付，2026-07-25）

> 脚本来源：`supabase/ops-scripts/unWMS_Monitoring_Views_V1.sql`  
> ECC 分析：`docs/03-database/DB_OPS_SCRIPTS_ECC_ANALYSIS.md`

DBA 团队交付了 6 个 PostgreSQL 原生监控视图，作为应用层 Prometheus/Grafana 监控的补充：

| 视图 | 数据来源 | 用途 | 巡检频率 | 告警阈值 |
|------|----------|------|----------|----------|
| `v_slow_queries` | `pg_stat_statements` | 慢查询 Top N | 每日/每周 | `mean_exec_time > 1000ms` |
| `v_unused_indexes` | `pg_stat_user_indexes` + `pg_index` | 无用索引候选清理（含 CANDIDATE_DROP 推荐） | 月度 | `recommendation='CANDIDATE_DROP' 且 > 10MB` |
| `v_table_bloat` | `pg_class` 公式估算 | 表膨胀估算 | 每周 | `bloat_pct > 30% 且 > 100MB` |
| `v_table_bloat_detailed` | `pgstattuple()` 精确扫描 | 精确死元组占比 | 维护窗口按需 | `dead_tuple_percent > 20%` |
| `v_rls_perf` | `pg_policy` + `pg_class` | RLS 策略性能审计 | 新增 RLS 策略后 | Seq Scan 检测 |
| `v_pg_cron_jobs` | `cron.job` + `cron.job_run_details` | 定时任务运行状态 | 每日 | `last_status != 'succeeded'` |

**⚠️ 关键风险**：
- `v_table_bloat_detailed` 使用 `CROSS JOIN LATERAL pgstattuple()` 无 WHERE 过滤——**严禁无表名过滤的全表查询**，会触发全库所有表的全表扫描。维护窗口按需针对特定表使用。
- 监控视图当前无 GRANT 授权——仅 superuser 和创建角色可查询。建议创建专用运维角色 `unwms_ops` 并授予 6 个视图的 SELECT 权限。

**与应用层监控的桥接策略**（待实施）：
- 方案 A：Prometheus PostgreSQL Exporter 定时查询视图 → Prometheus → Grafana
- 方案 B：Grafana PostgreSQL 数据源直连查询视图
- 方案 C：Express 中间件查询视图 → 暴露为 Prometheus-format metrics

### 1.5 pg_cron 定时任务（DBA 团队交付，2026-07-25）

> 脚本来源：`supabase/ops-scripts/unWMS_Setup_Cron_Jobs_V2.1.sql`

| 任务名 | 调度 | 调用函数 | 业务含义 | 数据操作 |
|--------|------|----------|----------|----------|
| `cross-dock-timeout-sweep` | `*/5 * * * *` | `fn_cross_dock_timeout_sweep()` | 直通作业超时自动降级 FALLBACK | UPDATE `cross_dock_jobs.status` |
| `purge-old-action-logs` | `0 3 * * *` | `fn_purge_old_action_logs(180)` | 清理 180 天前操作日志和库存历史 | DELETE from `wo_action_logs`, `inventory_history` |
| `expire-stalled-sync-events` | `*/5 * * * *` | `fn_expire_stalled_sync_events()` | 卡死 PROCESSING 超过 5 分钟的事件标记 EXCEPTION | UPDATE `sync_events` |

**🔴 CRITICAL 风险**：
- `fn_purge_old_action_logs` 使用**单条无批量 DELETE**——在高频仓库中可能涉及数千万行，单事务 DELETE 会导致长时间持锁、海量 WAL、可能超过 `statement_timeout`。**必须改为分批删除**（每批 10,000 行 + COMMIT + pg_sleep）。

**⚠️ 运维要点**：
- 幂等性：采用 `unschedule` + `schedule` 模式，可安全重复执行
- 依赖：需 `pg_cron` 扩展（Supabase 预装；自托管 PG 需 `shared_preload_libraries='pg_cron'`）
- 前置条件：001-018 迁移必须已执行完成
- 监控：每日检查 `cron.job_run_details` 确认 `last_status = 'succeeded'`
- 审计归档：日志清理是硬删除无归档——清理前如需保留，先 COPY 到 Supabase Storage
- **遗漏**：ROADMAP §1.4 期望注册 `fn_expire_task_claims` 作为 cron job，但当前脚本未包含此任务

**部署**：
```bash
psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/ops-scripts/unWMS_Setup_Cron_Jobs_V2.1.sql
```

### 1.6 PgBouncer 连接池管理（DBA 团队交付，2026-07-25）

> 配置来源：`supabase/ops-scripts/unWMS_PgBouncer_Config_V1.ini`

| 参数 | 建议值 | 说明 |
|------|--------|------|
| `pool_mode` | `transaction` | 事务完成后归还连接 |
| `default_pool_size` | `25` | 每库/用户对的服务端连接数 |
| `max_client_conn` | `100` | 前端连接总数上限（⚠️ WMS 大量 PDA 设备时可能不足） |
| `idle_transaction_timeout` | `30s` | 空闲事务超时强断——**应用层事务必须 < 30s 完成** |
| `query_wait_timeout` | `10s` | 等待可用连接超时 |
| `server_lifetime` | `3600s` | 1h 轮换连接（⚠️ 可能偏激进，建议 2-4h） |

**⚠️ 运维要点**：
- `disable_pqexec = 1` 需取消注释——transaction 模式下 prepared statements 无法跨事务复用
- `stats_users` 需配置——否则无法执行 `SHOW POOLS` / `SHOW STATS` 管理命令
- TLS 建议：生产环境启用 `client_tls_sslmode = require`
- 部署后首周每日执行 `SHOW POOLS` 巡检，按需调整 pool_size

**部署**：
```bash
cp supabase/ops-scripts/unWMS_PgBouncer_Config_V1.ini /etc/pgbouncer/pgbouncer.ini
# 修改 [databases] 指向真实 PostgreSQL 地址
# 配置 userlist.txt 或 auth_query
systemctl reload pgbouncer
```

---

## 2. 日志体系

### 2.1 日志架构
```
应用层 (Structured JSON) ──► Fluent Bit / Vector ──► Loki ──► Grafana Logs
                                  │
                                  ▼
                          对象存储 (S3/MinIO) ──► 归档/合规
```

### 2.2 日志规范
- **格式**：JSON Lines，必须包含字段：
  ```json
  {
    "timestamp": "2025-07-01T10:00:00.123Z",
    "level": "info|warn|error",
    "trace_id": "abc-123",
    "span_id": "def-456",
    "tenant_id": "tenant-uuid",
    "service": "inventory-service",
    "message": "Inventory updated",
    "context": { "sku_id": "...", "qty": 10 }
  }
  ```
- **采集路径**：
  - Kubernetes：DaemonSet (Fluent Bit) 采集 stdout/stderr
  - Cloudflare Workers：Logpush → Loki
  - Supabase：PostgreSQL 日志 → Logpush → Loki

### 2.3 保留策略
| 日志类型 | 热存储 (Loki) | 冷存储 (S3/MinIO) |
|----------|---------------|-------------------|
| 业务审计日志 | 30 天 | 7 年 (合规) |
| 应用调试日志 | 7 天 | 90 天 |
| 访问/网关日志 | 14 天 | 1 年 |
| 安全审计日志 | 90 天 | 7 年 |

---

## 3. 报警体系

### 3.1 报警分级
| 级别 | 定义 | 响应时效 | 通知渠道 | 升级策略 |
|------|------|----------|----------|----------|
| **P0 (Critical)** | 核心业务中断、数据丢失风险 | 5 分钟 | 电话 + 钉钉 + 短信 | 10 分钟升级至值班经理 |
| **P1 (High)** | 核心功能降级、错误率飙升 | 15 分钟 | 钉钉 + 邮件 | 30 分钟升级至技术负责人 |
| **P2 (Medium)** | 性能劣化、非核心功能异常 | 1 小时 | 钉钉 | 4 小时升级至值班工程师 |
| **P3 (Low)** | 资源预警、容量趋势 | 4 小时 | 邮件 | 下一个工作日处理 |

### 3.2 核心报警规则示例
```yaml
# P0: API 全链路不可用
- alert: APIHighErrorRate
  expr: rate(wms_api_errors_total[2m]) / rate(wms_api_requests_total[2m]) > 0.05
  for: 1m
  labels:
    severity: critical
    team: backend
  annotations:
    summary: "API 错误率超过 5%"
    runbook: "https://wiki.example.com/runbooks/api-high-error-rate"

# P1: 数据库连接池耗尽
- alert: PostgresConnectionPoolExhausted
  expr: pg_stat_activity_count / pg_settings_max_connections > 0.85
  for: 2m
  labels:
    severity: high
    team: dba
  annotations:
    summary: "PostgreSQL 连接池使用率超过 85%"

# P2: 租户配额即将耗尽
- alert: TenantQuotaNearLimit
  expr: tenant_quota_usage / tenant_quota_limit > 0.8
  for: 5m
  labels:
    severity: warning
    team: platform
  annotations:
    summary: "租户 {{ $labels.tenant_id }} 配额使用率超过 80%"
```

### 3.3 抑制与分组
- **分组**：同一租户/服务的多个告警在 5 分钟内合并为一条通知
- **抑制**：部署窗口内抑制 P2/P3 告警；已知维护窗口抑制所有非 P0 告警
- **静默**：支持通过 API/UI 创建临时静默（最长 4 小时）

---

## 4. 性能分析与容量规划

### 4.1 性能基线
| 组件 | 关键指标 | 目标值 (P99) | 当前基线 |
|------|----------|--------------|----------|
| API Gateway | 延迟 | < 100ms | 45ms |
| 数据库查询 | 简单查询 | < 50ms | 28ms |
| 数据库查询 | 复杂报表 | < 2s | 1.2s |
| Cloudflare Worker | 执行时间 | < 50ms | 32ms |
| KV 读取 | 命中延迟 | < 10ms | 4ms |
| KV 写入 | 写入延迟 | < 50ms | 22ms |

### 4.2 容量规划模型
| 资源 | 当前使用 | 增长预测 (月) | 扩容触发点 | 扩容动作 |
|------|----------|---------------|------------|----------|
| PostgreSQL 存储 | 120 GB | +15 GB/月 | > 70% | 垂直扩容 / 分区表 |
| PostgreSQL 连接 | 150/200 | +20/月 | > 80% | PgBouncer / 读写分离 |
| KV 存储 | 2 GB | +200 MB/月 | > 80% | 自动扩容 (CF 托管) |
| Worker CPU 时间 | 15M ms/天 | +10%/月 | > 80% 配额 | 优化代码 / 申请提额 |
| 对象存储 | 50 GB | +5 GB/月 | > 75% | 生命周期策略 / 分层存储 |

### 4.3 压测与基准
- **定期压测**：每月一次全链路压测（Locust/k6），验证扩容效果
- **混沌工程**：季度一次故障注入（Pod 杀掉、网络分区、DB 主从切换）
- **基准记录**：每次发布前后对比关键指标，防止性能回归

---

## 5. 安全审计与权限策略

### 5.1 审计日志范围
| 操作类型 | 记录内容 | 保留期 |
|----------|----------|--------|
| 登录/登出 | IP、UserAgent、MFA 结果 | 1 年 |
| 权限变更 | 角色分配、权限授予/撤销 | 7 年 |
| 敏感数据访问 | 导出、批量查询、PII 字段读取 | 7 年 |
| 计费/财务操作 | 单据创建、修改、作废 | 10 年 |
| 基础设施变更 | 部署、配置变更、权限提升 | 3 年 |

### 5.2 权限最小化策略
- **原则**：默认拒绝，显式授予
- **实施**：
  - 服务间通信：mTLS + SPIFFE 身份
  - 数据库：仅通过 RPC/函数访问，禁止直连表
  - Edge Functions：最小权限 Service Account
  - CI/CD：环境隔离，生产环境仅允许 Release Bot 推送

### 5.3 合规检查清单 (季度)
- [ ] GDPR/个人信息保护：数据导出/删除接口可用性
- [ ] 数据加密：传输加密 (TLS 1.3)、静态加密 (AES-256)
- [ ] 访问控制：定期回收过期权限、清理僵尸账号
- [ ] 漏洞管理：依赖扫描、容器镜像扫描、定期渗透测试
- [ ] 事件响应：演练记录、复盘报告、改进措施落地

### 5.4 禁止对生产项目执行 `supabase config push`（2026-08-01 新增）
- **风险**：`supabase/config.toml` 是本仓库供本地 `supabase start` / CI Docker Postgres 使用的配置文件（DBA 从 `HiWmsSupabase` 仓库同步，本仓库内 gitignored）。Supabase CLI 提供 `supabase link --project-ref <ref>` + `supabase config push` 命令，会把这份本地 `config.toml` **整份覆盖**推送到已 link 的生产项目，而不是增量合并。
- **具体隐患**：本地 `config.toml` 的 `[auth.captcha]` 目前是注释掉（未启用）状态。若有人误对生产 project-ref 执行 `config push`，会静默关闭生产环境 Authentication → Attack Protection 下已配置的 CAPTCHA（hCaptcha/Turnstile），且不会有明显报错提示。
- **规则**：
  - 禁止对生产 project-ref 执行 `supabase link` + `config push`，除非是有意且明确要同步 Auth/API 等配置到生产（需 DBA + 负责人双人确认）。
  - 本仓库当前工作流中 `supabase link` 仅用于 `supabase db push`（迁移）与 `supabase gen types`（生成类型），详见 `docs/07-development/DEVELOPMENT.md` §2.3，不涉及 `config push`。
  - 生产环境 Authentication 相关设置（Rate Limits / Attack Protection 等）只通过 Supabase Cloud Dashboard 手动配置，不通过本仓库的 `config.toml` 同步（也没有反向的 `config pull`——截至 2026-08，该命令仅是 Supabase 官方 GitHub Discussion 中的功能请求，尚未发布）。

---

## 6. 备份与灾难恢复

| 对象 | 备份频率 | 保留策略 | RPO | RTO | 验证频率 |
|------|----------|----------|-----|-----|----------|
| PostgreSQL (全量) | 每日 02:00 | 30 天 + 月末保留 1 年 | 24h | < 2h | 每周恢复演练 |
| PostgreSQL (WAL) | 连续归档 | 7 天 | < 5min | < 30min | 每月 PITR 测试 |
| Loki 日志 | 增量同步 | 90 天热 + 1 年冷 | 1h | < 1h | 季度抽查 |
| 对象存储 | 版本控制 + 跨区复制 | 永久 | 0 | < 1h | 半年恢复演练 |
| Kubernetes 资源 | GitOps (ArgoCD) | Git 历史永久 | 0 | < 15min | 每次部署自动验证 |

### 灾难恢复演练
- **月度**：单表/单租户数据恢复演练
- **季度**：全库异地恢复演练 (RTO/RTO 验证)
- **年度**：全链路故障模拟 (数据中心级故障)

---

## 7. 运维操作手册索引
| 场景 | Runbook 链接 | 负责人 |
|------|--------------|--------|
| API 错误率飙升 | `/runbooks/api-high-error-rate` | Backend On-call |
| 数据库主从切换 | `/runbooks/pg-failover` | DBA |
| 租户数据误删恢复 | `/runbooks/tenant-data-restore` | Platform |
| Cloudflare Worker 部署失败 | `/runbooks/cf-worker-deploy-fail` | Edge Team |
| 证书过期/轮换 | `/runbooks/cert-rotation` | SecOps |
| 容量扩容 (PG/K8s/CF) | `/runbooks/capacity-scale` | Platform |

---

## 8. 版本记录
| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-07-01 | 初始版本：监控、日志、报警、容量、安全、备份体系 |
| 1.1.0 | 2025-07-07 | 新增环境变量配置参考、监控配置文件路径 |

---

## 9. 环境变量配置参考

### 9.1 必需变量
```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # 仅服务端

# 认证
JWT_SECRET=your-super-secret-key-min-32-chars
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
```

### 9.2 可选变量
```env
# 服务
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug

# Redis (缓存/会话/队列)
REDIS_URL=redis://localhost:6379

# 监控
PROMETHEUS_URL=http://prometheus:9090
GRAFANA_URL=http://grafana:3000
LOKI_URL=http://loki:3100

# 通知
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
PAGERDUTY_INTEGRATION_KEY=xxx

# CAPTCHA（仅日志标记用，见 §5.4；实际是否校验由 Supabase Cloud Dashboard →
# Authentication → Attack Protection 决定，不由本变量控制）
# CAPTCHA_PROVIDER=hcaptcha   # 可选值：hcaptcha | turnstile；不设为未启用

# 存储
S3_ENDPOINT=https://s3.example.com
S3_ACCESS_KEY=xxx
S3_SECRET_KEY=xxx
S3_BUCKET=wms-backups
```

### 9.3 环境差异配置
| 变量 | Local | Staging | Production |
|------|-------|---------|------------|
| `NODE_ENV` | development | staging | production |
| `LOG_LEVEL` | debug | info | warn |
| `SUPABASE_URL` | http://localhost:54321 | https://staging.supabase.co | https://prod.supabase.co |
| `REDIS_URL` | redis://localhost:6379 | redis://staging-redis:6379 | redis://prod-redis:6379 |
| `JWT_SECRET` | dev-secret | staging-secret (K8s Secret) | prod-secret (K8s Secret) |

### 9.4 CI/CD Secrets（GitHub Actions，非运行时应用变量，2026-07-20 新增）

#### 两个仓库的 Secret 现状

| 仓库 | 当前 Secret | 用途 | 是否自动生成/轮换 |
|---|---|---|---|
| **HiWms**（本仓库） | `HIWMS_SUPABASE_DEPLOY_KEY` | `db-integration.yml` 与 `secret-health-check.yml` 用它以只读 Deploy Key checkout [HiWmsSupabase](https://github.com/AaronLucas/HiWmsSupabase) | 否，GitHub Deploy Key 默认**无过期时间**，只能手动吊销/轮换 |
| **HiWmsSupabase**（DBA 迁移仓库） | 无 | 该仓库 CI 只在本地起一次性 Postgres 容器跑迁移，不需要访问其他仓库或外部服务 | 不适用 |

> **常见误解澄清**：HiWmsSupabase 仓库本身没有任何生成 Secret 的 workflow；那把只读 key 的**公钥**是加在 HiWmsSupabase 的 Deploy keys 里，而**私钥**是存在 HiWms 仓库的 Actions Secrets 里。两边都不是靠"自动生成 Secret"来防止 CI 过期，而是 Deploy Key 本身无过期时间。

#### Secret 清单

| Secret 名称 | 用途 | 类型/有效期 |
|---|---|---|
| `HIWMS_SUPABASE_DEPLOY_KEY` | `.github/workflows/db-integration.yml` 与 `.github/workflows/secret-health-check.yml` 用它 checkout 独立仓库 [HiWmsSupabase](https://github.com/AaronLucas/HiWmsSupabase)（DBA 团队管理的迁移脚本仓库） | SSH 只读 Deploy Key，绑定该仓库单一权限，**无过期时间**（区别于个人 PAT，不会因账号会话/token 轮换而断，只能手动吊销）。公钥已加为 HiWmsSupabase 的 read-only deploy key |

#### 健康检查
- `.github/workflows/secret-health-check.yml`：每月 1 日自动验证 `HIWMS_SUPABASE_DEPLOY_KEY` 是否仍能 checkout HiWmsSupabase；失败即告警。
- 也可通过 `workflow_dispatch` 手动触发验证。

#### 轮换/吊销流程
建议每 12 个月或在以下场景主动轮换：
1. 在 HiWmsSupabase 仓库 Settings → Deploy keys 里删除旧公钥。
2. 本地生成新的 SSH key pair：`ssh-keygen -t ed25519 -C "hiwms-supabase-deploy-key" -f hiwms-supabase-deploy-key`。
3. 在 HiWmsSupabase 仓库添加新公钥为 read-only deploy key。
4. 在 HiWms 仓库更新 Secret：`gh secret set HIWMS_SUPABASE_DEPLOY_KEY < hiwms-supabase-deploy-key`。
5. 触发 `.github/workflows/secret-health-check.yml` 确认新 key 有效。

两步操作互不依赖生产环境。

---

## 10. 监控配置文件路径

| 组件 | 配置文件 | 说明 |
|------|----------|------|
| Prometheus | `monitoring/prometheus.yml` | 抓取规则、告警规则引用 |
| Alertmanager | `monitoring/alertmanager.yml` | 路由、抑制、接收器 |
| Grafana | `monitoring/grafana-dashboards/*.json` | 仪表盘 JSON 定义 |
| Loki | `monitoring/loki.yml` | 存储、保留、索引配置 |
| Promtail | `monitoring/promtail.yml` | 日志采集 Pipeline |