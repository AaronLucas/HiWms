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
- [x] 编写种子数据脚本（系统角色、基础权限、演示租户、默认库位类型、承运商面单模板）
- [x] 在 Supabase Dashboard 执行迁移并验证（含 RLS、CHECK 约束、触发器、视图、RPC）

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


### 1.4 PDA 离线同步核心后端（P0，2026-07-15 按 DBA 新方案 ADR-011 重写，替代原状态同步/OT-CRDT 任务项）

> 设计依据：`docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md` v2.0.0、`docs/01-architecture/ADR/011-offline-sync-operation-log-exception-domain.md`。数据库表/函数设计已在 `docs/03-database/DB_SCHEMA.md` §2.10-2.14/§4 落地为文档。
>
> **构建健康度更新（2026-07-16）**：此前记录的"现有 RPC→Repository 重构止血（Phase 0）"已被其他并行工作解决——`origin/main`（`ac3da7a` 及其之前的 `3a77d84`/`b9f7ac6`）已完成 Phase 1-3 仓储层实现，`npx tsc --noEmit` 现为**零错误**。Phase 0 不再是本节的阻塞项。

> ⛔ **数据库脚本改动需要 DBA 协调，未确认前不得起草/执行/推送任何相关迁移** ⛔
> 本节下方 Layer 2/3/4 涉及的所有迁移脚本工作（修正本地 `supabase/migrations/003_extend_sync_event_actions.sql` 的真实 bug、新增 `004_tracking_policy_missing_label.sql`），**必须先由用户与 DBA 团队完成协调确认**，才能进入起草/执行阶段。本节当前状态只是设计对齐，不代表可以直接动手改脚本。

- [ ] **迁移脚本落地（Layer 2）**：把 `task_claims`/`sync_policies`/`device_sync_state`/`sync_events`/`exception_type_catalog`/`exceptions`/`exception_events` 7 表 + `inventory_reservations.work_order_id` + `order_lines.EXCEPTION` 状态固化为正式迁移脚本（并入部署流程；`supabase/` 已 `.gitignore`，脚本版本化事实来源见 DB_SCHEMA.md）
- [ ] 补齐仓储层（Layer 2）：`IExceptionRepository`/`ISyncEventRepository`/`ITaskClaimRepository`/`ISyncPolicyRepository`/`IDeviceSyncStateRepository` 端口 + Supabase 适配器实现（见 REPOSITORY_ROADMAP.md Phase 5）
- [ ] 部署 Device API `/sync/events`（提交动作事件）、`/sync/pull`（增量拉取）、`/sync/policy`（查询离线策略）端点 —— **注意：代码库目前只有 `src/apps/admin-api`，`device-api` 应用尚不存在，这是比迁移脚本更大的一块工作量**
- [ ] 部署任务领用/释放端点：`POST /tasks/{id}/claim`（`fn_claim_task`）、`POST /tasks/claims/{id}/release`（`fn_release_task_claim`）
- [ ] 部署统一异常查看端点：`GET /exceptions`、`GET /exceptions/{id}`（设备端只读）+ Web 管理端 `fn_resolve_exception` 处理入口
- [ ] 配置 pg_cron 定时任务：`fn_expire_task_claims`（建议每 1~5 分钟，任务租约过期清扫+自动登记 `TASK_CLAIM_EXPIRED` 异常）
- [ ] 补充权限种子数据：`permissions`/`role_permissions` 覆盖 `exception_type_catalog.required_permission_resource`（inventory_exception/compliance_exception/sync_exception/task_exception/fulfillment_exception/billing_exception/manual_exception）
- [ ] **待业务/合规确认（非工程任务，登记跟踪）**：危险品/冷链相关 task_type/zone_type 的 `ONLINE_ONLY` 判定与 `max_offline_duration_seconds` 具体数值，需合规负责人签字确认后录入 `sync_policies`

#### 1.4.1 Layer 3：同步动作扩展 PUTAWAY/COUNT/PACK（2026-07-16 新增，DBA 对开发团队 PR 的修正重新实现）

> 设计依据：`docs/02-api/SYNC_ACTIONS_EXTENSION.md`、`docs/01-architecture/ADR/013-sync-actions-extension.md`。**这不是新功能，是对本地已存在的 `supabase/migrations/003_extend_sync_event_actions.sql`（含真实语法错误、并发丢单 bug、表结构引用错误）的修正版重新实现**——原文件保留在本地磁盘，尚未被替换。

- [ ] **迁移脚本修正**：用 DBA 提供的修正版逻辑重写本地 `003_extend_sync_event_actions.sql`（原子库存写入原语 `fn_adjust_inventory_at_location`/`fn_reconcile_location_count`、`inventory_count_policies` 可配置容差表、`packing_task_items` 明细行表、`REFERENCE_NOT_FOUND` 异常类型、修正后的 `fn_apply_putaway_action`/`fn_apply_count_action`/`fn_apply_pack_action`）—— **需先完成与 DBA 团队的协调确认**（见上方阻塞提示），确认后先起草不执行
- [ ] 补齐仓储层（Layer 3）：`IPackingTaskItemRepository`/`IInventoryCountPolicyRepository`（见 REPOSITORY_ROADMAP.md）
- [ ] Device API 新增 `POST /putaway`、`POST /count`、`POST /pack` 端点（均走 `/sync/events` 统一入口，仅文档层面区分 `action_type`）
- [ ] **业务侧确认**：`packing_task_items` 明细行粒度是否启用取决于业务是否需要"箱级追溯"，需业务侧确认后再决定是否接入

#### 1.4.2 Layer 4：唯一追踪策略 + 无码/未识别货物处理（2026-07-16 新增，全新设计，本地零实现）

> 设计依据：`docs/01-architecture/TRACKING_POLICY_MISSING_LABEL.md`、`docs/01-architecture/ADR/014-tracking-policy-missing-label.md`。**部署顺序硬约束：必须严格在 Layer 3 之后部署**——本层会用 `CREATE OR REPLACE` 重新定义 Layer 3 的 `fn_apply_putaway_action`，颠倒顺序会导致追踪策略判断被静默覆盖且无任何报错（DBA 文档 v1.2→v1.3 修正记录的真实教训，不是理论风险）。

- [ ] **新增迁移脚本 004**：`tenant_tracking_policies` 表、`containers.lpn_source`/`locations.force_unique_tracking`/`product_constraints.requires_unique_tracking` 三个新列、`fn_requires_unique_tracking`/`fn_generate_internal_lpn`/`fn_confirm_label_applied`/`fn_receive_unidentified_goods`/`fn_identify_unidentified_goods` 五个函数、`fn_trg_enforce_product_constraints` 触发器范围扩展（`location_id` → `location_id, product_id`）—— **同样需先完成与 DBA 团队的协调确认**，确认后先起草不执行
- [ ] 补齐仓储层（Layer 4）：`ITenantTrackingPolicyRepository`/`IMissingLabelRepository`/`IUnidentifiedGoodsRepository`（见 REPOSITORY_ROADMAP.md）
- [ ] Device API 新增 `POST /missing-label/generate`、`POST /missing-label/confirm`、`POST /unidentified/receive`、`POST /unidentified/identify` 端点
- [ ] **部署前必须完成的租户配置**：`tenant_tracking_policies` 里 B 类商品必须显式配置追踪策略，不能长期依赖系统保守兜底值；哪些库位需要 `force_unique_tracking = TRUE` 需仓库运营方按实际情况配置

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

### 2.3 PDA 离线优先前端开发（P0 - 并行 Phase 1.4，2026-07-15 按 DBA 新方案 ADR-011 重写）

> 设计依据：`docs/03-database/SQLITE_LOCAL_SCHEMA.md` v2.0.0（只读缓存 + Outbox 两类本地表，移除原 `sync_queue`/`version_vector`/`sync_conflicts` 设计）。

- [ ] PDA 端本地 SQLite 初始化（只读缓存表 + Outbox 动作日志表，SQLCipher 加密、Schema 迁移）
- [ ] Outbox 引擎核心：本地动作追加、幂等键(`local_id`)生成、设备端单调序号 `device_seq` 维护、批量提交、重试策略
- [ ] 离线策略查询集成：任务开始前调用 `fn_get_sync_policy`（`ALLOW`/`LIMITED`/`ONLINE_ONLY`），`ONLINE_ONLY` 任务需先调用任务领用接口拿到 `task_claims` 租约才能开始
- [ ] 异常状态展示 UI：轮询/展示 `GET /exceptions`，向操作员展示"已登记异常 #X，请联系主管"，**不需要**任何合并/冲突协商界面（已被预分工机制取代）
- [ ] 核心作业离线流程：收货扫描→质检→上架、拣选扫码→确认数量、打包扫箱→加品→封箱→面单打印、分拣扫码→滑道分配、发货扫码→交接、盘点扫码→差异提交（走统一异常登记而非专属 `difference_reason` 字段）
- [ ] 后台同步调度：网络感知、电量感知、优先级队列、WiFi/4G/5G 差异化策略
- [ ] WebSocket 实时通道：任务下发、进度推送、同步触发、指令下达
- [ ] 设备硬件集成：条码扫描枪、RFID、蓝牙打印机、GPS、相机、电量监听
- [ ] 本地数据查询：只读缓存表全离线检索、模糊搜索、条码反查（含"数据同步于 X 分钟前"提示）
- [ ] 异常/照片/签名本地缓存 + 后台异步上传 R2（预签名 URL、断点续传）
- [ ] 多租户切换：本地数据隔离清理、全量重同步、拉取游标重置

### 2.4 组件库与通用逻辑
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
| 种子数据脚本创建与修复 | ✅ 完成 | `supabase/seed.sql` | 修复 FK 约束顺序：tenant 先于 roles 创建 |
| P1 任务：API_SPEC.md 同步 V2.1 RPC | ✅ 完成 | `docs/02-api/API_SPEC.md` | 10 核心 RPC 全收录
| P1 任务：ADR 记录 (001-003) | ✅ 完成 | `docs/01-architecture/ADR/` | RLS、计费双轨、履约链路设计
| P1 任务：CONVENTIONS.md 补充 DB 规范 | ✅ 完成 | `docs/00-project/CONVENTIONS.md` | 状态字段、时间戳、乐观锁、版本化、UUID、JSONB、触发器命名
| P1 任务：TypeScript 类型生成 | ✅ 完成 | `src/types/database.ts` | 3182 行、38 表、10 RPC、10 视图全覆盖
| P2 任务：RPC 客户端封装 | ✅ 完成 | `src/supabase/rpc.ts` | 类型安全、自动租户注入、统一错误处理
| P2 任务：RLS 兼容中间件 | ✅ 完成 | `src/middleware/rls.ts` | Worker/Express 通用、JWT 解析、Header 注入

> **后续**：P1 全项完成 ✅、进入阶段 2 前端骨架与阶段 4 CI/CD

---

## 离线同步 / 统一异常领域 方案对齐记录 (2026-07-15)

DBA 团队评审原 PDA 离线同步设计（状态同步 + OT/CRDT 冲突合并）后，认定其不符合"多设备并发操作共享可变资源"的真实需求，交付新方案（操作同步 + 预分工 + 竞争性任务锁 + 统一异常领域）。本轮完成文档/架构/规划层面的对齐（Phase 3+4），代码/迁移脚本/仓储层实现（Phase 0-2）留待下一轮：

| 执行项 | 状态 | 产出 |
|--------|------|------|
| PDA 离线同步设计重写 | ✅ 完成 | `docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md` v2.0.0 |
| SQLite 本地 Schema 重写 | ✅ 完成 | `docs/03-database/SQLITE_LOCAL_SCHEMA.md` v2.0.0 |
| 冲突解决策略重写（精简） | ✅ 完成 | `docs/03-database/CONFLICT_RESOLUTION_STRATEGY.md` v2.0.0 |
| 同步接口契约重写 | ✅ 完成 | `docs/02-api/SYNC_API_CONTRACT.md` v2.0.0 |
| 设备端协议规范更新 | ✅ 完成 | `docs/02-api/DEVICE_PROTOCOL_SPEC.md` v2.0.0 |
| DB_SCHEMA.md 补充 7 新表/9 新函数 | ✅ 完成 | `docs/03-database/DB_SCHEMA.md` v2.2.0 |
| ARCHITECTURE.md 联动更新 | ✅ 完成 | 离线同步流程图、ADR 摘要、模块拓扑 |
| 新增 ADR-011 | ✅ 完成 | `docs/01-architecture/ADR/011-offline-sync-operation-log-exception-domain.md` |
| ROADMAP Phase 1.4/2.3 重写 | ✅ 完成 | 本文件 |
| REPOSITORY_ROADMAP Phase 5 替换 | ✅ 完成 | `docs/03-database/REPOSITORY_ROADMAP.md` |
| CONVENTIONS.md 联动更新 | ✅ 完成 | `docs/00-project/CONVENTIONS.md` |
| 数据库迁移脚本落地 | ⏳ 待办（Phase 1，下一轮） | — |
| 仓储层端口+适配器实现 | ⏳ 待办（Phase 2，下一轮） | — |
| 现有 RPC→Repository 重构止血 | ⏳ 待办（Phase 0，下一轮，需先于 Phase 1-2） | 当前工作区另有未提交、69 个 tsc 错误的重构，需先修复 |

> **后续**：下一轮先完成 Phase 0（修复现有未提交重构的编译错误、补 ADR 记录该重构），再进入 Phase 1（迁移脚本）与 Phase 2（仓储层）。