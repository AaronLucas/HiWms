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

---

## 第二阶段 ECC 多维度复核（2026-07-28，PR #56/57/58/59 均已合并入 main）

> 触发原因：PR #59 squash 合并后本地 main 已同步至 `84e02bf`。Sprint 0-3 全部任务已交付，需要重新审视当前真实状态并规划下一阶段。以下基于对代码的直接核查（非文档复述）：`grep` 全部路由文件统计端点与权限校验覆盖率、读取 ADR-015 最新实施记录、检查 CI workflow 文件、确认前端目录不存在。

### 业务维度

后端两个此前缺失的入口（Tenant API、订单/库存/商品 Use Case）已补齐并上线，"能演示但不能上线"的判断需要更新为：**能上线但两个安全基石尚未闭环**——① RLS 隔离依赖的数据库触发器仍未落地，② 刚上线的业务端点几乎没有基于角色的操作权限控制。在这两项闭环前把前端接进来，租户内的越权操作风险是真实存在的，不是理论风险。

### 架构维度

**新发现的真实缺口（非文档误判，直接代码核查确认）**：
- `grep` 统计 tenant-api（10 端点）+ device-api 业务端点（15 端点，不含 `/health` 与 login/refresh 两个免鉴权端点）共 25 个受保护端点，其中做了 `requirePermission`/`permissionChecker.check` 权限校验的只有 1 个（`POST /device/provision`，Sprint 3 #30 新接的）。其余 24 个只验证了"合法登录"，没有验证"这个角色能不能做这件事"。
- `SupabaseAuthProvider.ts` 仍有 3 处已知但未修的问题（ADR-015 文档已记录，尚未排期）：`signUp()` 写 `app_metadata.tenant_id` 的位置需要等触发器设计定稿后才能对齐时序；`signIn()` 第 134 行 `(data.user as any).tenant_id` 类型断言恒为 `null`；`generateTokens()` 第 106 行直接 `throw`，未评估是否废弃。
- `.github/workflows/db-integration.yml` 明确标注"未加入 ci.yml 的 ci-success 硬门禁，首次上线先观察稳定性"——这是有意的临时状态，不是遗漏，但需要一个"观察期结束"的判断时间点，目前没有。

### 功能维度

**新阻塞链**：
```
DBA 落地 3 个 addendum（AUTH_IDENTITY_BRIDGE 触发器 / PERMISSIONS_SEED / TASK_CLAIM_EXPIRY_CRON）
  ├─ 触发器落地 → 解除 tenant-isolation.test.ts 的 skip → RLS 端到端验证 → 修 SupabaseAuthProvider 3 处遗留问题
  └─ PERMISSIONS_SEED 落地 → RBAC 覆盖矩阵设计 → 推广到 tenant-api 全部写端点 + device-api 剩余端点
       └─ 两条线都闭环后 → 前端才具备"安全上线"的前提条件（此前"前端可启动"指的是能调通，不代表鉴权闭环）
```
DBA 三个 addendum 都不是本仓库能直接完成的工作，但 AUTH_IDENTITY_BRIDGE 的 5 个开放问题目前卡在"待产品/DBA/项目负责人拍板"——这是本仓库可以主动推进的部分（把开放问题拆得更具体、给出推荐方案，降低对方决策成本）。

### 设计维度

需要新增一份 **RBAC 覆盖矩阵**（哪个端点该配哪个 `resource:action`，目前是零散的、只有 provision 一个是被动接入的），建议放在 `docs/02-api/API_SPEC.md` 新增小节，而不是散落在各路由文件的注释里。

### 测试维度

`tenant-isolation.test.ts` 是当前唯一的"红旗"：测试本身已经写好，但因为触发器未落地，本地实测 `tenant_id` 为 `null`，且 CI 恒 `skipIf`——这意味着"跨租户隔离已验证"这句话目前没有测试证据支撑，只有代码审查层面的信心。

### 安全维度

**本轮复核的最高优先级发现**：24/25 个已上线业务端点没有基于角色的权限校验，只有租户级隔离（还依赖尚未落地的触发器）。在权限种子数据（`PERMISSIONS_SEED` addendum）落地之前，即使把 RBAC 中间件接上，也没有真实角色数据可用于验证——这是两个独立但耦合的阻塞项。

---

## Sprint 4：安全闭环——ADR-015 数据库侧收尾 + RBAC 覆盖（预估 3-4 天，含跨仓库协同等待）

| 任务 | 产出 | 依赖 | 状态 |
|------|------|------|------|
| 4.1 推进 AUTH_IDENTITY_BRIDGE 5 个开放问题拍板 | 把开放问题拆成"推荐方案 + 影响范围"，降低 DBA/产品决策成本 | 无 | 待启动 |
| 4.2 触发器落地后：解除 `tenant-isolation.test.ts` skip | CI 环境变量 `RUN_DB_INTEGRATION_TESTS=true`，真实验证跨租户隔离 | 4.1（DBA 落地触发器） | 阻塞中 |
| 4.3 修复 `SupabaseAuthProvider.signUp/signIn/generateTokens` 3 处遗留问题 | `app_metadata` 写入位置、类型断言、`generateTokens` 去留评估 | 4.1（需要触发器时序定稿） | 阻塞中 |
| 4.4 RBAC 覆盖矩阵设计 | `API_SPEC.md` 新增小节：25 个端点 × 建议 `resource:action` | 无（可现在做设计，不依赖 DBA） | 可立即启动 |
| 4.5 推广 RBAC 到 tenant-api 写端点 | `POST /orders`、`POST /orders/:id/allocate`、`POST /waves/generate` 优先接入 | 4.4 + PERMISSIONS_SEED 落地才能验证 | 阻塞验证，不阻塞接入代码 |
| 4.6 推广 RBAC 到 device-api 剩余端点 | 16 个业务端点中除 provision 外的其余按矩阵接入 | 同上 | 阻塞验证 |
| 4.7 `fn_expire_task_claims` cron + permissions 种子落地验证 | 确认 DBA 侧已应用两个 addendum | 跨仓库 | 待 DBA 反馈 |

## Sprint 5：CI 加固 + 技术债清理（预估 1-2 天）

| 任务 | 说明 |
|------|------|
| 5.1 `db-integration.yml` 观察期评估 | 稳定运行一段时间后，评估是否升级为 `ci-success` 硬门禁 |
| 5.2 Admin API 绕过 Repository 层技术债 | `BACKEND_GAP_ANALYSIS.md` §2.2 遗留项，直接 `supabase.from()` 调用改走 Repository |
| 5.3 Use Case 层剩余 stub 复核 | 参照 `AllocateInventoryUseCase` 命名误导的先例，逐个确认是否真的需要实现 |

## Sprint 6：前端启动准备（依赖 Sprint 4 安全闭环，预估 1 天）

| 任务 | 说明 |
|------|------|
| 6.1 确认前端仓库/技术栈落地方式 | `ROADMAP.md` 阶段 2 提到 Uniapp Vue3，需确认是否独立仓库 |
| 6.2 API 对接文档定稿 | 明确认证方式为标准 Supabase 用户 JWT（非独立 Tenant JWT），基于 `API_SPEC.md` §3.16 |
| 6.3 CORS / 环境变量对接清单 | tenant-api / device-api 的跨域与环境配置交给前端团队 |

---

## 依赖关系图（第二阶段）

```
Sprint 4 (RBAC + ADR-015 数据库侧收尾)
  ├─ 4.1-4.3 依赖 DBA 拍板与落地（跨仓库，非本仓库可单方面完成）
  ├─ 4.4-4.6 可在本仓库内独立推进（设计+接入代码不依赖 DBA，但验证依赖）
  └─ 4.7 依赖 DBA 落地两个已提交的 addendum
       └─ Sprint 5 (CI 加固 + 技术债)
            └─ Sprint 6 (前端启动准备)
```

## 成功标准（第二阶段）

| Sprint | 标准 |
|--------|------|
| Sprint 4 | `tenant-isolation.test.ts` 不再 skip 且通过；`SupabaseAuthProvider` 3 处遗留问题清零；tenant-api 写端点与 device-api 剩余端点均接入 RBAC；种子角色下实测权限校验生效 |
| Sprint 5 | DB 并发测试纳入硬门禁（或有明确的观察期结束判断依据）；Admin API 技术债清零 |
| Sprint 6 | 前端团队拿到定稿的 API 对接文档，可以开始联调 |
