# 仓储层实施路线图

## 项目概览
- **总表数**：34 个业务表 + 7 个离线同步/统一异常领域表（v2.2.0 新增，取代原规划的 6 个 PDA 本地专用表设想）
- **聚合根数**：35 个
- **已完成**：5 个
- **待完成**：30 个
- **分 5 个优先级阶段实施**

> **2026-07-15 更新说明**：Phase 5 已按 DBA 新方案（操作同步 + 预分工 + 统一异常领域，见 ADR-011）整体替换——原规划的 `SyncQueue`/`SyncSession`/`SyncConflict`/`SyncCursor`/`PendingUpload`/`DeviceState` 6 个仓储对应的是旧版状态同步设计，其表名/职责与新方案的 `task_claims`/`sync_policies`/`device_sync_state`/`sync_events`/`exceptions` 完全不匹配，已废弃。
>
> **已知文档滞后提示**：调研发现 Phase 1/3/4 的部分端口/实现文件在实际代码仓库中可能已经存在（早于本文档勾选状态更新），但本次仅在独立 worktree 中核对文档设计，未接触到相关未提交代码，因此下方 Phase 1/3/4 的勾选状态**未做核实性修改**，留待下一轮 Phase 0（止血现有重构）时一并核对并更新。

---

## Phase 1: P0 核心聚合根（11个） - 最高优先级

### 1.1 端口定义
| # | 文件 | 状态 | 预估行数 | 备注 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/ILocationRepository.ts` | ⏳ 待开始 | ~80 | 库位管理核心 |
| 2 | `src/core/ports/db/IContainerRepository.ts` | ⏳ 待开始 | ~70 | 容器/LPN管理 |
| 3 | `src/core/ports/db/IInboundReceiptRepository.ts` | ⏳ 待开始 | ~100 | 入库单+质检项 |
| 4 | `src/core/ports/db/IWaveRepository.ts` | ⏳ 待开始 | ~90 | 波次+订单映射 |
| 5 | `src/core/ports/db/ICrossDockJobRepository.ts` | ⏳ 待开始 | ~80 | 交叉理货 |
| 6 | `src/core/ports/db/IPackingTaskRepository.ts` | ⏳ 待开始 | ~80 | 打包任务 |
| 7 | `src/core/ports/db/ISortingTaskRepository.ts` | ⏳ 待开始 | ~90 | 分拣任务+滑道 |
| 8 | `src/core/ports/db/ILoadingTaskRepository.ts` | ⏳ 待开始 | ~70 | 装车任务 |
| 9 | `src/core/ports/db/IDeviceRepository.ts` | ⏳ 待开始 | ~70 | PDA/设备管理 |
| 10 | `src/core/ports/db/IInventoryLockRepository.ts` | ⏳ 待开始 | ~70 | 库存悲观锁 |
| 11 | `src/core/ports/db/IInventoryReservationRepository.ts` | ⏳ 待开始 | ~80 | 库存预留/乐观锁 |

### 1.2 Supabase 实现
| # | 文件 | 状态 | 预估行数 | 依赖 |
|---|------|------|---------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseLocationRepository.ts` | ⏳ 待开始 | ~180 | ILocationRepository |
| 2 | `src/adapters/supabase/repositories/SupabaseContainerRepository.ts` | ⏳ 待开始 | ~160 | IContainerRepository |
| 3 | `src/adapters/supabase/repositories/SupabaseInboundReceiptRepository.ts` | ⏳ 待开始 | ~220 | IInboundReceiptRepository |
| 4 | `src/adapters/supabase/repositories/SupabaseWaveRepository.ts` | ⏳ 待开始 | ~200 | IWaveRepository |
| 5 | `src/adapters/supabase/repositories/SupabaseCrossDockJobRepository.ts` | ⏳ 待开始 | ~180 | ICrossDockJobRepository |
| 6 | `src/adapters/supabase/repositories/SupabasePackingTaskRepository.ts` | ⏳ 待开始 | ~180 | IPackingTaskRepository |
| 7 | `src/adapters/supabase/repositories/SupabaseSortingTaskRepository.ts` | ⏳ 待开始 | ~200 | ISortingTaskRepository |
| 8 | `src/adapters/supabase/repositories/SupabaseLoadingTaskRepository.ts` | ⏳ 待开始 | ~160 | ILoadingTaskRepository |
| 9 | `src/adapters/supabase/repositories/SupabaseDeviceRepository.ts` | ⏳ 待开始 | ~160 | IDeviceRepository |
| 10 | `src/adapters/supabase/repositories/SupabaseInventoryLockRepository.ts` | ⏳ 待开始 | ~160 | IInventoryLockRepository |
| 11 | `src/adapters/supabase/repositories/SupabaseInventoryReservationRepository.ts` | ⏳ 待开始 | ~180 | IInventoryReservationRepository |

### 1.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 11 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 11 个新实现

### 1.4 验收
- [ ] `npx tsc --noEmit` 零错误
- [ ] 每个实现 `implements` 对应接口编译通过

---

## Phase 3: P1 业务扩展（8个） - 次优先级

### 3.1 端口定义
| # | 文件 | 状态 | 预估行数 |
|---|------|------|---------|
| 1 | `src/core/ports/db/IShippingDocumentRepository.ts` | ⏳ 待开始 | ~80 |
| 2 | `src/core/ports/db/IVehicleRepository.ts` | ⏳ 待开始 | ~70 |
| 3 | `src/core/ports/db/IBillingRuleRepository.ts` | ⏳ 待开始 | ~80 |
| 4 | `src/core/ports/db/IBillingTransactionRepository.ts` | ⏳ 待开始 | ~70 |
| 5 | `src/core/ports/db/IUserRepository.ts` | ⏳ 待开始 | ~90 |
| 6 | `src/core/ports/db/IRoleRepository.ts` | ⏳ 待开始 | ~80 |
| 7 | `src/core/ports/db/IAsnRepository.ts` | ⏳ 待开始 | ~90 |
| 8 | `src/core/ports/db/IConsumableUsageRepository.ts` | ⏳ 待开始 | ~70 |

### 3.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseShippingDocumentRepository.ts` | ⏳ 待开始 |
| 2 | `src/adapters/supabase/repositories/SupabaseVehicleRepository.ts` | ⏳ 待开始 |
| 3 | `src/adapters/supabase/repositories/SupabaseBillingRuleRepository.ts` | ⏳ 待开始 |
| 4 | `src/adapters/supabase/repositories/SupabaseBillingTransactionRepository.ts` | ⏳ 待开始 |
| 5 | `src/adapters/supabase/repositories/SupabaseUserRepository.ts` | ⏳ 待开始 |
| 6 | `src/adapters/supabase/repositories/SupabaseRoleRepository.ts` | ⏳ 待开始 |
| 7 | `src/adapters/supabase/repositories/SupabaseAsnRepository.ts` | ⏳ 待开始 |
| 8 | `src/adapters/supabase/repositories/SupabaseConsumableUsageRepository.ts` | ⏳ 待开始 |

### 3.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 8 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 8 个新实现

---

## Phase 4: P2 支撑域（6个） - 最后实施

### 4.1 端口定义
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/core/ports/db/IQualityInspectionRepository.ts` | ⏳ 待开始 |
| 2 | `src/core/ports/db/IVasBomRepository.ts` | ⏳ 待开始 |
| 3 | `src/core/ports/db/IVerificationRuleRepository.ts` | ⏳ 待开始 |
| 4 | `src/core/ports/db/ILabelTemplateRepository.ts` | ⏳ 待开始 |
| 5 | `src/core/ports/db/IInventoryHistoryRepository.ts` | ⏳ 待开始 |
| 6 | `src/core/ports/db/IPackageSpecRepository.ts` | ⏳ 待开始 |

### 4.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseQualityInspectionRepository.ts` | ⏳ 待开始 |
| 2 | `src/adapters/supabase/repositories/SupabaseVasBomRepository.ts` | ⏳ 待开始 |
| 3 | `src/adapters/supabase/repositories/SupabaseVerificationRuleRepository.ts` | ⏳ 待开始 |
| 4 | `src/adapters/supabase/repositories/SupabaseLabelTemplateRepository.ts` | ⏳ 待开始 |
| 5 | `src/adapters/supabase/repositories/SupabaseInventoryHistoryRepository.ts` | ⏳ 待开始 |
| 6 | `src/adapters/supabase/repositories/SupabasePackageSpecRepository.ts` | ⏳ 待开始 |

### 4.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 6 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 6 个新实现

---

## Phase 5: 离线同步 / 统一异常领域仓储（5个） - P0 同步配套（2026-07-15 按 ADR-011 重写，替代原 PDA 同步专用仓储规划）

> 对应表见 `docs/03-database/DB_SCHEMA.md` §2.10-2.14；对应 RPC 封装见同文档 §4。执行本 Phase 前需先完成 Phase 0（止血现有 RPC→Repository 重构，详见 `docs/00-project/ROADMAP.md` 离线同步方案对齐记录）与迁移脚本落地（Phase 1）。

### 5.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/ITaskClaimRepository.ts` | ⏳ 待开始 | ~90 | 竞争性任务租约：封装 `fn_claim_task`/`fn_release_task_claim`/`fn_expire_task_claims` |
| 2 | `src/core/ports/db/ISyncPolicyRepository.ts` | ⏳ 待开始 | ~60 | 离线策略配置：封装 `fn_get_sync_policy`，CRUD `sync_policies` |
| 3 | `src/core/ports/db/IDeviceSyncStateRepository.ts` | ⏳ 待开始 | ~60 | 设备同步状态：`device_sync_state` 读写 |
| 4 | `src/core/ports/db/ISyncEventRepository.ts` | ⏳ 待开始 | ~100 | 同步事件收件箱：`sync_events` 写入 + 封装 `fn_apply_sync_event`/`fn_apply_pick_action` |
| 5 | `src/core/ports/db/IExceptionRepository.ts` | ⏳ 待开始 | ~110 | 统一异常领域：`exception_type_catalog`/`exceptions`/`exception_events`，封装 `fn_raise_exception`/`fn_resolve_exception`/`fn_confirm_inventory_recount` |

### 5.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseTaskClaimRepository.ts` | ⏳ 待开始 |
| 2 | `src/adapters/supabase/repositories/SupabaseSyncPolicyRepository.ts` | ⏳ 待开始 |
| 3 | `src/adapters/supabase/repositories/SupabaseDeviceSyncStateRepository.ts` | ⏳ 待开始 |
| 4 | `src/adapters/supabase/repositories/SupabaseSyncEventRepository.ts` | ⏳ 待开始 |
| 5 | `src/adapters/supabase/repositories/SupabaseExceptionRepository.ts` | ⏳ 待开始 |

### 5.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 5 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 5 个新实现

---

## Phase 6: Layer 3 同步动作扩展仓储（2个） - P0 同步配套（Layer 3：PUTAWAY/COUNT/PACK）

> 对应表见 `docs/03-database/DB_SCHEMA.md` §2.15-2.16（`packing_task_items`、`inventory_count_policies`）；对应函数见同文档 §4（`fn_adjust_inventory_at_location`、`fn_reconcile_location_count`、`fn_apply_putaway_action`、`fn_apply_count_action`、`fn_apply_pack_action`）。执行本 Phase 前需先完成 Phase 0（止血现有 RPC→Repository 重构）与迁移脚本落地（Phase 1-2）。

### 6.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/IPackingTaskItemRepository.ts` | ⏳ 待开始 | ~80 | 打包明细：CRUD + 双局部唯一索引去重（有箱/无箱）+ 完成时联动更新 `order_lines`/`packing_tasks` |
| 2 | `src/core/ports/db/IInventoryAdjustRepository.ts` | ⏳ 待开始 | ~100 | 库存原子原语：封装 `fn_adjust_inventory_at_location`/`fn_reconcile_location_count` + 盘点容差策略 `inventory_count_policies` CRUD |

### 6.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabasePackingTaskItemRepository.ts` | ⏳ 待开始 |
| 2 | `src/adapters/supabase/repositories/SupabaseInventoryAdjustRepository.ts` | ⏳ 待开始 |

### 6.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 2 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 2 个新实现

---

## Phase 7: Layer 4 追踪策略 / 无码货物仓储（3个） - P0 同步配套（Layer 4：追踪策略 + MISSING_LABEL + UNIDENTIFIED_GOODS）

> 对应表见 `docs/03-database/DB_SCHEMA.md` §2.17（`tenant_tracking_policies`）；对应函数见同文档 §4（`fn_generate_internal_lpn`、`fn_confirm_label_applied`、`fn_identify_unidentified_goods`、`fn_receive_unidentified_goods`、`fn_requires_unique_tracking`、合规触发器扩展）。执行本 Phase 前需先完成 Phase 0-3。

### 7.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/ITrackingPolicyRepository.ts` | ⏳ 待开始 | ~90 | 追踪策略：封装 `fn_requires_unique_tracking`（三层解析）+ CRUD `tenant_tracking_policies` |
| 2 | `src/core/ports/db/IMissingLabelRepository.ts` | ⏳ 待开始 | ~80 | MISSING_LABEL：封装 `fn_generate_internal_lpn`/`fn_confirm_label_applied`，内部码生成/确认/挂载容器/关异常 |
| 3 | `src/core/ports/db/IUnidentifiedGoodsRepository.ts` | ⏳ 待开始 | ~80 | UNIDENTIFIED_GOODS：封装 `fn_receive_unidentified_goods`/`fn_identify_unidentified_goods`，回填 product_id 触发合规复查 |

### 7.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseTrackingPolicyRepository.ts` | ⏳ 待开始 |
| 2 | `src/adapters/supabase/repositories/SupabaseMissingLabelRepository.ts` | ⏳ 待开始 |
| 3 | `src/adapters/supabase/repositories/SupabaseUnidentifiedGoodsRepository.ts` | ⏳ 待开始 |

### 7.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 3 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 3 个新实现

---

## 总计统计

| 阶段 | 端口数 | 实现数 | 总文件数 | 预估代码行数 |
|------|--------|--------|----------|-------------|
| Phase 1 (P0 核心) | 11 | 11 | 22 | ~2,200 |
| Phase 2 (P0 出库作业) | 8 | 8 | 16 | ~1,800 |
| Phase 3 (P1 业务扩展) | 8 | 8 | 16 | ~1,600 |
| Phase 4 (P2 支撑域) | 6 | 6 | 12 | ~1,200 |
| Phase 5 (离线同步/异常领域) | 5 | 5 | 10 | ~1,050 |
| Phase 6 (Layer 3 同步动作) | 2 | 2 | 4 | ~600 |
| Phase 7 (Layer 4 追踪策略/无码货物) | 3 | 3 | 6 | ~900 |
| **合计** | **43** | **43** | **86** | **~9,350** |

---

## 执行规则

### 每个文件创建流程
1. **先写 Port 接口** - 放入 `src/core/ports/db/`
2. **再写 Supabase 实现** - 放入 `src/adapters/supabase/repositories/`
3. **更新索引文件** - 两个 index.ts 同步导出
4. **运行类型检查** - `npx tsc --noEmit` 必须通过

### 代码质量标准
- 严格使用 `Tables<'table'>` 类型，禁用 `any`
- 继承 `SupabaseBaseRepository` 复用 CRUD
- 业务方法命名遵循设计文档规范
- 租户隔离：查询默认带 `tenant_id`，显式 opt-out 才用 admin client
- 乐观锁方法统一用基类 `updateWithOptimisticLock`

### 提交策略
- Phase 1 完成后统一提交
- Phase 2 完成后统一提交  
- Phase 3 完成后统一提交

---

## 里程碑检查点

| 里程碑 | 标准 | 预计时间 |
|--------|------|----------|
| M1: P0 端口定义完成 | 11 个 .ts 文件，tsc 通过 | - |
| M2: P0 实现完成 | 11 个实现，tsc 通过，索引更新 | - |
| M3: P1 端口定义完成 | 8 个 .ts 文件，tsc 通过 | - |
| M4: P1 实现完成 | 8 个实现，tsc 通过，索引更新 | - |
| M5: P2 端口定义完成 | 6 个 .ts 文件，tsc 通过 | - |
| M6: P2 实现完成 | 6 个实现，tsc 通过，全量编译通过 | - |
| M7: Phase 5 端口定义完成 | 5 个 .ts 文件，tsc 通过 | - |
| M8: Phase 5 实现完成 | 5 个实现，tsc 通过，索引更新 | - |
| M9: Phase 6 端口定义完成 | 2 个 .ts 文件，tsc 通过 | - |
| M10: Phase 6 实现完成 | 2 个实现，tsc 通过，索引更新 | - |
| M11: Phase 7 端口定义完成 | 3 个 .ts 文件，tsc 通过 | - |
| M12: Phase 7 实现完成 | 3 个实现，tsc 通过，全量编译通过 | - |

---

*创建时间：2025-07-10*
*状态：待开始 Phase 1*
*最近更新：2026-07-15 — Phase 5 按 ADR-011（离线同步操作日志+统一异常领域）整体重写*