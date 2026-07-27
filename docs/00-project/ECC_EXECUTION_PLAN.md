# 后端缺口 ECC 多维执行计划

> **日期**: 2026-07-27  
> **基于**: `BACKEND_GAP_ANALYSIS.md` (2026-07-27)  
> **统一文档**: ROADMAP.md、REPOSITORY_ROADMAP.md、DB_SCHEMA.md、ARCHITECTURE.md

---

## ECC 多维度分析

### 业务维度

**核心判断**: 数据库已可支撑全业务流程（23 层迁移覆盖入库→质检→上架→波次→拣选→分拣→打包→发货→计费全链路），但应用层缺少两个关键环节:

1. **租户自助操作入口**: 只有 Admin API（平台超管视角）和 Device API（PDA 设备视角），没有租户运营人员使用的 Tenant API
2. **订单/库存/商品管理**: 数据库有完整的表结构和 RPC，但应用层 Repository 没有实现这些核心域的 CRUD

**业务风险**: 当前"能演示"但"不能上线"——Admin API 绕过了多租户隔离，Device API 能离线同步但不能管理订单和库存。

### 架构维度

**六边形架构合规性**: 端口层完整（45 接口），但适配器层有 8 个 P0 缺口。当前 Admin API 直接调用 `supabase.from()` 绕过了端口层——需要在 Phase 2 实施时同步修复。

**关键架构决策**:
- ADR-015 选型已定（方案 A: 触发器同步 `auth.users` → `public.users`），不需要重新设计，直接实施
- ADR-008 工作流引擎可降级——当前 RPC 函数已覆盖核心业务流程，工作流引擎是编排层的优化而非阻塞项

### 功能维度

**阻塞链分析**: ADR-015 → Repository Phase 2 → Tenant API → 前端。必须严格按序推进，不能并行。

### 设计维度

**需同步更新的文档**: ROADMAP.md（状态标记）、REPOSITORY_ROADMAP.md（Phase 2 新增）、ARCHITECTURE.md（ADR-015 实施记录）、DB_SCHEMA.md（auth 桥接表）、API_SPEC.md（Tenant API 端点）

### 测试维度

**现有覆盖**: 59 单元测试 + 82 并发测试。**缺口**: Phase 2 仓库需要 concurrency 测试（参照 Phase 5/6/7 标准）、Tenant API 需要 HTTP 契约测试、ADR-015 需要跨租户隔离测试。

### 安全维度

**ADR-015 是安全基石**: 实施后需要验证: ① 租户 A 查不到租户 B 的数据（RLS 实际生效）② `fn_current_tenant_id()` 返回正确值 ③ per-request client 的 JWT 正确注入

---

## 执行阶段

### Sprint 0: ADR-015 Auth Identity Bridge（预估 2-3 天）— 应用层已完成（2026-07-27）

**目标**: 让 RLS 租户隔离真正生效

| 任务 | 产出 | 验证 | 状态 |
|------|------|------|------|
| 0.1 创建 `auth.users` → `public.users` 触发器 | 迁移脚本（提交 HiWmsSupabase 作为 DBA addendum） | 新用户注册后 `public.users` 自动创建行 | ⏳ 待 DBA 评审（`DBA_ADDENDUM_REQUEST_AUTH_IDENTITY_BRIDGE_2026-07-27.md`，5 个开放问题待拍板） |
| 0.2 实现 per-request Supabase client | 修改 `SupabaseClient.ts`/`SupabaseBaseRepository.ts` | `fn_current_tenant_id()` 返回非 NULL | ✅ 应用层已完成，`tsc` 零错误 |
| 0.3 修复 `injectRlsContext` | 中间件上下文被 Repository 层消费 | 端到端: 租户 A 用户只能看到自己的订单 | 🟡 中间件改造已完成，但 `authToken` 尚未接到具体仓库业务方法/路由层，"端到端"验证未达成 |
| 0.4 跨租户隔离集成测试 | `src/__tests__/integration/auth/tenant-isolation.test.ts` | 租户 A 查不到租户 B 数据 | 🟡 测试已编写，但触发器（0.1）未落地导致本地实测 `tenant_id` 为 null，CI 因未设 `RUN_DB_INTEGRATION_TESTS` 恒跳过，暂不能作为验证证据 |

**文档同步**: ARCHITECTURE.md §11、DB_SCHEMA.md、ROADMAP.md §1.4（均已于 2026-07-27 同步）

### Sprint 1: Repository Phase 2（原预估 3-4 天，2026-07-27 复核后更正范围）

**目标更正**：原「补全 8 个 P0 仓库实现」的前提不成立——2026-07-27 复核确认 7 个仓库均已完整实现且已接线 DI（方法签名与端口接口逐一比对完全吻合），本次审计（PR #55）"零进度"的结论是误判。**真实目标改为：补齐测试覆盖**（单测/并发测试/集成测试），参照 Phase 5/6/7 标准。

| 任务 | 仓库 | 依赖 | 实现状态 | 测试状态 |
|------|------|------|---------|---------|
| 1.1 | `SupabaseTenantRepository` | 无 | ✅ 已实现 | 🔨 补测试中 |
| 1.2 | `SupabaseProductRepository` + `SupabaseProductConstraintRepository` | 无 | ✅ 已实现 | 🔨 补测试中 |
| 1.3 | `SupabaseInventoryRepository` | Product | ✅ 已实现（含已知技术债，见 REPOSITORY_ROADMAP.md） | 🔨 补测试中 |
| 1.4 | `SupabaseOrderRepository` | Tenant、Product | ✅ 已实现 | 🔨 补测试中 |
| 1.5 | `SupabaseWorkOrderRepository` | Order、Inventory | ✅ 已实现 | 🔨 补测试中 |
| 1.6 | `SupabaseSortingChuteRepository` | 无 | ✅ 已实现 | 🔨 补测试中 |

每个仓库参照 Phase 5/6/7 标准补齐：并发测试（覆盖端口全部方法 + 至少一个并发场景）。

**同步修复**: Admin API 中直接调用 `supabase.from()` 的地方改为走 Repository 层——这一项仍待处理，不受本次范围更正影响。

### Sprint 2: Tenant API + Use Case 层（预估 3-4 天）

**目标**: 提供前端可调用的租户端 API

| 任务 | 端点 | 说明 |
|------|------|------|
| 2.1 Tenant API 骨架 | Express app + DI + 中间件 | 参照 device-api 架构 |
| 2.2 订单端点 | `GET/POST /api/orders`、`GET /api/orders/:id` | CRUD |
| 2.3 库存端点 | `GET /api/inventory`、`GET /api/inventory/:id` | 只读查询 |
| 2.4 商品端点 | `GET /api/products`、`GET /api/products/:id` | 只读 + 搜索 |
| 2.5 波次端点 | `GET /api/waves`、`POST /api/waves/generate` | 创建+查询 |
| 2.6 Use Case 补全 | `CreateOrderUseCase`、`GenerateWaveUseCase`、`AllocateInventoryUseCase` | 编排逻辑 |
| 2.7 HTTP 契约测试 | 每个端点至少 1 个 happy path + 1 个 error path | vitest + supertest |

### Sprint 3: 测试补全 + 文档收尾（预估 1-2 天）

| 任务 | 说明 |
|------|------|
| 3.1 Phase 8 仓库集成测试补全 | InventoryUnit、StorageManagementPolicy、Zone |
| 3.2 Device API auth HTTP 集成测试 | login/refresh/provision/pairing-qr |
| 3.3 `fn_expire_task_claims` pg_cron 注册 | HiWmsSupabase addendum |
| 3.4 permissions 种子数据补全 | `supabase/seed.sql` |
| 3.5 全部文档同步 | ROADMAP/REPOSITORY_ROADMAP/ARCHITECTURE/DB_SCHEMA/API_SPEC |

---

## 依赖关系图

```
Sprint 0 (ADR-015)
  └─ Sprint 1 (Repository Phase 2)
       └─ Sprint 2 (Tenant API + Use Case)
            └─ Sprint 3 (测试 + 文档收尾)
                 └─ 前端 Phase 2 可启动
```

---

## 与现有文档的统一

| 现有文档 | 更新内容 |
|----------|----------|
| `ROADMAP.md` | §1.4 标记 ADR-015 为当前活跃 Sprint；新增 §1.7 Sprint 执行追踪表 |
| `REPOSITORY_ROADMAP.md` | Phase 2 从 "⏳" 改为 "🔨 实施中 (Sprint 1)"；补充 8 个仓库的任务拆分 |
| `ARCHITECTURE.md` | ADR-015 状态从 "设计完成" 更新为 "实施中 (Sprint 0)" |
| `DB_SCHEMA.md` | 新增 auth identity bridge 触发器表结构 |
| `API_SPEC.md` | 新增 Tenant API 端点定义 |
| `CONVENTIONS.md` | 补充 per-request client 模式规范 |

---

## 成功标准

| Sprint | 标准 | 当前状态（2026-07-27） |
|--------|------|------|
| Sprint 0 | `fn_current_tenant_id()` 在 authenticated 请求中返回正确 tenant_id；跨租户测试通过 | **应用层达成**：`tsc --noEmit` 零错误、`vitest` 84 passed/125 skipped，两轮独立评审无 CRITICAL/HIGH。**未完全达成**：数据库侧触发器待 DBA 落地，`fn_current_tenant_id()` 在真实自助注册用户上尚未验证返回非 NULL；`authToken` 未接线到业务层/路由层；跨租户隔离测试因触发器缺失暂不能作为验证证据。不宜理解为"RLS 已在生产验证生效"或"可直接开始 Sprint 1 且无遗留风险"——具体限制见 ADR-015「实施记录」 |
| Sprint 1 | ~~8 个仓库全部实现~~ + 并发测试；tsc 零错误；vitest 全绿 | **已完成**（2026-07-27，merged PR #57）：7 个仓库均已实现并接线 DI（更正原"零进度"误判），并发测试补齐，顺带发现并修复约 40 处状态字面量 bug，新建 `src/core/constants/status.ts` 统一常量 |
| Sprint 2 | Tenant API 全部端点可调用；HTTP 契约测试通过；前端可开始对接 | **已完成**（2026-07-27，draft PR #58）：7 个端点全部可调用，33 个 HTTP 契约测试通过，本地 ECC review 无 CRITICAL/HIGH 遗留。前端可以开始对接，但认证机制是标准 Supabase 用户 JWT（非本文档 ARCHITECTURE.md §4.2 原描述的独立 Tenant JWT），对接时以此为准 |
| Sprint 3 | 缺口清单清零；全部文档同步；CI 可加入 DB 并发测试 | **已完成**（2026-07-28，draft PR #59）：Phase 8 仓库测试核实已在 PR #49 完成；Device API auth 集成测试过程中发现并修复 4 处 CRITICAL 生产 bug（login/refresh 不可达、JWT 验证恒失败、密钥存储不共享、provision 插入不存在的列）；`fn_expire_task_claims` pg_cron 注册与 permissions 种子数据均已提交 DBA addendum（尚待 DBA 落地，非本仓库可直接完成）；文档同步范围收窄为具体增量（API_SPEC/ARCHITECTURE/ROADMAP/REPOSITORY_ROADMAP），DB_SCHEMA 未改动。CI 加入 DB 并发测试**未做**——不在本轮范围内，仍是待办 |
