# 项目清理计划

> 基于全量文件扫描制定的详细清理方案，分阶段执行，每阶段需确认后推进。

---

## Phase 0：预备 —— 建立 Lint 基线（必须第一个执行）

> **目的**：把现有的编译错误“冻结”为基线，后续每个子任务只验证**新增错误为 0**，不被存量错误干扰。

| 子任务 | 命令 / 操作 | 说明 | 状态 |
|--------|-------------|------|------|
| 0.1 | `npm run lint 2>&1 \| grep -E "^src/" \| cut -d: -f1-3 \| sort -u > lint-baseline.txt` | 生成基线文件（当前 2 个旧错误） | ✅ 已执行 |
| 0.2 | `cat lint-baseline.txt` 确认内容 | 应只有 2 行：`CreateOrderUseCase.ts:77:9` 和 `WorkflowEngine.ts:221:49` | ✅ 已执行 |

**后续每个子任务的验证标准**：
```bash
# 增量检查：只看新增错误
npm run lint 2>&1 | grep -E "^src/" | cut -d: -f1-3 | sort -u | comm -13 lint-baseline.txt -
# 输出为空 = 通过；有输出 = 新增错误，需修复后再提交
```

> **基线文件不纳入 Git**，仅本地作为校验工具。阶段结束后可删除。

---

## 1. 问题总览

| 类别 | 数量 | 风险等级 | 说明 |
|------|------|----------|------|
| Worktree 残留目录 | 2 个 | 🟢 无 | 临时工作树，任务已结束 |
| 备份/归档目录 | 2 个 | 🟢 无 | 旧迁移备份、只读归档文档 |
| 重复核心实现 | 3 套工作流引擎 | 🟡 中 | 需统一为 `src/core/workflows/` |
| 重复 Supabase 客户端 | 2 处 | 🟡 中 | 需统一为 `src/adapters/supabase/` |
| 服务层/仓储层边界模糊 | 12 个服务 | 🟠 高 | 需按六边形架构梳理 |
| 废弃测试/集成文件 | 5+ 个 | 🟢 无 | 根目录、旧测试目录 |
| 备份文件 | 1 个 | 🟢 无 | `src/database.ts.bak` |
| 子项目依赖确认 | 1 个 | 🟡 中 | `workflow-engine` workspace |

---

## 2. 分阶段执行计划

### Phase 1：无脑删除（零风险，立即可执行） —— **单命令级**

| 子任务 | 命令 | 状态 |
|--------|------|------|
| 1.1 | `rm -rf .claude/worktrees/` | ✅ 已执行 |
| 1.2 | `rm -rf supabase/migrations.backup.1783465198/` | ✅ 已执行 |
| 1.3 | `rm -rf .readonly/` | ❌ **跳过** (保留作为基线对比) |
| 1.4 | `rm -f src/database.ts.bak` | ✅ 已执行 |
| 1.5 | `rm -f test-integration-full.ts` | ✅ 已执行 |

**预计释放空间**：~50MB  
**风险**：零 — 均为临时/备份/归档文件

---

### Phase 2.1 & 2.3：单命令级

| 子任务 | 命令 | 前置条件 | 状态 |
|--------|------|----------|------|
| 2.1 | `rm -rf src/workflows/` | 无 | ✅ 已执行 |
| 2.3 | `rm -rf src/supabase/` | **Phase 2.2 全部完成** | ⏳ 待确认 |

---

### Phase 2.2：迁移 SupabaseClient 引用 —— **细分到单文件级**

> **每个文件 = 一个可独立提交的原子操作**  
> 执行顺序：先改 import，再改调用方式，跑 lint 验证，提交，再下一个

| 子任务 | 文件 | 当前 Import | 目标 Import | 关键调用变更 | 状态 |
|--------|------|-------------|-------------|--------------|------|
| 2.2.1 | src/middleware/AuthMiddleware.ts | `createSupabaseClientFromEnv` from `../supabase/SupabaseClient` | `WmsSupabaseClient.getInstance()` | `supabaseClient.query()` → `client.rpc()` / `client.from()` | ✅ 已执行 |
| 2.2.2 | src/routes/users.ts | `SupabaseClient, createSupabaseClientFromEnv` | `WmsSupabaseClient` | 构造函数注入 → `WmsSupabaseClient.getInstance()` | ✅ 已执行 |
| 2.2.3 | src/routes/devices.ts | 同上 | 同上 | 同上 | ✅ 已执行 |
| 2.2.4 | src/routes/inventory.ts | `SupabaseClient` | 同上 | 同上 | ✅ 已执行 |
| 2.2.5 | src/routes/orders.ts | 同上 | 同上 | 同上 | ✅ 已执行 |
| 2.2.6 | src/routes/index.ts | `createSupabaseClientFromEnv` | 同上 | 同上 | ✅ 已执行 |
| 2.2.7 | src/routes/replenishment.ts | `SupabaseClient, createSupabaseClientFromEnv` | 同上 | 同上 | ✅ 已执行 |
| 2.2.8 | src/routes/wave-strategy.ts | 同上 | 同上 | 同上 | ✅ 已执行 |
| 2.2.9 | src/routes/reports.ts | 同上 | 同上 | 同上 | ✅ 已执行 |
| 2.2.10 | src/routes/work-orders.ts | 同上 | 同上 | 同上 | ✅ 已执行 |
| 2.2.11 | src/services/ActionLogService.ts | `SupabaseClient` | 同上 | 同上 | ✅ 已执行 |
| 2.2.12 | src/services/LoadingService.ts | 同上 | 同上 | 同上 | ✅ 已执行 |
| 2.2.13 | src/services/ProductConstraintService.ts | 同上 | 同上 | 同上 | ✅ 已执行 |
| 2.2.14 | src/services/ReplenishmentScheduler.ts | 同上 | 同上 | 同上 | ⏳ |
| 2.2.15 | src/services/WorkOrderService.ts | 同上 | 同上 | 同上 | ⏳ |
| 2.2.16 | src/services/BillingEngine.ts | 同上 | 同上 | 同上 | ⏳ |
| 2.2.17 | src/services/SortingService.ts | 同上 | 同上 | 同上 | ⏳ |
| 2.2.18 | src/services/PackingService.ts | 同上 | 同上 | 同上 | ⏳ |
| 2.2.19 | src/services/VerificationService.ts | 同上 | 同上 | 同上 | ⏳ |
| 2.2.20 | src/services/StockAllocationService.ts | 同上 | 同上 | 同上 | ⏳ |
| 2.2.21 | src/services/BlackboxReceivingService.ts | 同上 | 同上 | 同上 | ⏳ |
| 2.2.22 | src/workflows/tasks.ts | `SupabaseClient, createSupabaseClientFromEnv` | 同上 | **Phase 1 删除，跳过** | ⏳ |

**执行模板（每个子任务）**：
```bash
# 1. 读取文件
cat src/middleware/AuthMiddleware.ts

# 2. 修改 import + 调用方式 (用 Edit 工具)
# 3. 验证（增量检查）
npm run lint 2>&1 | grep -E "^src/" | cut -d: -f1-3 | sort -u | comm -13 lint-baseline.txt -

# 4. 通过则提交
git add src/middleware/AuthMiddleware.ts
git commit -m "chore(migrate): AuthMiddleware -> WmsSupabaseClient (2.2.1)"
```

---

### Phase 3：服务层 → UseCase 迁移 —— **细分到单文件级**

> 每批 2-3 个，按「无外部依赖 → 有依赖」顺序  
> 完成一个 = 新建 UseCase 文件 + 重写逻辑 + 注入 Repository Port + 删旧 Service

#### Batch 3.1（无 Repository 依赖，纯逻辑/工具类）
| 子任务 | 源 Service | 目标 UseCase | 需注入的 Port | 状态 |
|--------|------------|--------------|---------------|------|
| 3.1.1 | RoleManager | `src/core/usecases/auth/ManageRoleUseCase.ts` | `IAuthProvider`, `IRoleRepository` | ⏳ |
| 3.1.2 | ActionLogService | `src/core/usecases/workorder/LogWorkOrderActionUseCase.ts` | `IWorkOrderRepository` | ⏳ |

#### Batch 3.2（依赖 IInventoryRepository）
| 子任务 | 源 Service | 目标 UseCase | 需注入的 Port | 状态 |
|--------|------------|--------------|---------------|------|
| 3.2.1 | ProductConstraintService | `src/core/usecases/inventory/ManageProductConstraintUseCase.ts` | `IProductRepository`, `IProductConstraintRepository` | ⏳ |
| 3.2.2 | StockAllocationService | `src/core/usecases/inventory/AllocateInventoryUseCase.ts` (已存在) | `IInventoryRepository` | ⏳ |
| 3.2.3 | BlackboxReceivingService | `src/core/usecases/inbound/ResolveBlackboxUseCase.ts` (已存在) | `IInventoryRepository`, `IInboundReceiptRepository` | ⏳ |

#### Batch 3.3（依赖 IWorkOrderRepository）
| 子任务 | 源 Service | 目标 UseCase | 需注入的 Port | 状态 |
|--------|------------|--------------|---------------|------|
| 3.3.1 | WorkOrderService | `src/core/usecases/workorder/CreateWorkOrderUseCase.ts` (已存在) | `IWorkOrderRepository` | ✅ 已执行 |
| 3.3.2 | ReplenishmentScheduler | `src/core/usecases/inventory/ScheduleReplenishmentUseCase.ts` | `IInventoryRepository`, `ILocationRepository`, `IWorkOrderRepository` | ✅ 已执行 |

#### Batch 3.4（依赖多 Repository，出库链路）
| 子任务 | 源 Service | 目标 UseCase | 需注入的 Port | 状态 |
|--------|------------|--------------|---------------|------|
| 3.4.1 | SortingService | `src/core/usecases/outbound/ExecuteSortingUseCase.ts` | `ISortingTaskRepository`, `ISortingChuteRepository`, `IWorkOrderRepository` | ⏳ |
| 3.4.2 | PackingService | `src/core/usecases/outbound/ExecutePackingUseCase.ts` | `IPackingTaskRepository`, `IPackageSpecRepository`, `ILabelTemplateRepository` | ⏳ |
| 3.4.3 | LoadingService | `src/core/usecases/outbound/ExecuteLoadingUseCase.ts` | `ILoadingTaskRepository`, `IVehicleRepository` | ⏳ |
| 3.4.4 | VerificationService | `src/core/usecases/outbound/ExecuteVerificationUseCase.ts` | `IQualityInspectionRepository`, `IVerificationRuleRepository` | ⏳ |

#### Batch 3.5（计费/其他）
| 子任务 | 源 Service | 目标 UseCase | 需注入的 Port | 状态 |
|--------|------------|--------------|---------------|------|
| 3.5.1 | BillingEngine | `src/core/usecases/billing/CalculateBillingUseCase.ts` (已存在) | `IBillingRuleRepository`, `IBillingTransactionRepository` | ⏳ |

---

### Phase 4：路由/中间件迁移 —— **细分到单文件级**

| 子任务 | 源文件 | 目标位置 | 处理方式 | 状态 |
|--------|--------|----------|----------|------|
| 4.1 | src/middleware/AuthMiddleware.ts | 归档到 `src/adapters/express/middleware/AuthMiddleware.archived.ts` | 功能并入 `ExpressMiddlewareFactory.createAuthMiddleware()` | ⏳ |
| 4.2 | src/middleware/rls.ts | 归档到 `src/adapters/express/middleware/RlsMiddleware.archived.ts` | 同理 | ⏳ |
| 4.3 | src/routes/users.ts | `src/apps/tenant-api/routes/users.ts` | 调整 import 路径，注册到 tenant-api | ⏳ |
| 4.4 | src/routes/devices.ts | `src/apps/device-api/routes/devices.ts` | 注册到 device-api | ⏳ |
| 4.5 | src/routes/inventory.ts | `src/apps/tenant-api/routes/inventory.ts` | 注册到 tenant-api | ⏳ |
| 4.6 | src/routes/orders.ts | `src/apps/tenant-api/routes/orders.ts` | 注册到 tenant-api | ⏳ |
| 4.7 | src/routes/work-orders.ts | `src/apps/tenant-api/routes/work-orders.ts` | 注册到 tenant-api | ⏳ |
| 4.8 | src/routes/packing.ts | `src/apps/tenant-api/routes/packing.ts` | 注册到 tenant-api | ⏳ |
| 4.9 | src/routes/loading.ts | `src/apps/tenant-api/routes/loading.ts` | 注册到 tenant-api | ⏳ |
| 4.10 | src/routes/sorting.ts | `src/apps/tenant-api/routes/sorting.ts` | 注册到 tenant-api | ⏳ |
| 4.11 | src/routes/verification.ts | `src/apps/tenant-api/routes/verification.ts` | 注册到 tenant-api | ⏳ |
| 4.12 | src/routes/replenishment.ts | `src/apps/tenant-api/routes/replenishment.ts` | 注册到 tenant-api | ⏳ |
| 4.13 | src/routes/reports.ts | `src/apps/tenant-api/routes/reports.ts` | 注册到 tenant-api | ⏳ |
| 4.14 | src/routes/wave-strategy.ts | `src/apps/tenant-api/routes/waves.ts` | 注册到 tenant-api | ⏳ |
| 4.15 | src/routes/index.ts | **删除** | 各端自行在 main.ts 注册 | ⏳ |

---

### Phase 5：决策级

| 子任务 | 选项 | 决策依据 | 状态 |
|--------|------|----------|------|
| 5.1 | A. 保留 / B. 废弃 / C. 合并 | Phase 2 后对比 `workflow-engine/src/WorkflowManager.ts` vs `src/core/workflows/WorkflowEngine.ts` 功能覆盖度 | ⏳ |

---

## 3. 执行检查清单（每子任务通用）

> **核心原则**：基于 lint-baseline.txt 做**增量校验**，不要求全量通过。

- [ ] **增量 lint 通过**：`npm run lint 2>&1 | grep -E "^src/" | cut -d: -f1-3 | sort -u | comm -13 lint-baseline.txt -` 输出为空
- [ ] `npm run test` 通过 (受影响测试)
- [ ] `npm run build` 通过
- [ ] Git commit 单文件/单逻辑变更

---

## 4. 版本记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-07-12 | 初版：全量扫描分析、5 阶段清理计划 |
| 1.1.0 | 2025-07-12 | 细化 Phase 2.2 SupabaseClient 迁移清单、Phase 3 分批迁移策略 |
| 1.2.0 | 2025-07-12 | 新增 Phase 0 Lint 基线建立、修正执行检查清单为增量模式 |
| 1.3.0 | 2025-07-12 | Phase 0-1 执行完成，状态更新为 ✅ |

---

## 5. 待确认决策点汇总

| # | 决策点 | 选项 | 我的建议 | 你的确认 |
|---|--------|------|----------|----------|
| 1 | Phase 0 建立 lint 基线并立即执行？ | 是/否 | **是** | ✅ 已执行 |
| 2 | Phase 1.1~1.5（除 1.3）立即执行？ | 是/否 | **是** | ✅ 已执行 |
| 3 | Phase 2.1 删除 `src/workflows/`？ | 是/否 | **是** | ✅ 已执行 |
| 4 | Phase 2.2 开始迁移 SupabaseClient 引用？ | 是/否 | **是** | ⏳ |
| 5 | Phase 2.3 删除 `src/supabase/`？ | 是/否 | **是 (Phase 2.2 全部完成后)** | ⏳ |
| 6 | Phase 3 服务层迁移策略？ | 全量/分批/暂缓 | **分批（每批 2-3 个）** | ⏳ |
| 7 | Phase 4 路由/中间件统一？ | 是/否 | **是** | ⏳ |
| 8 | Phase 5 workflow-engine 处置？ | 保留/废弃/合并 | 视 Phase 2 结果定 | ⏳ |

---

> **使用方式**：每次讨论一个子任务，确认后更新本文件对应状态为 `✅ 已执行` 或 `❌ 跳过`，再进入下一子任务。
