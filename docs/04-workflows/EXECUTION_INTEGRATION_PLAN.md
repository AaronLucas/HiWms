# 多计划融合执行总控计划

> 版本：v1.0 | 生成：2026-07-13 | 基于完整上下文分析生成

---

## 核心原则

1. **REPOSITORY_ROADMAP 为唯一基础设施基准** - 所有 Repository 相关任务以此为准
2. **CLEANUP_PLAN 为清理/重构执行计划** - 服从基础设施就绪节点
3. **INFRA_ALIGNMENT_PLAN 作废** - 内容已融合，删除避免混淆
4. **单一事实来源** - 任务状态仅在 CLEANUP_PLAN 中维护，ROADMAP 只管范围/契约

---

## 执行拓扑

```
REPOSITORY_ROADMAP Phase 1 Port (13个)
    │
    ├── 并行 Track A: Phase 1 Impl (13个)
    │   └─→ 解锁：CLEANUP Phase 3 Batch 3.2/3.3
    │
    └── 并行 Track B: CLEANUP Phase 2.2 剩余 9 文件
        └─→ 无依赖，随时可跑
```

---

## 详细分阶段

### Stage 0：环境就绪（已完成）
- [x] lint-baseline.txt 建立
- [x] EXECUTION_PLAN V2.1 迁移完成
- [x] ROADMAP/REPOSITORY_ROADMAP 就位

### Stage 1：基础设施就绪（Week 1-2）【当前进行中】

| 任务 | 负责 | 产出 | 阻塞解除 |
|------|------|------|----------|
| R1.1 创建 7 个缺失 Port | Track-A | 7 个 .ts + index.ts | S1 |
| R1.2 创建 13 个实现 | Track-A | 13 个 .ts + index.ts | S1 |
| R1.3 类型检查全过 | Track-A | `tsc --noEmit` 0 error | S1 |
| C2.2-remain 完成 9 文件迁移 | Track-B | 9 个文件 lint 过 | - |

**S1 同步点**：13 Port 全部就绪 → 启动 Phase 3 UseCase、Phase 1 实现并行

### Stage 2：UseCase 与实现并行（Week 2-3）
| 任务 | 依赖 | 产出 |
|------|------|------|
| Phase 1 实现 (13个) | S1 | 13 impl |
| Phase 3 Batch 3.2 (ProductConstraint/StockAlloc/Blackbox) | S1 | 3 UseCase |
| Phase 3 Batch 3.3 (WorkOrder/Replenish) | S1 | 2 UseCase |

### Stage 3：出库链路与 Phase 2 实现（Week 3-4）
| 任务 | 依赖 |
|------|------|
| Phase 2 端口+实现 (8个) | Stage 1 完成 |
| Phase 3 Batch 3.4 (Sorting/Packing/Loading/Verify) | Phase 2 Port 就绪 |
| Phase 4 (Billing) | Phase 3 端口就绪 |

### Stage 4：路由迁移与清理收尾（Week 5）
| 任务 | 依赖 |
|------|------|
| CLEANUP Phase 4 路由迁移 | 所有 UseCase 就绪 |
| Phase 2.3 删除 src/supabase/ | 无直接调用残留 |
| Phase 5 workflow-engine 决策 | 对比完成 |

---

## 并行轨道分工（无干扰保证）

### Track-A：REPOSITORY_ROADMAP Phase 1（基础设施）

| 步骤 | 任务 | 文件位置 | 验收 |
|------|------|----------|------|
| A1 | 创建 7 个缺失 Port 接口 | `src/core/ports/db/I*.ts` (7个新文件) | tsc 通过、index.ts 导出 |
| A2 | 更新 index.ts 导出所有 13 个 Port | `src/core/ports/db/index.ts` | 导出无重复 |
| A3 | 创建 13 个实现类 | `src/adapters/supabase/repositories/Supabase*.ts` (13个新文件) | 继承 SupabaseBaseRepository、实现接口 |
| A4 | 更新实现层 index.ts | `src/adapters/supabase/repositories/index.ts` | 导出无重复 |
| A5 | 全量类型检查 | `npx tsc --noEmit` | 零错误 |

**产出物**：26 个文件（13 Port + 13 Impl）、2 个 index.ts 更新

### Track-B：CLEANUP Phase 2.2 剩余 9 文件（并行）

| 文件 | 当前 Import | 目标 | 风险 |
|------|-------------|------|------|
| src/routes/replenishment.ts | SupabaseClient | WmsSupabaseClient | 无 |
| src/routes/wave-strategy.ts | 同上 | 同上 | 无 |
| src/routes/reports.ts | 同上 | 同上 | 无 |
| src/routes/work-orders.ts | 同上 | 同上 | 无 |
| src/services/ActionLogService.ts | SupabaseClient | 同上 | 无 |
| src/services/LoadingService.ts | 同上 | 同上 | 无 |
| src/services/ProductConstraintService.ts | 同上 | 同上 | 低（后续重构） |
| src/services/ReplenishmentScheduler.ts | 同上 | 同上 | 已标记替代 |
| src/services/WorkOrderService.ts | 同上 | 同上 | 已标记替代 |

**验收**：增量 lint 零新增、测试通过

---

## 关键同步点

| 同步点 | 条件 | 解除阻塞 |
|--------|------|----------|
| **S1** | 13 个 Port 接口全部创建完成、索引更新、tsc 通过 | 解除：CLEANUP Phase 3 Batch 3.2/3.3、REPOSITORY Phase 1.2 实现 |
| **S2** | 13 个实现全部完成、继承基类、tsc 通过 | 解除：CLEANUP Phase 3 后续 Batch、Phase 4 路由迁移 |

---

## 互斥锁设计（防止单干互扰）

### 文件级锁约定

```yaml
# 隐性锁约定（各自工作区遵守）
locks:
  - pattern: "src/core/ports/db/I*.ts"
    owner: "track-A"
    expires: "2026-07-18"
  - pattern: "src/adapters/supabase/repositories/Supabase*.ts"
    owner: "track-A"
    expires: "2026-07-20"
  - pattern: "src/routes/*.ts"
    owner: "track-B"
    expires: "2026-07-16"
  - pattern: "src/services/*.ts"
    owner: "track-B"
    expires: "2026-07-16"
  - pattern: "src/core/ports/db/index.ts"
    owner: "track-A"
    shared: false
  - pattern: "src/adapters/supabase/repositories/index.ts"
    owner: "track-A"
    shared: false
```

### 提交前强制检查

```bash
# 双方提交前必须运行
npm run lint 2>&1 | grep -E "^src/" | cut -d: -f1-3 | sort -u | comm -13 lint-baseline.txt -
# 必须输出为空

npx tsc --noEmit
# 必须零错误
```

---

## 6. 已执行 CLEANUP 对 ROADMAP 影响确认表

| CLEANUP 已完成项 | ROADMAP 影响 | 处理 |
|-----------------|-------------|------|
| Phase 2.2.13 ProductConstraintService 迁移 | 产出了 IProductConstraintRepository (Phase 3→Phase 1) | ROADMAP 表格迁移到 Phase 1 |
| Phase 2.2.15 WorkOrderService 迁移 | 产出了 IWorkOrderRepository (已 Phase 1) | 无需动作 |
| Phase 2.2.11 ActionLogService 迁移 | 用 IWorkOrderRepository (已有) | 无需动作 |
| Phase 2.2.12 LoadingService 迁移 | 需 ILoadingTaskRepository (Phase 1 缺失) | ROADMAP 已列入 Phase 1，Track-A 优先创建 |
| SupabaseProductConstraintRepository 存在 | 实现了 IProductConstraintRepository | ROADMAP Phase 1 实现表补上 |
| SupabaseRoleRepository 存在 | 实现了 IRoleRepository | ROADMAP Phase 1 实现表补上 |

**结论**：CLEANUP 已执行部分**未破坏** ROADMAP，反而**提前补齐**了 2 个 Port + 2 个实现。只需更新 ROADMAP 表格位置即可。

---

## 7. 立即动作清单（写入文件后立即执行）

```bash
# 1. 删除冗余计划
rm docs/04-workflows/INFRA_ALIGNMENT_PLAN.md

# 2. 修正 ROADMAP 表格位置（把 IProductConstraintRepository、IRoleRepository 移到 Phase 1）
#    编辑 docs/03-database/REPOSITORY_ROADMAP.md

# 3. 更新 CLEANUP_PLAN 状态标记
#    编辑 docs/00-project/CLEANUP_PLAN.md

# 4. 创建 Track-A 首批任务：7 个缺失 Port
#    src/core/ports/db/ILocationRepository.ts
#    src/core/ports/db/IContainerRepository.ts
#    src/core/ports/db/ILoadingTaskRepository.ts
#    src/core/ports/db/IDeviceRepository.ts
#    src/core/ports/db/IInventoryLockRepository.ts
#    src/core/ports/db/IInventoryReservationRepository.ts
#    (IProductConstraintRepository、IRoleRepository 已存在)

# 5. 并行启动 Track-B：CLEANUP Phase 2.2 剩余 9 文件迁移
```

---

**同意此融合方案？** 同意我立即执行上述 5 条动作，生成三个文件的最终版本。（无需再确认每个细节，整套已自洽）