# 系统架构设计文档

## 1. 架构概览

### 1.1 架构风格：六边形架构 + 多端拓扑
```
┌─────────────────────────────────────────────────────────────────────────┐
│                        外部适配器层 (Driven/Driving)                      │
├─────────────┬─────────────┬─────────────┬─────────────┬────────────────┤
│  Admin API  │ Tenant API  │  Device API │ Edge Worker │  External Sys  │
│  (Express)  │  (Express)  │  (Express)  │ (Cloudflare)│  (ERP/Carrier) │
└──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴───────┬───────┘
       │             │             │             │              │
       ▼             ▼             ▼             ▼              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Express Middleware Factory                         │
│         (Auth, Tenant, RateLimit, Logging, Validation, Error)          │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        核心领域层 (Core Domain)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Inbound  │ │ Inventory│ │ Outbound │ │ Billing  │ │   Device     │  │
│  │ UseCases │ │ UseCases │ │ UseCases │ │ UseCases │ │  UseCases    │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Workflow│ │  Event   │ │  Domain  │ │  Value   │ │   Policy     │  │
│  │  Engine  │ │   Bus    │ │  Events  │ │ Objects  │ │  (Rules)     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ 依赖倒置 (Ports)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        端口层 (Ports - Interfaces)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │   DB     │ │   RPC    │ │  Auth    │ │  Cache   │ │    Queue     │  │
│  │ Ports    │ │ Ports    │ │ Ports    │ │ Ports    │ │   Ports      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ External │ │  Queue   │ │  File    │ │  Device  │ │   Workflow   │  │
│  │  Ports   │ │  Ports   │ │  Ports   │ │  Ports   │ │   Ports      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ 实现
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      适配器层 (Adapters - Implementations)               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐   │
│  │  Supabase   │ │ Cloudflare  │ │   Express   │ │   External      │   │
│  │  Adapters   │ │  Adapters   │ │  Adapters   │ │   Adapters      │   │
│  │ (Postgres,  │ │ (KV, R2,    │ │ (Middleware,│ │ (ERP, Carrier,  │   │
│  │  RLS, RPC)  │ │  D1, Queue) │ │  Validation)│ │  EDI, Label)    │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心原则
| 原则 | 体现 |
|------|------|
| **依赖倒置** | 核心依赖接口，适配器实现接口 |
| **单一职责** | 每个用例只做一件事，端口职责单一 |
| **接口隔离** | 端口按领域拆分，避免胖接口 |
| **开闭原则** | 新增适配器不修改核心，新增端口不破坏现有 |
| **租户隔离** | RLS + 基类注入 tenant_id，数据物理隔离 |

---

## 2. 模块拓扑

### 2.1 核心模块
```
src/core/
├── domain/                 # 领域模型（实体、值对象、领域事件、领域服务）
│   ├── inbound/            # 入库领域
│   ├── inventory/          # 库存领域
│   ├── outbound/           # 出库领域
│   ├── billing/            # 计费领域
│   ├── device/             # 设备领域
│   └── shared/             # 共享内核
├── ports/                  # 端口接口（所有对外契约）
│   ├── auth/               # 认证授权端口
│   ├── cache/              # 缓存端口
│   ├── db/                 # 仓储端口（25个聚合根）
│   ├── external/           # 外部集成端口
│   ├── queue/              # 队列端口
│   ├── rpc/                # RPC端口
│   ├── file/               # 文件存储端口
│   ├── device/             # 设备专用端口
│   └── workflow/           # 工作流端口
├── usecases/               # 用例层（应用服务）
│   ├── inbound/
│   ├── inventory/
│   ├── outbound/
│   ├── billing/
│   ├── device/
│   └── workflow/
├── workflow/               # 工作流引擎核心
│   ├── engine/
│   ├── definitions/
│   ├── executor/
│   └── registry/
├── events/                 # 事件总线核心
└── policies/               # 业务策略/规则引擎
```

### 2.2 适配器模块
```
src/adapters/
├── supabase/               # Supabase 适配器（主数据平台）
│   ├── SupabaseClient.ts   # 封装客户端、RLS、Admin
│   ├── repositories/       # 25个 Repository 实现
│   ├── rpc/                # RPC 客户端实现
│   ├── auth/               # Supabase Auth 实现
│   ├── cache/              # PostgREST 缓存实现
│   └── realtime/           # 实时订阅实现
├── cloudflare/             # Cloudflare 适配器（边缘/Worker）
│   ├── CloudflareClient.ts # 封装 KV/R2/D1/Queues
│   ├── kv/                 # KV 存储实现
│   ├── r2/                 # R2 对象存储实现
│   ├── d1/                 # D1 数据库实现
│   ├── queues/             # Queue 消息队列实现
│   ├── cache/              # 缓存实现
│   └── auth/               # Workers Auth 实现
├── express/                # Express 适配器（API 服务器）
│   ├── ExpressMiddlewareFactory.ts  # 中间件工厂
│   ├── middleware/         # 通用中间件
│   ├── routes/             # 路由注册
│   ├── validation/         # 请求验证
│   └── error/              # 错误处理
├── external/               # 外部系统适配器
│   ├── erp/                # ERP 对接
│   ├── carrier/            # 承运商 API
│   ├── edi/                # EDI 解析
│   ├── label/              # 标签打印
│   └── notification/       # 通知发送
└── device/                 # 设备/PDA 专用适配器
    ├── sync/               # 离线同步协议
    ├── provisioning/       # 设备注册
    └── protocol/           # 通信协议
```

### 2.3 应用入口模块
```
src/apps/
├── admin-api/              # 管理端 API (Express)
│   ├── main.ts             # 入口
│   ├── routes/             # 路由
│   ├── di.ts               # 依赖注入配置
│   └── config.ts           # 配置
├── tenant-api/             # 租户端 API (Express)
│   ├── main.ts
│   ├── routes/
│   ├── di.ts
│   └── config.ts
├── device-api/             # 设备端 API (Express)
│   ├── main.ts
│   ├── routes/
│   ├── di.ts
│   └── config.ts
└── edge-worker/            # 边缘 Worker (Cloudflare)
    ├── main.ts             # Worker 入口
    ├── routes/             # 路由
    ├── di.ts
    └── config.ts
```

### 2.4 配置与类型
```
src/
├── configs/                # 环境配置
│   ├── env.ts              # 环境变量解析
│   ├── database.ts         # 数据库配置
│   ├── cache.ts            # 缓存配置
│   ├── queue.ts            # 队列配置
│   └── external.ts         # 外部服务配置
├── types/                  # 类型定义
│   ├── database.ts         # Supabase 生成类型（主）
│   ├── domain.ts           # 领域类型
│   ├── api.ts              # API 契约类型
│   └── workflow.ts         # 工作流类型
└── shared/                 # 共享工具
    ├── errors/             # 错误类
    ├── utils/              # 工具函数
    ├── constants/          # 常量
    └── guards/             # 类型守卫
```

---

## 3. 数据流设计

### 3.1 命令流
```
Client Request
     │
     ▼
Express Middleware (Auth → Tenant → RateLimit → Validation)
     │
     ▼
Route Handler → UseCase.execute(command)
     │
     ▼
UseCase: 业务规则校验 → 领域模型变更 → 发布领域事件 → 返回结果
     │                    │
     │                    ▼
     │            Repository Port (接口)
     │                    │
     ▼                    ▼
Response           Supabase Adapter (实现)
                        │
                        ▼
                 PostgreSQL (RLS 租户隔离)
```

### 3.2 查询流
```
Client Request
     │
     ▼
Express Middleware (Auth → Tenant)
     │
     ▼
Route Handler → UseCase.query(criteria)
     │
     ▼
UseCase: 组装查询 → Repository Port 查询 → 返回 DTO
     │                    │
     │                    ▼
     │            Supabase Adapter
     │                    │
     ▼                    ▼
Response           PostgreSQL (RLS + 索引优化)
```

### 3.3 事件流
```
Domain Event 发布
     │
     ▼
EventBus Port (接口)
     │
     ├──────────────────┬──────────────────┐
     ▼                  ▼                  ▼
Supabase           Cloudflare          External
Adapter            Queues              Webhook
(Outbox Table)     (Pub/Sub)           (HTTP)
     │                  │                  │
     ▼                  ▼                  ▼
Event Handlers   Workflow Trigger    3rd Party
(异步处理)         (工作流启动)         系统
```

### 3.4 离线同步流
```
PDA Device (离线)
     │
     ▼
本地 SQLite 存储操作
     │
     ▼
网络恢复 → 同步协议
     │
     ▼
Device API /sync 端点
     │
     ▼
冲突检测 → 合并策略 (LWW/OT/CRDT)
     │
     ▼
写入主库 → 发布同步完成事件
     │
     ▼
PDA 确认 → 清理本地待同步队列
```

---

## 4. 多端架构详细设计

### 4.1 Admin API (平台运营端)
| 特性 | 设计 |
|------|------|
| **认证** | Platform JWT (RS256)，角色：platform_admin, platform_operator |
| **租户视角** | 跨租户，可切换租户上下文 |
| **核心功能** | 租户生命周期、计费策略、平台监控、审计日志、系统配置 |
| **部署** | Express + PM2/K8s Deployment，多实例 |
| **数据库** | Supabase (Admin Client 绕过 RLS) |

### 4.2 Tenant API (业务租户端)
| 特性 | 设计 |
|------|------|
| **认证** | Tenant JWT (HS256/RS256)，角色：tenant_admin, warehouse_manager, operator |
| **租户视角** | 单租户，RLS 自动隔离 |
| **核心功能** | 库存管理、订单管理、入库/出库作业、报表、设备管理 |
| **部署** | Express + PM2/K8s Deployment，按租户水平扩展 |
| **数据库** | Supabase (RLS 自动过滤 tenant_id) |

### 4.3 Device API (PDA/手持终端端)
| 特性 | 设计 |
|------|------|
| **认证** | Device JWT + API Key，设备绑定租户 |
| **离线优先** | 本地优先，冲突合并，增量同步 |
| **核心功能** | 收货扫描、上架、拣选、打包、发货、盘点、异常上报 |
| **协议** | REST + WebSocket (实时推送任务) |
| **部署** | Express + PM2，边缘节点部署靠近仓库 |
| **数据库** | Supabase (RLS) + 本地 SQLite |

### 4.4 Edge Worker (Cloudflare Workers)
| 特性 | 设计 |
|------|------|
| **认证** | 轻量 JWT 验证 (JWKS 缓存)，API Key |
| **无状态** | 无本地状态，所有状态外部化 |
| **核心功能** | 轻量查询、标签生成、Webhook 接收、缓存代理、边缘计算 |
| **部署** | Cloudflare Workers 全球边缘 |
| **存储** | KV (配置/缓存)、R2 (文件)、D1 (轻量查询)、Queues (异步) |

---

## 5. 关键技术决策 (ADR 摘要)

| ADR | 决策 | 理由 |
|-----|------|------|
| **ADR-001** | 六边形架构 | 核心与基础设施解耦，便于测试和多端复用 |
| **ADR-002** | Supabase 作为主数据平台 | Postgres + RLS + RPC + Realtime 一站式 |
| **ADR-003** | 租户隔离用 RLS | 数据库层面强隔离，零信任，性能可控 |
| **ADR-004** | RPC 替代复杂 SQL | 业务逻辑下推数据库，事务一致性、性能 |
| **ADR-005** | 统一工作流引擎 | 替代双引擎，可视化定义、版本化、可观测 |
| **ADR-006** | Express Middleware Factory | 跨端复用横切关注点，配置化组装 |
| **ADR-007** | Cloudflare Workers 做边缘 | 全球边缘、零冷启动、成本低 |
| **ADR-008** | PDA 离线优先同步 | 仓库网络不稳定，必须支持离线作业 |
| **ADR-009** | 事件驱动架构 | 解耦领域操作与副作用，支持最终一致性 |
| **ADR-010** | TypeScript 严格模式 | 端到端类型安全，数据库类型生成到前端 |

---

## 6. 依赖关系矩阵

```
Layer           │ Core Domain │ Ports │ Adapters │ Apps │ Configs │ Types
────────────────┼─────────────┼───────┼──────────┼──────┼─────────┼──────
Core Domain     │     ✅      │  ✅   │          │      │         │  ✅
Ports           │             │  ✅   │          │      │         │  ✅
Adapters        │             │  ✅   │    ✅    │      │    ✅   │  ✅
Apps            │             │  ✅   │    ✅    │  ✅  │    ✅   │  ✅
Configs         │             │       │          │      │    ✅   │
Types           │             │       │          │      │         │  ✅
```

**规则**：
- 核心层**只依赖**端口层和类型层
- 适配器层**实现**端口层，**依赖**配置层和类型层
- 应用层**组装**适配器注入核心，**依赖**配置层
- 严禁：核心层依赖适配器、应用层依赖核心内部实现细节

---

## 7. 安全架构

### 7.1 认证授权体系
```
┌────────────────────────────────────────────────────────────┐
│                    认证授权边界                               │
├────────────────────────────────────────────────────────────┤
│  Platform Level    │  Tenant Level     │  Device Level     │
│  - Platform JWT    │  - Tenant JWT     │  - Device JWT     │
│  - API Key (服务间) │  - API Key        │  - API Key        │
│  - mTLS (内部)     │  - RBAC (角色)    │  - Device Binding │
└────────────────────────────────────────────────────────────┘
```

### 7.2 数据安全
| 层面 | 措施 |
|------|------|
| **传输** | TLS 1.3 全链路，mTLS 服务间 |
| **存储** | 静态加密 (Supabase 托管)，敏感字段应用层加密 |
| **访问** | RLS 行级策略，最小权限原则 |
| **审计** | 所有写操作记录审计日志，不可篡改 |

---

## 8. 可观测性架构

| 维度 | 实现 |
|------|------|
| **指标** | Prometheus + Grafana |
| **日志** | Loki + Promtail, 结构化日志 (JSON) |
| **链路追踪** | Tempo/Jaeger, OpenTelemetry |
| **告警** | Alertmanager + PagerDuty/钉钉/企微 |
| **健康检查** | /health, /ready, /live 端点，K8s Probe |
| **SLO/SLI** | 可用性 99.9%, P99 延迟 < 500ms, 错误率 < 0.1% |

---

## 9. 版本记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-07-01 | 初始架构大纲 |
| 1.1.0 | 2025-07-07 | 补充数据流、技术栈、ADR 索引、CONVENTIONS 引用 |
| 2.0.0 | 2025-07-10 | 完整六边形架构、多端拓扑、数据流、安全、可观测性 |

---

## 10. 相关文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| **API 规范** | `docs/02-api/API_SPEC.md` | OpenAPI 端点定义、参数、响应、错误码 |
| **数据库设计** | `docs/03-database/DB_SCHEMA.md` | 表结构、字段、索引、迁移、RLS 策略 |
| **仓储层设计** | `docs/03-database/REPOSITORY_DESIGN.md` | 聚合根识别、端口定义、实现策略 |
| **仓储层路线图** | `docs/03-database/REPOSITORY_ROADMAP.md` | 分阶段实施计划、里程碑 |
| **工作流/部署** | `docs/04-workflows/WORKFLOWS.md` | CI/CD 流水线、Git 分支策略、发布流程 |
| **运维体系** | `docs/05-operations/OPS.md` | 监控、日志、报警、容量规划、备份恢复 |
| **智能体体系** | `docs/06-agents/AGENTS.md` | Agents/Skills/MCP 工具链、自动化规则 |
| **开发手册** | `docs/07-development/DEVELOPMENT.md` | 开发命令速查、本地环境、调试指南 |
| **编码约定** | `docs/00-project/CONVENTIONS.md` | 命名规范、核心原则、Git 提交规范 |
| **项目路线图** | `docs/00-project/ROADMAP.md` | 全局任务树、里程碑、依赖关系 |
| **PDA 离线同步设计** | `docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md` | 同步协议、版本向量、冲突检测、OT/CRDT、SQLite Schema |
| **设备端 API 协议** | `docs/02-api/DEVICE_PROTOCOL_SPEC.md` | REST/WebSocket 全接口、同步契约、作业操作、错误码 |
| **PDA 本地 SQLite Schema** | `docs/03-database/SQLITE_LOCAL_SCHEMA.md` | 本地表结构、触发器、索引、分区、加密、迁移 |
| **冲突解决策略矩阵** | `docs/03-database/CONFLICT_RESOLUTION_STRATEGY.md` | 20 场景矩阵、OT/CRDT/LWW 算法、工作流、UI 规范、监控 |
| **同步接口契约规范** | `docs/02-api/SYNC_API_CONTRACT.md` | 同步完整契约、分片、游标、版本控制、限流、安全 |