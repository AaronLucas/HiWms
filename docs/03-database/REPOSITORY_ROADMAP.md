# 仓储层实施路线图

## 项目概览
- **总表数**：34 个业务表 + 6 个 PDA 本地表
- **聚合根数**：30 个
- **已完成**：13 个（Phase 1 全部完成）
- **待完成**：25 个
- **分 4 个优先级阶段实施**

---

## Phase 1: P0 核心聚合根（11个） - **已完成 ✅**

### 1.1 端口定义
| # | 文件 | 状态 | 预估行数 | 备注 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/ILocationRepository.ts` | ✅ **已完成** | ~80 | 库位管理核心 |
| 2 | `src/core/ports/db/IContainerRepository.ts` | ✅ **已完成** | ~70 | 容器/LPN管理 |
| 3 | `src/core/ports/db/IInboundReceiptRepository.ts` | ✅ **已完成** | ~100 | 入库单+质检项 |
| 4 | `src/core/ports/db/IWaveRepository.ts` | ✅ **已完成** | ~90 | 波次+订单映射 |
| 5 | `src/core/ports/db/ICrossDockJobRepository.ts` | ✅ **已完成** | ~80 | 交叉理货 |
| 6 | `src/core/ports/db/IPackingTaskRepository.ts` | ✅ **已完成** | ~80 | 打包任务 |
| 7 | `src/core/ports/db/ISortingTaskRepository.ts` | ✅ **已完成** | ~90 | 分拣任务+滑道 |
| 8 | `src/core/ports/db/ILoadingTaskRepository.ts` | ✅ **已完成** | ~70 | 装车任务 |
| 9 | `src/core/ports/db/IDeviceRepository.ts` | ✅ **已完成** | ~70 | PDA/设备管理 |
| 10 | `src/core/ports/db/IInventoryLockRepository.ts` | ✅ **已完成** | ~70 | 库存悲观锁 |
| 11 | `src/core/ports/db/IInventoryReservationRepository.ts` | ✅ **已完成** | ~80 | 库存预留/乐观锁 |
| 12 | `src/core/ports/db/IProductConstraintRepository.ts` | ✅ **已完成** | ~80 | 物料约束 (CLEANUP 提前完成) |
| 13 | `src/core/ports/db/IRoleRepository.ts` | ✅ **已完成** | ~80 | 角色管理 (CLEANUP 提前完成) |

### 1.2 Supabase 实现
| # | 文件 | 状态 | 预估行数 | 依赖 |
|---|------|------|---------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseLocationRepository.ts` | ✅ **已完成** | ~180 | ILocationRepository |
| 2 | `src/adapters/supabase/repositories/SupabaseContainerRepository.ts` | ✅ **已完成** | ~160 | IContainerRepository |
| 3 | `src/adapters/supabase/repositories/SupabaseInboundReceiptRepository.ts` | ✅ **已完成** | ~220 | IInboundReceiptRepository |
| 4 | `src/adapters/supabase/repositories/SupabaseWaveRepository.ts` | ✅ **已完成** | ~200 | IWaveRepository |
| 5 | `src/adapters/supabase/repositories/SupabaseCrossDockJobRepository.ts` | ✅ **已完成** | ~180 | ICrossDockJobRepository |
| 6 | `src/adapters/supabase/repositories/SupabasePackingTaskRepository.ts` | ✅ **已完成** | ~180 | IPackingTaskRepository |
| 7 | `src/adapters/supabase/repositories/SupabaseSortingTaskRepository.ts` | ✅ **已完成** | ~200 | ISortingTaskRepository |
| 8 | `src/adapters/supabase/repositories/SupabaseLoadingTaskRepository.ts` | ✅ **已完成** | ~160 | ILoadingTaskRepository |
| 7 | `src/adapters/supabase/repositories/SupabaseDeviceRepository.ts` | ✅ **已完成** | ~160 | IDeviceRepository |
| 8 | `src/adapters/supabase/repositories/SupabaseInventoryLockRepository.ts` | ✅ **已完成** | ~160 | IInventoryLockRepository |
| 9 | `src/adapters/supabase/repositories/SupabaseInventoryReservationRepository.ts` | ✅ **已完成** | ~180 | IInventoryReservationRepository |
| 10 | `src/adapters/supabase/repositories/SupabaseProductConstraintRepository.ts` | ✅ **已完成** | ~180 | IProductConstraintRepository (CLEANUP 提前完成) |
| 11 | `src/adapters/supabase/repositories/SupabaseRoleRepository.ts` | ✅ **已完成** | ~160 | IRoleRepository (CLEANUP 提前完成) |

### 1.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 11 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 11 个新实现

### 1.4 验收
- [x] `npx tsc --noEmit` 零错误
- [x] 每个实现 `implements` 对应接口编译通过

---

## Phase 3: P1 业务扩展（6个） - 次优先级

### 3.1 端口定义
| # | 文件 | 状态 | 预估行数 |
|---|------|------|---------|
| 1 | `src/core/ports/db/IShippingDocumentRepository.ts` | ⏳ 待开始 | ~80 |
| 2 | `src/core/ports/db/IVehicleRepository.ts` | ⏳ 待开始 | ~70 |
| 3 | `src/core/ports/db/IBillingRuleRepository.ts` | ⏳ 待开始 | ~80 |
| 4 | `src/core/ports/db/IBillingTransactionRepository.ts` | ⏳ 待开始 | ~70 |
| 5 | `src/core/ports/db/IUserRepository.ts` | ⏳ 待开始 | ~90 |
| 6 | `src/core/ports/db/IAsnRepository.ts` | ⏳ 待开始 | ~90 |
| 7 | `src/core/ports/db/IConsumableUsageRepository.ts` | ⏳ 待开始 | ~70 |

### 3.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseShippingDocumentRepository.ts` | ⏳ 待开始 |
| 2 | `src/adapters/supabase/repositories/SupabaseVehicleRepository.ts` | ⏳ 待开始 |
| 3 | `src/adapters/supabase/repositories/SupabaseBillingRuleRepository.ts` | ⏳ 待开始 |
| 4 | `src/adapters/supabase/repositories/SupabaseBillingTransactionRepository.ts` | ⏳ 待开始 |
| 5 | `src/adapters/supabase/repositories/SupabaseUserRepository.ts` | ⏳ 待开始 |
| 6 | `src/adapters/supabase/repositories/SupabaseAsnRepository.ts` | ⏳ 待开始 |
| 7 | `src/adapters/supabase/repositories/SupabaseConsumableUsageRepository.ts` | ⏳ 待开始 |

### 3.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 7 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 7 个新实现

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

## Phase 5: PDA 离线同步专用仓储（6个） - P0 同步配套

### 5.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/ISyncQueueRepository.ts` | ⏳ 待开始 | ~100 | 同步队列核心操作 |
| 2 | `src/core/ports/db/ISyncSessionRepository.ts` | ⏳ 待开始 | ~70 | 同步会话管理 |
| 3 | `src/core/ports/db/ISyncConflictRepository.ts` | ⏳ 待开始 | ~90 | 冲突持久化与查询 |
| 4 | `src/core/ports/db/ISyncCursorRepository.ts` | ⏳ 待开始 | ~60 | 增量同步游标 |
| 5 | `src/core/ports/db/IPendingUploadRepository.ts` | ⏳ 待开始 | ~80 | 待上传文件记录 |
| 6 | `src/core/ports/db/IDeviceStateRepository.ts` | ⏳ 待开始 | ~70 | 设备心跳/状态 |

### 5.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseSyncQueueRepository.ts` | ⏳ 待开始 |
| 2 | `src/adapters/supabase/repositories/SupabaseSyncSessionRepository.ts` | ⏳ 待开始 |
| 3 | `src/adapters/supabase/repositories/SupabaseSyncConflictRepository.ts` | ⏳ 待开始 |
| 4 | `src/adapters/supabase/repositories/SupabaseSyncCursorRepository.ts` | ⏳ 待开始 |
| 5 | `src/adapters/supabase/repositories/SupabasePendingUploadRepository.ts` | ⏳ 待开始 |
| 6 | `src/adapters/supabase/repositories/SupabaseDeviceStateRepository.ts` | ⏳ 待开始 |

### 5.3 索引更新
- [ ] `src/core/ports/db/index.ts` - 导出 6 个新端口
- [ ] `src/adapters/supabase/repositories/index.ts` - 导出 6 个新实现

---

## 总计统计

| 阶段 | 端口数 | 实现数 | 总文件数 | 预估代码行数 |
|------|--------|--------|----------|-------------|
| Phase 1 (P0 核心) | 13 | 13 | 26 | ~2,600 |
| Phase 2 (P0 出库作业) | 8 | 8 | 16 | ~1,800 |
| Phase 3 (P1 业务扩展) | 7 | 7 | 14 | ~1,400 |
| Phase 4 (P2 支撑域) | 6 | 6 | 12 | ~1,200 |
| Phase 5 (PDA 同步专用) | 6 | 6 | 12 | ~1,500 |
| **合计** | **40** | **40** | **80** | **~8,500** |

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

---

*创建时间：2025-07-10*
*状态：待开始 Phase 1*