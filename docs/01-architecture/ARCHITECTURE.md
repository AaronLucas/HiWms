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
│   ├── db/                 # 仓储端口（25个聚合根；+5 个离线同步/统一异常领域端口设计中，见 REPOSITORY_ROADMAP.md Phase 5）
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
│   ├── exception/          # 统一异常领域用例（登记/查看/处理，跨 INVENTORY/SYNC/COMPLIANCE/TASK/FULFILLMENT/BILLING 域复用同一套）
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

### 3.4 离线同步流（v2：操作同步 + 预分工，取代旧版状态同步/OT-CRDT 设计）

> 详细设计见 `PDA_OFFLINE_SYNC_DESIGN.md`（ADR-011）。核心范式转变：不再是"客户端提交最终状态 → 服务端合并冲突"，而是"客户端记录发生了什么动作 → 服务端重放业务函数"；冲突优先通过**预分工**（库存预占精确到工单 + 竞争性任务租约）在事前消除，事后异常统一走**异常领域**，不再有专门的合并 UI。

```
波次下发工单（服务器在线）
     │
     ▼
为工单预占具体库存行 (inventory_reservations.work_order_id)
     │
     ▼
PDA Device 离线执行（本地 Outbox 记录动作，非状态）
     │
     ▼
网络恢复 → 批量提交动作事件 (sync_events 幂等收件箱)
     │
     ▼
Device API /sync/events 端点
     │
     ▼
fn_apply_sync_event 按 action_type 重放业务函数
     │
     ├── 正常 → 写入主库 (APPLIED)
     ├── 业务性异常（如库存不足）→ 不写入，登记统一异常领域 (EXCEPTION)
     └── 未知/系统错误 → 兜底登记 SYNC_APPLY_FAILURE (EXCEPTION)
     │
     ▼
PDA 拉取结果 → 展示"已同步"或"异常 #X，请联系主管"

（无法预分工的任务：PDA 需先调用 fn_claim_task 竞争性锁获取租约，
  成功才允许开始离线操作；sync_policies 按 tenant+task_type+zone_type 决定
  该任务是 ALLOW / LIMITED / ONLINE_ONLY）
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
| **离线优先** | 本地优先，操作同步（非状态合并），预分工消除大部分冲突，竞争性任务租约兜底 |
| **核心功能** | 收货扫描、上架（PUTAWAY）、拣选（PICK）、打包（PACK）、发货、盘点（COUNT）、唯一追踪策略校验、统一异常上报（`fn_raise_exception`） |
| **协议** | REST + WebSocket (实时推送任务) |
| **部署** | Express + PM2，边缘节点部署靠近仓库 |
| **数据库** | Supabase (RLS) + 本地 SQLite |

> ✅ **实现状态（2026-07-18 已核实）**：`src/apps/device-api` 已存在（`routes.ts`/`di.ts`/`DeviceAuthMiddleware.ts`/`config.ts`/`main.ts`/`validation.ts`），本节描述的核心端点（`/sync/events`、`/sync/pull`、`/sync/policy`、任务领用/释放、统一异常查看、`/putaway`/`/count`/`/pack`、`/missing-label/*`、`/unidentified/*`）均已实现并接入 Layer 2/3/4 仓储层，`tsc --noEmit` 零错误。

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
| **ADR-011** | 离线同步改为操作同步 + 预分工 + 统一异常领域 | DBA 评审发现旧版状态同步/OT-CRDT 设计不符合"多设备并发操作共享可变资源"的真实需求，替换为可预防冲突的设计 |
| **ADR-013** | 同步动作扩展（PUTAWAY/COUNT/PACK）改为修正版重新实现 | DBA 评审开发团队 PR 发现真实语法错误+并发丢单 bug+表结构引用错误，重新实现而非打补丁 |
| **ADR-014** | 唯一追踪策略三层解析 + 无码/未识别货物分离处理 | 区分"低值货物本不追踪"与"该追踪但现场缺码"两种完全不同的场景，避免混为一谈造成操作摩擦或追溯断裂 |
| **ADR-016** | 迁移 005-008 应用层集成：并发/租户修复零改动、序列化追踪走独立只读仓储、存储策略平台管理员写权限复用现有 RBAC | Layer 5/6 对现有调用方透明；Layer 7 序列化路径在 SQL 层已按 `is_serial_required` 分流，TS 层无需感知；Layer 8 权限模型复用已有 `roles.tenant_id IS NULL` 平台角色机制，不新增权限体系 |
| **ADR-017** | DBA 迁移脚本拆分至独立仓库 HiWmsSupabase，CI 用无过期只读 Deploy Key 跨仓库 checkout | 此前 `supabase/migrations` 从未被 git 跟踪导致 CI 数据库测试无法运行；拆分后 DBA 产出物与应用代码历史解耦，Deploy Key 避免 PAT 的强制过期问题 |
| **ADR-018** | 异常处理"解决人身份"改由已验证的 `req.context.userId` 派生，不再信任客户端传入的 `resolver_user_id`/`actor_user_id` | `fn_resolve_exception` 信任调用方自报身份的漏洞模式，已通过 `/missing-label/confirm`、`/unidentified/identify` 两条真实可达路由暴露；应用层修复今天就能收口，不等数据库层 |

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
| 2.1.0 | 2026-07-15 | 离线同步流改为操作同步+预分工模型（ADR-011），新增统一异常领域用例模块，更新 ADR 摘要与相关文档索引 |
| 2.2.0 | 2026-07-16 | 新增 ADR-013/ADR-014（Layer 3 同步动作扩展、Layer 4 唯一追踪策略），标注 Device API 当前实现状态（尚不存在，仅 admin-api 已实现），更新相关文档索引 |
| 2.3.0 | 2026-07-18 | DBA 团队确认 Layer 2/3/4 迁移脚本已部署到生产环境，`device-api` 应用已实现（§4.3 状态更新为已核实存在），Layer 2/3/4 仓储层已全部完成 |
| 2.4.0 | 2026-07-23 | 新增 §11「待决策架构问题」，登记对 `HiWmsSupabase` 迁移 009-016 只读复核发现的架构级 backlog（不含任何该仓库的代码改动） |

---

## 11. 待决策架构问题（2026-07-23，`HiWmsSupabase` 009-016 只读复核新增）

> 以下问题来自对 `HiWmsSupabase`（DBA 团队独立维护，应用团队只读）迁移 009-016 的
> 复核，均已通过 `docs/03-database/DBA_ADDENDUM_REQUEST_2026-07-23.md` 正式退回 DBA
> 团队处理。本节只做架构层面的登记追踪，不代表本仓库已对这些问题做任何代码改动。

| 优先级 | 问题 | 说明 | 详情 |
|---|---|---|---|
| **P0**（应用层已修复，2026-07-23） | `fn_resolve_exception` 信任调用方传入的 `p_resolver_user_id` | 与 013 修复的 `check_user_permission` 跨租户信息泄露同一类"SECURITY DEFINER 信任调用方自称身份"漏洞模式，且已通过 `/missing-label/confirm`、`/unidentified/identify` 两条路由真实可达——应用层已改为从 `req.context.userId` 派生（见 ADR-018）；数据库层防御性加固仍待 DBA 处理 | ADR-018；`DBA_ADDENDUM_REQUEST_2026-07-23.md` 新发现 1 |
| **P1** | GRANT 策略缺失，全仓库无显式 GRANT 语句 | 生产不受影响（Supabase 托管 provisioning 隐式处理），但两轮复核后建议正式写一份 ADR 关闭这个反复被提起的问题 | 同上新发现 2 |
| **P1** | 测试执行顺序加固（事务隔离 + CI 随机顺序） | 已在 `HiWmsSupabase` 侧实现但未提交合并，`TEST_PLAN.md` 仍标注"待决策" | `docs/00-project/ROADMAP.md` §1.5 |
| **P2** | 009 迁移 `WHEN OTHERS` 过宽异常捕获 | 迁移已合并不可变，属永久性限制，记录避免未来迁移重演同一模式 | `DBA_ADDENDUM_REQUEST_2026-07-23.md` 上一轮追踪表 |
| **P2** | 独立评审流程缺口 | `HiWmsSupabase` 013/014/015 三个迁移自曝当时缺少可用的独立评审工具/会话，部分评审记录是否真正完成存疑 | `docs/04-workflows/WORKFLOWS.md` §8 |
| **P2** | `containers` 共享可见性 RLS 模型 | 014 的设计权衡（空闲容器对所有租户可见），"严格租户容器池"是否已是真实产品需求需产品侧确认 | `DBA_ADDENDUM_REQUEST_2026-07-23.md` 新发现 4 |

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
| **PDA 离线同步设计** | `docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md` | 操作同步、预分工、竞争性任务锁、统一异常领域（ADR-011） |
| **设备端 API 协议** | `docs/02-api/DEVICE_PROTOCOL_SPEC.md` | REST/WebSocket 全接口、任务领用、离线策略查询、统一异常上报 |
| **PDA 本地 SQLite Schema** | `docs/03-database/SQLITE_LOCAL_SCHEMA.md` | 只读缓存 + Outbox 动作日志两类本地表 |
| **冲突解决策略** | `docs/03-database/CONFLICT_RESOLUTION_STRATEGY.md` | 预分工机制、任务租约语义、统一异常处理 |
| **同步接口契约规范** | `docs/02-api/SYNC_API_CONTRACT.md` | sync_events 幂等收件箱、APPLIED/EXCEPTION/REJECTED 契约 |
| **同步动作扩展（Layer 3）** | `docs/02-api/SYNC_ACTIONS_EXTENSION.md` | PUTAWAY/COUNT/PACK 修正实现、原子库存写入原语（ADR-013） |
| **唯一追踪策略（Layer 4）** | `docs/01-architecture/TRACKING_POLICY_MISSING_LABEL.md` | 三层策略解析、MISSING_LABEL/UNIDENTIFIED_GOODS 闭环（ADR-014） |