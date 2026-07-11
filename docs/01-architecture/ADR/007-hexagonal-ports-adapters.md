# ADR-007: 采用六边形/端口-适配器架构

## 状态
✅ Accepted (2026-07-09)

## 背景
项目早期采用分层架构，但存在以下问题：
1. **核心层耦合外部 SDK**：`core/services/` 直接依赖 `@supabase/supabase-js`、`express`，导致单元测试需真实 Supabase/Redis/外部服务
2. **双工作流引擎并存**：`WaveOrchestrator` + `WaveOrchestratorV2` + `WorkflowEngine` 三套，职责重叠、状态机不统一
3. **RPC 调用无类型安全**：手写参数对象，与数据库函数签名易不同步
4. **横切关注点分散**：认证、RLS、租户解析、限流、缓存在各入口重复实现
5. **多端入口耦合**：Admin/Tenant/Device API 共用路由文件，中间件栈差异靠注释区分

## 决策
采用 **六边形架构 / 端口-适配器架构**：

```
src/core/                    ← 纯业务核心，零外部依赖
├── domain/                  # 实体、值对象、领域事件、领域服务
├── ports/                   # 端口接口（依赖倒置核心）
│   ├── db/                  # 6 个 Repository 接口
│   ├── rpc/                 # 12 个 RPC 客户端接口（对应 DB 函数）
│   ├── auth/                # 3 个认证/授权端口
│   ├── cache/               # 2 个缓存端口
│   ├── queue/               # 2 个队列端口
│   └── external/            # 3 个外部设备端口
├── usecases/                # 14 个用例编排（组合 Repository + RPC + Workflow）
└── workflows/               # 统一工作流引擎 + 3 大流程 + 7 标准任务

src/adapters/                ← 实现端口，隔离外部技术
├── supabase/                # 主数据平台适配器
│   ├── SupabaseClient       # 统一客户端（单例/重试/租户上下文）
│   ├── repositories/        # 5 个 Repository 实现
│   ├── rpc/SupabaseRpcClient # 12 个类型安全 RPC 实现
│   ├── auth/                # 3 个 Auth 实现
│   └── cache/               # 内存/Redis 缓存实现
├── cloudflare/              # 边缘层适配器
│   └── CloudflareAdapters   # KV 缓存、Worker 权限、Worker 租户解析
├── express/                 # Express 中间件工厂（横切关注点复用）
│   └── ExpressMiddlewareFactory # authenticate/resolveTenant/requirePermission/injectRlsContext/rateLimit/cache/correlationId/errorHandler
└── offline/                 # 设备端离线队列
    └── IndexedDBQueue

src/apps/                    ← 四端入口，组装依赖
├── admin-api/               # 平台超管 :3002
├── tenant-api/              # 租户业务 :3001
├── device-api/              # PDA/设备 :3003
└── worker/                  # Cloudflare Worker 边缘
```

## 后果

### 正面
- **核心层 100% 可测**：端口接口可用内存/测试替身，无需真实 Supabase/Redis
- **适配器可替换**：Supabase → PostgreSQL 直连、Cloudflare KV → Redis、Express → Fastify 仅需实现端口
- **类型安全 RPC**：`database.ts` (supabase gen types) → `ports/rpc/` → `SupabaseRpcClient` 编译期保证
- **统一工作流**：单一 `WorkflowEngine` 替代三套引擎，状态机、补偿事务、事件驱动标准化
- **中间件复用**：`ExpressMiddlewareFactory` 保证四端认证/RLS/权限/限流/缓存/追踪/错误处理一致
- **四端清晰分离**：Admin(Service Role/无RLS) / Tenant(Anon+RLS) / Device(DeviceToken+RLS/离线同步) / Worker(KV只读/轻量权限)

### 负面/风险
- **初期样板代码多**：端口接口 + 适配器实现 + 工厂函数 + 入口装配
- **学习曲线**：团队需理解依赖倒置、端口/适配器、工作流引擎概念
- **运行时开销**：间接调用增加微小开销（可忽略）

## 实施细节
- `core/` 目录下**禁止** import `adapters/`、`apps/`、任何外部 SDK
- 所有端口接口以 `I` 前缀命名（`IRepository`、`IStockAllocationRpc`）
- 适配器实现显式 `implements IPort` 编译期检查
- 工厂函数 `createSupabaseAdapters()`、`createCloudflareAdapters()` 统一装配
- 每个端口必须有**契约测试**（`src/__tests__/contracts/`）验证实现符合约定

## 相关文档
- `ARCHITECTURE.md` v2.0.0 — 全局架构图、模块表、数据流
- `CONVENTIONS.md` — 目录结构、命名、架构原则、代码审查清单
- `API_SPEC.md` v2.0.0 — 四端完整端点定义
- `WORKFLOWS.md` — 统一工作流引擎、三大流程、七标准任务

---

*决策者：主工程师 | 评审：架构组 | 生效日期：2026-07-09*