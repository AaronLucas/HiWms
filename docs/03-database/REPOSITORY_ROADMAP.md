# 仓储层实施路线图

## 项目概览
- **总表数**：34 个业务表 + 7 个 Layer 2 离线同步/统一异常领域表 + 2 个 Layer 3 同步动作扩展表 + 1 个 Layer 4 追踪策略表
- **聚合根数**：43 个
- **已完成**：5 个（Phase 1/3/4 核心域，已在 `origin/main` 落地）
- **待完成**：38 个（Phase 5/6/7 全部待开始）
- **分 7 个优先级阶段实施**

> **2026-07-15 更新说明**：Phase 5 已按 DBA 新方案（操作同步 + 预分工 + 统一异常领域，见 ADR-011）整体替换——原规划的 `SyncQueue`/`SyncSession`/`SyncConflict`/`SyncCursor`/`PendingUpload`/`DeviceState` 6 个仓储对应的是旧版状态同步设计，其表名/职责与新方案的 `task_claims`/`sync_policies`/`device_sync_state`/`sync_events`/`exceptions` 完全不匹配，已废弃。
>
> **2026-07-16 更新说明（已核实，非推测）**：直接核对 `origin/main` 实际代码后确认：Phase 1/3/4（核心域仓储）已完整实现且 `npx tsc --noEmit` 零错误——此前记录的"文档滞后"提示已解决。但 **Phase 5（Layer 2 离线同步/异常领域仓储）目前 100% 未实现**——`src/types/database.ts` 里虽已有 Layer 2 的 7 张表类型，但 `src/core/ports/db/`、`src/adapters/supabase/repositories/` 里没有任何一个对应端口或实现，也没有任何设备端路由（代码库目前只有 `src/apps/admin-api`）。新增 **Phase 6（Layer 3 同步动作扩展仓储）与 Phase 7（Layer 4 唯一追踪策略仓储）**，二者在 `database.ts` 里连表类型都不存在（尚未迁移），是比 Phase 5 更前置的空白。

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

> **状态语义三档说明（2026-07-18，ECC 治理试点第 5 项，见 `docs/06-agents/AGENTS.md` §8.5 第 5 步）**：`⏳ 待开始`（代码未写）/ `🔨 已实现未验证`（`tsc` 通过、可编译运行，但没有自动化测试覆盖业务逻辑正确性）/ `✅ 已完成`（前两者之上，附带可运行的测试证据路径）。**Phase 5/6/7 全部 20 个仓储文件（10 端口 + 10 实现）此前标记为"✅ 已完成"，经核查 `src/__tests__/` 下没有任何一个文件的测试覆盖这些仓储，不符合新标准，已回溯下调为"🔨 已实现未验证"**——这不代表代码本身有问题（`npx tsc --noEmit` 仍为零错误，Device API 路由也确实在调用它们），只是此前"已完成"的判定标准里没有测试证据这一环，现在按新标准如实标注。**团队通知**：本仓库当前唯一协作者为项目负责人本人（`gh api repos/.../collaborators` 核实），若另有仓库外的团队成员需要知晓此次状态调整以避免误判为功能倒退，通知内容由项目负责人自行决定是否发送，不在本次变更中代为发出。

> 对应表见 `docs/03-database/DB_SCHEMA.md` §2.10-2.14；对应 RPC 封装见同文档 §4。**Phase 0（止血现有 RPC→Repository 重构）已由其他并行工作解决**（`origin/main` `ac3da7a`，`npx tsc --noEmit` 现为零错误），不再是阻塞项。**2026-07-18 更新：迁移脚本落地（Phase 1）已由 DBA 团队部署到生产环境确认，本 Phase 代码已实现但测试证据缺失（见上方状态语义说明）。**

### 5.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/ITaskClaimRepository.ts` | 🔨 已实现未验证 | ~90 | 竞争性任务租约：封装 `fn_claim_task`/`fn_release_task_claim`/`fn_expire_task_claims` |
| 2 | `src/core/ports/db/ISyncPolicyRepository.ts` | 🔨 已实现未验证 | ~60 | 离线策略配置：封装 `fn_get_sync_policy`，CRUD `sync_policies` |
| 3 | `src/core/ports/db/IDeviceSyncStateRepository.ts` | 🔨 已实现未验证 | ~60 | 设备同步状态：`device_sync_state` 读写 |
| 4 | `src/core/ports/db/ISyncEventRepository.ts` | 🔨 已实现未验证 | ~100 | 同步事件收件箱：`sync_events` 写入 + 封装 `fn_apply_sync_event`/`fn_apply_pick_action` |
| 5 | `src/core/ports/db/IExceptionRepository.ts` | 🔨 已实现未验证 | ~110 | 统一异常领域：`exception_type_catalog`/`exceptions`/`exception_events`，封装 `fn_raise_exception`/`fn_resolve_exception`/`fn_confirm_inventory_recount` |

### 5.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseTaskClaimRepository.ts` | 🔨 已实现未验证 |
| 2 | `src/adapters/supabase/repositories/SupabaseSyncPolicyRepository.ts` | 🔨 已实现未验证 |
| 3 | `src/adapters/supabase/repositories/SupabaseDeviceSyncStateRepository.ts` | 🔨 已实现未验证 |
| 4 | `src/adapters/supabase/repositories/SupabaseSyncEventRepository.ts` | 🔨 已实现未验证 |
| 5 | `src/adapters/supabase/repositories/SupabaseExceptionRepository.ts` | 🔨 已实现未验证 |

### 5.3 索引更新
- [x] `src/core/ports/db/index.ts` - 导出 5 个新端口
- [x] `src/adapters/supabase/repositories/index.ts` - 导出 5 个新实现

---

## Phase 6: 同步动作扩展仓储（2个）- Layer 3 配套（2026-07-16 新增，ADR-013）

> 对应表见 `docs/03-database/DB_SCHEMA.md` §2.15-2.16；对应 RPC 封装见同文档 §4。**2026-07-18 更新：Layer 3 迁移脚本已由 DBA 团队修正并部署到生产环境**（本地 `003_extend_sync_event_actions.sql` 经 `diff` 核对与 `.readonly/` 参考文件逐字节一致），本 Phase 代码已实现但测试证据缺失（状态语义说明见 Phase 5 顶部）。

### 6.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/IInventoryCountPolicyRepository.ts` | 🔨 已实现未验证 | ~60 | 盘点容差策略：CRUD `inventory_count_policies`，封装 `fn_get_count_tolerance` |
| 2 | `src/core/ports/db/IPackingTaskItemRepository.ts` | 🔨 已实现未验证 | ~80 | 打包明细行：`packing_task_items` CRUD、同箱/同码去重逻辑 |

### 6.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseInventoryCountPolicyRepository.ts` | 🔨 已实现未验证 |
| 2 | `src/adapters/supabase/repositories/SupabasePackingTaskItemRepository.ts` | 🔨 已实现未验证 |

### 6.3 索引更新
- [x] `src/core/ports/db/index.ts` - 导出 2 个新端口
- [x] `src/adapters/supabase/repositories/index.ts` - 导出 2 个新实现

---

## Phase 7: 唯一追踪策略仓储（3个）- Layer 4 配套（2026-07-16 新增，ADR-014）

> 对应表见 `docs/03-database/DB_SCHEMA.md` §2.17；对应 RPC 封装见同文档 §4。**2026-07-18 更新：Layer 4 迁移脚本已由 DBA 团队起草并部署到生产环境**（本地 `004_tracking_policy_missing_label.sql` 经 `diff` 核对与 `.readonly/` 参考文件逐字节一致，部署顺序严格排在 Layer 3 之后），本 Phase 代码已实现但测试证据缺失（状态语义说明见 Phase 5 顶部）。

### 7.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/ITenantTrackingPolicyRepository.ts` | 🔨 已实现未验证 | ~70 | 租户追踪策略：CRUD `tenant_tracking_policies`，封装 `fn_requires_unique_tracking`/`fn_get_tenant_abc_tracking_default` |
| 2 | `src/core/ports/db/IMissingLabelRepository.ts` | 🔨 已实现未验证 | ~70 | 漏码闭环：封装 `fn_generate_internal_lpn`/`fn_confirm_label_applied` |
| 3 | `src/core/ports/db/IUnidentifiedGoodsRepository.ts` | 🔨 已实现未验证 | ~70 | 未识别货物闭环：封装 `fn_receive_unidentified_goods`/`fn_identify_unidentified_goods` |

### 7.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseTenantTrackingPolicyRepository.ts` | 🔨 已实现未验证 |
| 2 | `src/adapters/supabase/repositories/SupabaseMissingLabelRepository.ts` | 🔨 已实现未验证 |
| 3 | `src/adapters/supabase/repositories/SupabaseUnidentifiedGoodsRepository.ts` | 🔨 已实现未验证 |

### 7.3 索引更新
- [x] `src/core/ports/db/index.ts` - 导出 3 个新端口
- [x] `src/adapters/supabase/repositories/index.ts` - 导出 3 个新实现

---

## 总计统计

| 阶段 | 端口数 | 实现数 | 总文件数 | 预估代码行数 |
|------|--------|--------|----------|-------------|
| Phase 1 (P0 核心) | 11 | 11 | 22 | ~2,200 |
| Phase 2 (P0 出库作业) | 8 | 8 | 16 | ~1,800 |
| Phase 3 (P1 业务扩展) | 8 | 8 | 16 | ~1,600 |
| Phase 4 (P2 支撑域) | 6 | 6 | 12 | ~1,200 |
| Phase 5 (离线同步/异常领域) | 5 | 5 | 10 | ~1,050 |
| Phase 6 (同步动作扩展，Layer 3) | 2 | 2 | 4 | ~280 |
| Phase 7 (唯一追踪策略，Layer 4) | 3 | 3 | 6 | ~420 |
| **合计** | **43** | **43** | **86** | **~8,550** |

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
*状态：Phase 1/3/4 共 25 个端口+25 个实现已完成（含测试覆盖，已在 origin/main 核实）；Phase 5/6/7 共 10 个端口+10 个实现代码已落地、`tsc` 零错误、`device-api` 全部路由已接入，但按 ECC 治理标准回溯核查后测试证据缺失，已下调为「🔨 已实现未验证」（2026-07-18，见 Phase 5 顶部状态语义说明）*
*最近更新：2026-07-18 — ECC 治理试点第 5 项：状态语义升级为三档（⏳/🔨/✅），回溯下调 Phase 5/6/7 的 20 个「✅ 已完成」标记为「🔨 已实现未验证」（代码本身未变，`tsc`/生产部署状态不受影响，仅补测试证据要求）*