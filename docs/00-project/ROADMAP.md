# WMS 项目全局任务树

> 基于已完成的架构设计、数据库 Schema、API 设计、RBAC 系统生成的完整实施路线图。

---

## 阶段 0：基础设施与工具链（已完成 ✅）

- [x] Git 仓库初始化
- [x] package.json / tsconfig.json 配置（含 Redux Toolkit）
- [x] 目录结构创建（src、test、docs、cloudflare 等）
- [x] Cloudflare Workers 缓存原型（含 RBAC 拦截）
- [x] RBAC 数据库 Schema 与权限检查函数
- [x] API 设计文档（docs/API.md）

---

## 阶段 1：核心后端服务实现（Supabase + Edge Functions）

### 1.1 Supabase 数据库迁移与种子数据
- [x] 替换迁移脚本为 V2.1 统一全量脚本（`supabase/migrations/001_initial_schema.sql`）
- [x] 同步更新 `docs/03-database/DB_SCHEMA.md` 与 V2.1 SQL 严格对齐
- [ ] 编写种子数据脚本（系统角色、基础权限、演示租户、默认库位类型、承运商面单模板）
- [ ] 在 Supabase Dashboard 执行迁移并验证（含 RLS、CHECK 约束、触发器、视图、RPC）

### 1.2 核心业务 RPC / Edge Functions
- [x] `fn_logic_stock_allocation`（跨箱分配：散货优先→FEFO→入库时间）
- [x] `fn_logic_resolve_blackbox_box`（黑盒入库解析：扫箱不扫货，开箱确认 SKU）
- [x] `fn_trg_inventory_version_manager`（乐观锁版本自增触发器）
- [x] `fn_trg_inventory_history`（库存变动历史审计触发器）
- [x] `check_user_permission`（RBAC 权限检查 RPC，SECURITY DEFINER）
- [x] `fn_match_cross_dock`（直通匹配：入库单+SKU→匹配出库单，按优先级/截单时间）
- [x] `fn_allocate_chute`（滑道分配：优先填满已用滑道、集中分拣）
- [x] `fn_verify_weight`（重量校验：基于验货规则当前生效版本）
- [x] `fn_get_active_billing_rule`（查询生效计费规则：规范化表优先，回退 JSONB）
- [x] `fn_trg_enforce_product_constraints`（存储合规强校验：库位类型/冷链/危险品互斥）
- [x] `fn_current_tenant_id`（获取当前租户 ID：优先 JWT app_metadata，回退 users 表）
- [x] `fn_cross_dock_timeout_sweep`（直通超时自动降级 FALLBACK，可挂 pg_cron）
- [x] `fn_purge_old_action_logs`（历史日志清理：wo_action_logs + inventory_history，可挂 pg_cron）

### 1.2 核心业务 RPC / Edge Functions
- [ ] `fn_logic_stock_allocation`（185 件跨箱分配逻辑）
- [ ] `fn_logic_resolve_blackbox_box`（黑盒入库解析）
- [ ] `fn_trg_inventory_version_manager`（乐观锁版本管理）
- [ ] `fn_trg_inventory_history`（库存变动历史触发器）
- [ ] `check_user_permission`（已在 SQL 中定义，需部署并授权）

### 1.3 云函数扩展（Cloudflare Workers）
- [ ] 扩展缓存键策略：支持 `products`、`inventory`、`orders` 等高频读表
- [ ] 实现条件刷新：写操作后自动失效对应 KV 键
- [ ] 添加请求速率限制（每租户每分钟 120 次）
- [ ] 集成 Supabase Realtime 订阅转发（可选）

---

## 阶段 2：前端应用（Uniapp Vue3）

### 2.1 项目骨架与工程化
- [ ] 创建 Uniapp Vue3 + TypeScript + Pinia + Vite 项目
- [ ] 配置 ESLint + Prettier + Stylelint
- [ ] 集成 `@supabase/supabase-js` 与自定义 API 客户端
- [ ] 封装统一请求拦截器（自动注入 `tenant_id`、JWT、错误码处理）

### 2.2 核心页面模块（按优先级）
| 模块 | 页面 | 关键交互 |
|------|------|----------|
| **登录/鉴权** | 登录、忘记密码、租户选择 | JWT 存储、自动续期 |
| **仪表盘** | 老板驾驶舱、库存概览、补货预警 | 实时图表、WebSocket 订阅 |
| **物料管理** | 列表、详情、新增/编辑、约束配置 | 批量导入、条码扫描 |
| **库位管理** | 可视化库位图、容量监控、冻结/解冻 | 拖拽调整、ABC 分区高亮 |
| **库存管理** | 实时库存表、历史变动、预留/锁定 | 乐观锁冲突提示、批次/效期筛选 |
| **订单管理** | 订单列表、详情、状态流转、分配执行 | 波次关联、拣货单打印 |
| **波次管理** | 波次创建、策略配置、订单分配、进度追踪 | 甘特图、异常标记 |
| **作业工单** | PDA 端工单列表、执行录入、异常上报 | 离线缓存、扫码枪集成 |
| **增值服务** | VAS BOM 维护、组装/拆卸工单 | 物料清单核对 |
| **财务计费** | 账单列表、明细、导出、对账 | 多币种、阶梯定价演示 |
| **系统管理** | 用户/角色/权限、租户配置、审计日志 | RBAC 可视化编辑器 |

### 2.3 组件库与通用逻辑
- [ ] 表格、表单、模态框、下拉树、条码扫描器封装
- [ ] 权限指令（`v-permission`）与路由守卫
- [ ] 国际化（中/英）与主题切换

---

## 阶段 3：自动化测试体系

- [ ] 单元测试（Jest + Vue Test Utils）覆盖 ≥ 80% 核心逻辑
- [ ] 集成测试（Supabase 本地实例 + Cloudflare Miniflare）
- [ ] E2E 测试（Playwright）覆盖关键业务流程
- [ ] 性能测试（k6）模拟 100 并发租户
- [ ] 安全测试（SQL 注入、XSS、权限越界）

---

## 阶段 4：CI/CD 与发布流水线

### 4.1 GitHub Actions Workflows
- [ ] `ci.yml`：Lint → TypeCheck → Unit Test → Build
- [ ] `cd-staging.yml`：合并到 `main` 自动部署到 Staging（Cloudflare Pages + Supabase Preview Branch）
- [ ] `cd-production.yml`：Tag 触发生产部署（蓝绿/金丝雀）

### 4.2 版本管理
- [ ] 语义化版本（SemVer）自动生成
- [ ] CHANGELOG 自动生成（conventional commits）
- [ ] Release Notes 自动生成

---

## 阶段 5：容器化与部署（DevOps）

### 5.1 Docker
- [ ] `Dockerfile.frontend`（多阶段构建，Nginx 服务静态资源）
- [ ] `Dockerfile.worker`（Cloudflare Worker 不需容器，但可打包为边缘函数镜像）
- [ ] `docker-compose.yml`（本地全栈：Supabase Local + Frontend + Miniflare）

### 5.2 Kubernetes（生产环境）
- [ ] `k8s/namespace.yaml`
- [ ] `k8s/deployment-frontend.yaml`（HPA、资源限制）
- [ ] `k8s/service-frontend.yaml`
- [ ] `k8s/ingress.yaml`（TLS、WAF 规则）
- [ ] `k8s/configmap.yaml` / `secret.yaml`（环境变量、密钥）
- [ ] Helm Chart 打包（`helm/package.sh`）

### 5.3 部署策略
- [ ] 蓝绿部署脚本（`scripts/blue-green-deploy.sh`）
- [ ] 金丝雀发布脚本（`scripts/canary-deploy.sh`）
- [ ] 回滚脚本（`scripts/rollback.sh`）
- [ ] 健康检查与存活探针配置

---

## 阶段 6：可观测性与运维

### 6.1 监控
- [ ] Prometheus 配置（`monitoring/prometheus.yml`）
- [ ] Grafana 仪表盘（请求延迟、错误率、缓存命中率、业务指标）
- [ ] Supabase 指标导出（pg_stat_statements、连接池）

### 6.2 日志
- [ ] Loki + Promtail 配置（`monitoring/loki.yml`）
- [ ] 结构化日志输出（JSON，含 trace_id、tenant_id、user_id）
- [ ] 日志保留策略（热 7 天、冷 90 天）

### 6.3 告警
- [ ] Alertmanager 规则（CPU/内存/磁盘、错误率 > 1%、P99 延迟 > 2s）
- [ ] 通知渠道：钉钉/企业微信/Email/PagerDuty

### 6.4 安全审计
- [ ] 依赖漏洞扫描（`npm audit`、`trivy`）
- [ ] 运行时安全（Falco 规则）
- [ ] 权限最小化审计（定期检查 RBAC 策略）

---

## 阶段 7：文档与知识管理

- [ ] API 文档自动发布到 GitHub Pages（`docs/API.md` → `gh-pages`）
- [ ] 架构决策记录（ADR）目录（`docs/adr/`）
- [ ] 运维手册（`docs/runbook/`）：部署、回滚、扩容、故障排查
- [ ] 开发者指南（`docs/dev-guide.md`）：环境搭建、编码规范、提交流程

---

## 阶段 8：进阶功能与扩展（后续迭代）

- [ ] WebSocket 实时库存/工单推送（Supabase Realtime）
- [ ] AI 需求预测微服务（Python/FastAPI + 模型服务）
- [ ] 第三方物流 EDI/API 网关
- [ ] 多语言/多币种/多时区完善
- [ ] 移动端 PDA 专用模式（离线优先、条码枪深度集成）

---

## 任务依赖关系摘要

```
阶段0
  └─ 阶段1.1 → 阶段1.2 → 阶段1.3
       └─ 阶段2（前端需后端 API 可用）
            └─ 阶段3（测试需前后端集成）
                 └─ 阶段4（CI/CD 需测试通过）
                      ├─ 阶段5（容器化部署）
                      ├─ 阶段6（可观测性）
                      └─ 阶段7（文档）
                           └─ 阶段8（进阶功能）
```

---

## 预估工时（人周）

| 阶段 | 预估工时 | 备注 |
|------|----------|------|
| 1 | 3-4 | 含数据库迁移调试 |
| 2 | 6-8 | 核心页面较多，建议并行开发 |
| 3 | 2-3 | 可与阶段2并行 |
| 4 | 1-2 | 模板化配置 |
| 5 | 2-3 | K8s 调试耗时较长 |
| 6 | 1-2 | 监控大盘建设 |
| 7 | 1 | 文档自动化 |
| 合计 | **16-25** | 视团队规模可并行压缩至 8-12 周 |

---

## 里程碑

| 里程碑 | 目标日期 | 交付物 |
|--------|----------|--------|
| M1：后端核心可用 | 第 3 周 | Supabase 迁移完成、RPC 部署、Worker 缓存生效 |
| M2：前端 MVP 可演示 | 第 7 周 | 登录、仪表盘、物料/库存/订单 CRUD 完整跑通 |
| M3：Staging 环境上线 | 第 9 周 | CI/CD 全自动、监控告警生效、文档发布 |
| M4：生产就绪 | 第 12 周 | 蓝绿部署演练通过、安全审计通过、性能达标 |
| M5：正式发布 v1.0.0 | 第 13 周 | Tag 发布、Release Notes、运维手册交付 |

---

*本任务树将随项目进展自动更新。每个任务完成后会自动提交并同步到 CLAUDE.md。*

---

## 文档结构重构记录 (2025-07-07)

已完成项目文档归档到 `docs/` 分类目录：

| 原位置 | 新位置 | 说明 |
|--------|--------|------|
| `ARCHITECTURE.md` | `docs/01-architecture/ARCHITECTURE.md` | 系统架构、数据流、技术栈、ADR 索引 |
| `API_SPEC.md` | `docs/02-api/API_SPEC.md` | API 端点定义、响应格式、安全 |
| `DB_SCHEMA.md` | `docs/03-database/DB_SCHEMA.md` | 表结构、RLS 策略状态、迁移对应 |
| `WORKFLOWS.md` | `docs/04-workflows/WORKFLOWS.md` | 业务流、CI/CD、Git 策略、部署、暂停节点 |
| `OPS.md` | `docs/05-operations/OPS.md` | 监控、日志、告警、容量、安全、备份、环境变量 |
| `AGENTS.md` | `docs/06-agents/AGENTS.md` | Agent 体系、Skill、MCP、规则引擎、上下文 |
| `ROADMAP.md` | `docs/00-project/ROADMAP.md` | 任务树、里程碑、依赖关系 |
| (新增) | `docs/00-project/CONVENTIONS.md` | 编码约定、命名、Git 规范、审查清单 |
| (新增) | `docs/07-development/DEVELOPMENT.md` | 开发命令、Docker、部署脚本、排查指南 |

根目录 `CLAUDE.md` 保留核心规则、RTK 指令、暂停节点，**新增文档索引**指向 `docs/` 结构。

---

## V2.1 Schema 迁移执行记录 (2026-07-08)

| 执行项 | 状态 | 产出 | 备注 |
|--------|------|------|------|
| 替换迁移脚本 | ✅ 完成 | `supabase/migrations/001_initial_schema.sql` (93KB) | 3 个历史文件 → 1 个 V2.1 统一脚本 |
| 历史迁移备份 | ✅ 完成 | `supabase/migrations.backup.2026-07-08_07-59-27/` | 可随时回滚 |
| DB_SCHEMA.md 同步重写 | ✅ 完成 | `docs/03-database/DB_SCHEMA.md` v2.1.0 | 38 表全覆盖、RLS/CHECK/触发器/视图/RPC 全对齐 |
| ROADMAP 进度同步 | ✅ 完成 | 本文件 | 阶段 1.1/1.2 关键项标记完成 |
| 执行计划文档 | ✅ 完成 | `docs/04-workflows/EXECUTION_PLAN_V21_MIGRATION.md` | 4 阶段可验证、可回滚方案 |

> **后续**：创建种子数据脚本、同步 API_SPEC.md、新增 ADR 记录（P1 任务）