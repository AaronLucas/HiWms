# 项目长期知识索引

> 本文件为项目核心知识的**唯一检索入口**，不存储正文，仅维护指向 `docs/` 与代码的映射。
> **禁止**写入临时对话内容、阶段性进度、会话记忆。

---

## 1. 架构知识

| 主题 | 位置 | 核心内容 |
|------|------|----------|
| 系统整体架构 | `docs/01-architecture/ARCHITECTURE.md` | 六边形架构、多端拓扑、数据流、ADR 索引 |
| 架构决策记录 | `docs/01-architecture/ADR/` | ADR-001~010 技术选型理由 |
| PDA 离线同步 | `docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md` | 同步协议、版本向量、OT/CRDT、SQLite Schema |
| 设备端 API 协议 | `docs/02-api/DEVICE_PROTOCOL_SPEC.md` | REST/WebSocket 全接口、同步契约、错误码 |
| 同步接口契约 | `docs/02-api/SYNC_API_CONTRACT.md` | 分片、游标、版本控制、限流、安全 |
| 冲突解决策略 | `docs/03-database/CONFLICT_RESOLUTION_STRATEGY.md` | 20 场景矩阵、算法、工作流、UI 规范、监控 |

---

## 2. API 知识

| 主题 | 位置 | 核心内容 |
|------|------|----------|
| OpenAPI 规范 | `docs/02-api/API_SPEC.md` | 4 端点点、认证、错误码、RPC、示例 |
| 设备端协议详细 | `docs/02-api/DEVICE_PROTOCOL_SPEC.md` | 同步、作业操作、查询接口 |

---

## 3. 数据库知识

| 主题 | 位置 | 核心内容 |
|------|------|----------|
| 统一 Schema v2.1 | `docs/03-database/DB_SCHEMA.md` | 38 表、RLS、触发器、索引、CHECK 约束、pg_cron |
| PDA 本地 SQLite | `docs/03-database/SQLITE_LOCAL_SCHEMA.md` | 本地表、触发器、索引、分区、加密、迁移 |
| 仓储层设计 | `docs/03-database/REPOSITORY_DESIGN.md` | 聚合根识别、端口定义、实现策略 |
| 仓储层路线图 | `docs/03-database/REPOSITORY_ROADMAP.md` | 分阶段实施、里程碑 |
| 迁移脚本 | `supabase/migrations/001_initial_schema.sql` | 生产就绪的单文件迁移 |

---

## 4. 工作流与部署知识

| 主题 | 位置 | 核心内容 |
|------|------|----------|
| CI/CD 流水线 | `docs/04-workflows/WORKFLOWS.md` | Git 分支策略、CI/CD、版本管理、部署脚本 |
| 暂停节点清单 | `docs/04-workflows/WORKFLOWS.md §7` | 13 类必须人工确认的操作节点 |

---

## 5. 运维知识

| 主题 | 位置 | 核心内容 |
|------|------|----------|
| 监控体系 | `docs/05-operations/OPS.md §1` | Prometheus、Grafana、核心指标、仪表盘 |
| 日志体系 | `docs/05-operations/OPS.md §2` | Loki、结构化日志、保留策略 |
| 报警体系 | `docs/05-operations/OPS.md §3` | P0-P3 分级、规则示例、抑制分组 |
| 性能基线 | `docs/05-operations/OPS.md §4` | 关键指标目标值、容量规划模型 |
| 安全审计 | `docs/05-operations/OPS.md §5` | 审计范围、权限最小化、合规清单 |
| 备份灾备 | `docs/05-operations/OPS.md §6` | RPO/RTO、演练频次、Runbook 索引 |
| 环境变量 | `docs/05-operations/OPS.md §9` | 必需/可选/环境差异配置表 |

---

## 6. 智能体与工具知识

| 主题 | 位置 | 核心内容 |
|------|------|----------|
| Agent 体系 | `docs/06-agents/AGENTS.md §2` | 7 类核心 Agent、协作模式 |
| Skill 体系 | `docs/06-agents/AGENTS.md §3` | 7 分类、注册清单、核心技能表 |
| MCP 集成 | `docs/06-agents/AGENTS.md §4` | 8 个已接入工具、调用示例 |
| 自动化规则引擎 | `docs/06-agents/AGENTS.md §5` | DSL、分类、版本灰度 |
| 上下文与记忆 | `docs/06-agents/AGENTS.md §6` | 4 类记忆、存储介质、TTL |

---

## 7. 开发规范知识

| 主题 | 位置 | 核心内容 |
|------|------|----------|
| 编码约定 | `docs/00-project/CONVENTIONS.md` | 目录结构、命名、核心原则、API 设计、DB 操作、测试、Git 提交、Code Review、禁用模式 |
| 开发手册 | `docs/07-development/DEVELOPMENT.md` | 命令速查、本地环境、调试指南 |

---

## 8. 领域业务知识

| 领域 | 核心文档 | 关键业务逻辑 |
|------|----------|--------------|
| **入库** | `DB_SCHEMA.md` (inbound_receipts) + `API_SPEC.md` §3.5 | 收货→质检→上架、ASN 预入库、黑盒解箱 |
| **库存** | `DB_SCHEMA.md` (inventory, reservations, locks) | 乐观锁版本、FEFO 分配、预留/冻结、批次效期 |
| **出库/波次** | `DB_SCHEMA.md` (waves, orders, order_lines) + `API_SPEC.md` §3.6 | 波次策略、库存分配 RPC、工单生成 |
| **拣选/分拣** | `DB_SCHEMA.md` (sorting_*) + `API_SPEC.md` §3.8 | 滑道分配 RPC、拣选路径优化 |
| **验货/打包** | `DB_SCHEMA.md` (verification_rules, packing_tasks) | 重量/尺寸公差、面单模板、耗材核算 |
| **装车/发货** | `DB_SCHEMA.md` (vehicles, loading_tasks, shipping_docs) | 载重利用率、铅封、POD 回单 |
| **直通/越库** | `DB_SCHEMA.md` (cross_dock_jobs) + `API_SPEC.md` §3.9 | 入库单+出库单匹配、超时降级 FALLBACK |
| **补货** | `DB_SCHEMA.md` (v_replenishment_needs) + `API_SPEC.md` §3.10 | PICK 区填充率<20% 触发、工单派发 |
| **计费** | `DB_SCHEMA.md` (billing_rules, tiers, transactions) | 规范化阶梯表、JSONB 回退、对账流程 |
| **设备/PDA** | `DB_SCHEMA.md` (devices) + `DEVICE_PROTOCOL_SPEC.md` | 设备注册、心跳、OTA、离线同步协议 |
| **RBAC** | `DB_SCHEMA.md` (tenants, roles, permissions, users) | 平台/租户/设备三级、RLS 自动隔离 |

---

## 9. 代码结构知识

| 模块 | 路径 | 说明 |
|------|------|------|
| 核心领域 | `src/core/domain/` | 入库/库存/出库/计费/设备/共享内核 |
| 端口接口 | `src/core/ports/` | DB/RPC/Auth/Cache/Queue/External/Workflow 等 |
| 用例层 | `src/core/usecases/` | 入库/库存/出库/计费/工单/波次 业务用例 |
| 工作流引擎 | `src/core/workflows/` | IWorkflowEngine、WorkflowEngine、定义、任务 |
| 适配器层 | `src/adapters/` | Supabase/CF/Express/External/Device 实现 |
| 应用入口 | `src/apps/` | admin-api/tenant-api/device-api/edge-worker |
| 配置与类型 | `src/configs/`, `src/types/` | 环境配置、数据库/领域/API/工作流类型 |

---

## 10. 版本记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-07-12 | 初版：建立知识索引映射表 |