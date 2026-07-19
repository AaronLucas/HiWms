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
| 1 | `src/core/ports/db/ITaskClaimRepository.ts` | ✅ 已完成 | ~90 | 竞争性任务租约：封装 `fn_claim_task`/`fn_release_task_claim`/`fn_expire_task_claims`。测试证据：`src/__tests__/integration/tasks/fn_claim_task.concurrency.test.ts`（2026-07-19） |
| 2 | `src/core/ports/db/ISyncPolicyRepository.ts` | ✅ 已完成 | ~60 | 离线策略配置：封装 `fn_get_sync_policy`，CRUD `sync_policies`。测试证据：`src/__tests__/integration/sync/fn_get_sync_policy.concurrency.test.ts`（2026-07-19）。**测试过程中发现并修复真实生产 bug**：`GET /sync/policy` 响应字段此前是 camelCase 且含 3 个 SQL 端不存在的硬编码字段，与 `SYNC_API_CONTRACT.md` §5.2 文档契约（snake_case，仅 2 字段）不符，冷链/危化品强制在线判定字段 `offline_mode` 实际永远读不到，详见 P1 第 2 项执行记录 |
| 3 | `src/core/ports/db/IDeviceSyncStateRepository.ts` | 🔨 已实现未验证 | ~60 | 设备同步状态：`device_sync_state` 读写 |
| 4 | `src/core/ports/db/ISyncEventRepository.ts` | ✅ 已完成 | ~100 | 同步事件收件箱：`sync_events` 写入 + 封装 `fn_apply_sync_event`/`fn_apply_pick_action`。测试证据：`src/__tests__/integration/sync/fn_apply_sync_event.concurrency.test.ts`（2026-07-19，2026-07-19 更新为回归测试）。曾有的 2 项已知问题（Bug A 并发重复扣库存、Bug E 未知 action_type 不登记异常）已由 DBA `005_concurrency_hardening_V1.sql` 修复，本地应用该迁移后连续多轮重跑验证稳定通过，详见 `BUG_REPORT_SYNC_EVENT_APPLY_FUNCTIONS_2026-07-19.md` 及 P0 第 2 项执行记录 |
| 5 | `src/core/ports/db/IExceptionRepository.ts` | ✅ 已完成 | ~110 | 统一异常领域：`exception_type_catalog`/`exceptions`/`exception_events`，封装 `fn_raise_exception`/`fn_resolve_exception`/`fn_confirm_inventory_recount`。测试证据：`src/__tests__/integration/exceptions/fn_resolve_exception.concurrency.test.ts`（2026-07-19）。**2026-07-19 核对 DBA 的 `005_concurrency_hardening_V1.sql` 时顺带发现并修复 4 处缺陷**：（1）`ExceptionStatus` 类型（`OPEN/INVESTIGATING/RESOLVED/CLOSED/ESCALATED`）与 `exceptions.status` 真实 `chk_exceptions_status` CHECK 约束（`PENDING_REVIEW/CONFLICT/RESOLVED/DISMISSED`）几乎完全对不上，同 SyncEventStatus 的 Bug D 一类问题，已改为与真实约束一致；（2）`escalateException()` 写入不合法的 `'ESCALATED'`，已改为约束里真实存在的 `CONFLICT`（对应设计文档"升级"语义），并补了"已 RESOLVED/DISMISSED 不可再升级"的防护；（3）`resolveException()` 硬编码的 `p_resolution_details` 永远不含 `fn_confirm_inventory_recount` 需要的 `confirmed_available_qty`，导致 INVENTORY_SHORTAGE 异常"确认解决"后库存从未被真正修正（DBA 自查清单第 8 条点名的"函数返回成功但业务表没联动"），已开放 `resolutionDetails` 透传；（4）`confirmInventoryRecount()` 之前绕开 `fn_resolve_exception` 直接调用底层函数（跳过权限校验/状态转移/审计轨迹），且 JSON key 用的是 `recount_qty` 而不是函数实际读取的 `confirmed_available_qty`，双重原因导致库存不会被调整，已改为委托给 `resolveException()`；（5）`recordEvent()` 写入不存在的 `description` 列（真实列名 `note`），导致每次调用必定报错，连带 `escalateException()` 失败，已修正列名 |

### 5.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseTaskClaimRepository.ts` | ✅ 已完成 |
| 2 | `src/adapters/supabase/repositories/SupabaseSyncPolicyRepository.ts` | ✅ 已完成（同上，见 5.1 第 2 行说明） |
| 3 | `src/adapters/supabase/repositories/SupabaseDeviceSyncStateRepository.ts` | 🔨 已实现未验证 |
| 4 | `src/adapters/supabase/repositories/SupabaseSyncEventRepository.ts` | ✅ 已完成（同上，见 5.1 第 4 行说明） |
| 5 | `src/adapters/supabase/repositories/SupabaseExceptionRepository.ts` | ✅ 已完成（同上，见 5.1 第 5 行说明） |

### 5.3 索引更新
- [x] `src/core/ports/db/index.ts` - 导出 5 个新端口
- [x] `src/adapters/supabase/repositories/index.ts` - 导出 5 个新实现

---

## Phase 6: 同步动作扩展仓储（2个）- Layer 3 配套（2026-07-16 新增，ADR-013）

> 对应表见 `docs/03-database/DB_SCHEMA.md` §2.15-2.16；对应 RPC 封装见同文档 §4。**2026-07-18 更新：Layer 3 迁移脚本已由 DBA 团队修正并部署到生产环境**（本地 `003_extend_sync_event_actions.sql` 经 `diff` 核对与 `.readonly/` 参考文件逐字节一致），本 Phase 代码已实现但测试证据缺失（状态语义说明见 Phase 5 顶部）。

### 6.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/IInventoryCountPolicyRepository.ts` | ✅ 已完成 | ~60 | 盘点容差策略：CRUD `inventory_count_policies`，封装 `fn_get_count_tolerance`。测试证据：`src/__tests__/integration/inventory/fn_get_count_tolerance.concurrency.test.ts`（2026-07-19）。**测试过程中发现并修复真实 bug**：`upsertBatch`/`upsertPolicy` 用 PostgREST `onConflict` 定位一个只有局部唯一索引、没有普通唯一约束的组合，每次调用必定报 `42P10`，详见 P2 第 1 项执行记录 |
| 2 | `src/core/ports/db/IPackingTaskItemRepository.ts` | ✅ 已完成 | ~80 | 打包明细行：`packing_task_items` CRUD、同箱/同码去重逻辑。测试证据：`src/__tests__/integration/packing/fn_apply_pack_action.concurrency.test.ts`（2026-07-19）。测试过程中发现并修复 3 处纯 TS 应用层缺陷（去重键误用 `product_id`、`container_id` 为空时跳过去重、先查后写竞态），详见 P0 第 3 项执行记录 |

### 6.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseInventoryCountPolicyRepository.ts` | ✅ 已完成（同上，见 6.1 第 1 行说明） |
| 2 | `src/adapters/supabase/repositories/SupabasePackingTaskItemRepository.ts` | ✅ 已完成 |

### 6.3 索引更新
- [x] `src/core/ports/db/index.ts` - 导出 2 个新端口
- [x] `src/adapters/supabase/repositories/index.ts` - 导出 2 个新实现

---

## Phase 7: 唯一追踪策略仓储（3个）- Layer 4 配套（2026-07-16 新增，ADR-014）

> 对应表见 `docs/03-database/DB_SCHEMA.md` §2.17；对应 RPC 封装见同文档 §4。**2026-07-18 更新：Layer 4 迁移脚本已由 DBA 团队起草并部署到生产环境**（本地 `004_tracking_policy_missing_label.sql` 经 `diff` 核对与 `.readonly/` 参考文件逐字节一致，部署顺序严格排在 Layer 3 之后），本 Phase 代码已实现但测试证据缺失（状态语义说明见 Phase 5 顶部）。

### 7.1 端口定义
| # | 文件 | 状态 | 预估行数 | 说明 |
|---|------|------|---------|------|
| 1 | `src/core/ports/db/ITenantTrackingPolicyRepository.ts` | ✅ 已完成 | ~70 | 租户追踪策略：CRUD `tenant_tracking_policies`，封装 `fn_requires_unique_tracking`/`fn_get_tenant_abc_tracking_default`。测试证据：`src/__tests__/integration/inventory/fn_requires_unique_tracking.concurrency.test.ts`（2026-07-19）。未发现需要修复的真实 bug，详见 P2 第 2 项执行记录 |
| 2 | `src/core/ports/db/IMissingLabelRepository.ts` | ✅ 已完成 | ~70 | 漏码闭环：封装 `fn_generate_internal_lpn`/`fn_confirm_label_applied`。测试证据：`src/__tests__/integration/exceptions/fn_generate_internal_lpn.concurrency.test.ts`（2026-07-19）。**测试过程中发现并修复真实 bug**：`findContainerByLpn`/`findSystemGeneratedContainers` 过滤 `containers` 表上不存在的 `tenant_id` 列，每次调用必定报错（`42703`），详见 P1 第 3 项执行记录 |
| 3 | `src/core/ports/db/IUnidentifiedGoodsRepository.ts` | ✅ 已完成 | ~70 | 未识别货物闭环：封装 `fn_receive_unidentified_goods`/`fn_identify_unidentified_goods`。测试证据：`src/__tests__/integration/exceptions/fn_receive_unidentified_goods.concurrency.test.ts`（2026-07-19）。**测试过程中发现并修复 2 处真实 bug**：`findContainerByException` 查询的是本领域根本不存在的容器概念（该闭环从不创建 containers 行），`findContainerByLpn`/`findSystemGeneratedContainers` 过滤不存在的 `tenant_id` 列，详见 P2 第 3 项执行记录 |

### 7.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseTenantTrackingPolicyRepository.ts` | ✅ 已完成（同上，见 7.1 第 1 行说明） |
| 2 | `src/adapters/supabase/repositories/SupabaseMissingLabelRepository.ts` | ✅ 已完成（同上，见 7.1 第 2 行说明） |
| 3 | `src/adapters/supabase/repositories/SupabaseUnidentifiedGoodsRepository.ts` | ✅ 已完成（同上，见 7.1 第 3 行说明） |

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

## 测试补齐优先级排序（Phase 5/6/7，2026-07-19）

> 背景：ECC 治理试点第 5 步（见 `docs/06-agents/AGENTS.md` §8.5.3）已把 Phase 5/6/7 共 20 个仓储文件（10 端口 + 10 实现）从"✅ 已完成"下调为"🔨 已实现未验证"。给这 20 个文件真正补齐测试覆盖是独立的、较大的工程，不应一次性平推，按以下风险排序分批执行；每一组建议参照 `fn_adjust_inventory_at_location` 试点的打法（本地一次性 Postgres + 真实并发请求 + 故意退化验证测试有效性，见 `src/__tests__/integration/inventory/fn_adjust_inventory_at_location.concurrency.test.ts`）。

**排序逻辑**：并发写入竞态 > 有真实历史 bug 记录 > 涉及合规/安全 > 涉及库存资金准确性 > 纯配置查询。

### P0 — 并发/竞态高风险，优先做
| 仓储 | 风险点 | 依据 |
|---|---|---|
| `TaskClaimRepository` | 竞争性任务租约（`fn_claim_task`/`fn_release_task_claim`/`fn_expire_task_claims`）——多设备抢同一任务，租约到期清扫也是定时并发触发 | 与 `fn_adjust_inventory_at_location` 同类读改写竞态；对应的 `fn_expire_task_claims` 定时任务本身尚未配置（见 Phase 1.4 待办） |
| `SyncEventRepository` | 封装 `fn_apply_sync_event`/`fn_apply_pick_action`——所有 PDA 离线动作（拣货/上架/盘点/打包）都走这条收件箱 | 全系统并发最密集的入口，影响面最大 |
| `PackingTaskItemRepository` | 打包明细行 + 同箱/同码去重逻辑 | 迁移脚本注释明确记录过真实历史 bug（盘点单不指定批次导致多建一行库存），不是假设性风险 |

#### P0 第 1 项执行记录（`TaskClaimRepository`，2026-07-19）

- 新增 `src/__tests__/integration/tasks/fn_claim_task.concurrency.test.ts`，直接实例化 `SupabaseTaskClaimRepository`（而非绕过仓储层直接调 RPC），覆盖 4 个场景：
  1. 同一工单并发 5 个领用请求，有且仅有 1 个成功（唯一约束 `uq_task_claims_active` 生效）；
  2. 释放租约后唯一约束放行下一次领用；
  3. `findActiveByWorkOrder`/`findActiveByUser` 仅返回 ACTIVE 状态、释放后查不到；
  4. `expireTaskClaims` 清扫到期租约为 `EXPIRED`，并将未完成工单标记为 `EXCEPTION`。
- 测试有效性验证：在本地一次性沙盒中临时 `DROP INDEX uq_task_claims_active` 后重跑，场景 1 按预期失败（5 个并发请求全部成功，暴露"重复领用"退化），确认测试确实能捕捉该回归；随后 `CREATE UNIQUE INDEX` 恢复，套件转绿。此过程只操作本地 Docker Postgres 沙盒，未改动任何迁移脚本文件。
- **附带发现（环境问题，非代码缺陷）**：本地 `supabase start`/`db reset` 出来的 Docker Postgres 镜像里，迁移脚本以 `postgres` 角色建表，其默认权限（`ALTER DEFAULT PRIVILEGES`）只授予 `anon`/`authenticated`/`service_role` 角色 `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN`，**不含 `SELECT/INSERT/UPDATE/DELETE`**，导致用 `service_role` key 走 PostgREST/`supabase-js` 时报 `permission denied for table tenants`（`42501`）。生产环境未见此问题（DBA 团队此前确认迁移已在生产正常运行，Device API 也在正常调用），推测是托管 Supabase 项目对新建表有平台级默认授权，本地 CLI 镜像未复现同样的默认值。为跑通本地测试，临时对本地沙盒执行了一次性 `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;`（未写入任何迁移文件，纯本地沙盒操作，重跑 `supabase db reset` 后会失效，需要时重新执行一次）。后续 P0/P1/P2 其余项目在本地跑测试时若遇到同样报错，可直接复用这条 GRANT 命令，不必重新排查。

#### P0 第 2 项执行记录（`SyncEventRepository`，2026-07-19）

- 新增 `src/__tests__/integration/sync/fn_apply_sync_event.concurrency.test.ts`，直接实例化 `SupabaseSyncEventRepository`，覆盖 `insertBatch`/`applyEvent`/`findPending`/`findAppliedSince`/`findByIdempotencyKey`/`getMaxDeviceSeq`/`markAsDuplicate`/`retryEvent`/`getStatusStats` 全部 9 个接口方法。
- **测试过程中发现并确认 5 个真实缺陷（非假设性风险），处理方式各不相同**：

  | 编号 | 问题 | 性质 | 处理结果 |
  |---|---|---|---|
  | Bug A | `fn_apply_pick_action`/`fn_apply_putaway_action`/`fn_apply_count_action`/`fn_apply_pack_action`（`003_extend_sync_event_actions.sql`）用普通 `SELECT ... WHERE status='PENDING'` 判断可处理性，无 `FOR UPDATE` 行锁；真实并发下同一事件可被重复 APPLIED，库存被静默重复扣减。已用手工 psql 双并发复现：100 库存 + qty=10 的 PICK 动作并发调用两次，两次都返回 `APPLIED`，最终库存 80（应为 90） | SQL/migration 层 | **未修复**，登记为已知问题。用例 `test.fails(...)` 断言正确行为（当前预期失败）；一旦 DBA 加锁修正，此用例会转为"意外通过"使套件报错，届时改回普通 `test` 即完成验收。按项目流程，migration 改动由 DBA 团队修正部署（CLAUDE.md 暂停节点 14） |
  | Bug B | `applyEvent`（成功路径）/`markAsDuplicate`/`retryEvent` 用 `as SyncEventUpdate`/`as any` 类型断言写入 `sync_events` 表实际不存在的 `error_message`/`result_data` 列；PostgREST 报错但未检查 `error`，每次调用都静默失败 | TS 应用代码 | **已修复**：删除对不存在列的写入（`applyEvent` 成功路径本就冗余——SQL 函数已自行落定 `status`/`applied_at`） |
  | Bug C | 003 迁移设计注释明确写了"异常处理只在 `fn_apply_sync_event` 这一处，PICK/PUTAWAY/COUNT/PACK 不再各自处理"，但 `applyEvent` 的 switch 语句为这 4 种动作直接调用专用函数，绕开了 `fn_apply_sync_event` 的统一异常处理包装；实测确认 `fn_apply_putaway_action`（004 版本）内部确实已不含 WMS01/OTHERS 异常处理——冷链违规等场景会变成未捕获的原始 Postgres 错误，永远不会在 `exceptions` 表登记 | TS 应用代码（路由设计） | **已修复**：删除 switch 路由，`applyEvent` 统一调用 `fn_apply_sync_event`；新增回归测试验证未知 `action_type` 事件能被正确标记为 `REJECTED`（该分支只有 dispatcher 自己知道，能证明确实未绕开统一入口） |
  | Bug D | `ISyncEventRepository.ts` 的 `SyncEventStatus` 类型定义为 `PENDING/APPLIED/EXCEPTION/DUPLICATE/IGNORED`，但 `sync_events.status` 的 `chk_sync_events_status` CHECK 约束（已用 `psql \d` 核实）只允许 `PENDING/APPLIED/EXCEPTION/REJECTED`——`DUPLICATE`/`IGNORED` 不是合法值，`REJECTED` 反而未被建模；实测 `markAsDuplicate()` 在真实库上必定抛 `violates check constraint` | TS 端口接口与真实 schema 契约不一致 | **已修复**：`SyncEventStatus` 改为 `PENDING\|APPLIED\|EXCEPTION\|REJECTED`；`markAsDuplicate()` 落库为 `REJECTED`；`getStatusStats()` 统计桶同步调整 |
  | Bug E | `fn_apply_sync_event` 处理未知 `action_type` 的 `ELSE` 分支只把 `sync_events.status` 改成 `REJECTED`，没有像同一函数里 `WMS01`/`OTHERS` 两个异常分支那样调用 `fn_raise_exception`（`exception_type_catalog` 已有语义匹配的现成分类 `SYNC_APPLY_FAILURE`，不缺新能力，纯粹是这一分支漏写）——设备发送系统不认识的动作类型时会被静默拒绝，`exceptions` 表/`GET /exceptions` 完全看不到，违反"统一异常领域覆盖所有需关注场景"的设计目标 | SQL/migration 层 | **未修复**，登记为已知问题，与 Bug A 一并写入 `docs/03-database/BUG_REPORT_SYNC_EVENT_APPLY_FUNCTIONS_2026-07-19.md` 提交 DBA。同样用 `test.fails(...)` 做回归探针 |

- **未采用的替代方案**：Bug E 曾考虑在 TS 层（`applyEvent` 收到 `REJECTED_UNKNOWN_ACTION` 后自行补调 `fn_raise_exception`）绕开改 migration，技术上可行但放弃——项目里所有"登记异常"的逻辑目前都收敛在 SQL 函数内部（003 迁移注释明确的设计原则），只有这一条从 TS 层外挂会破坏一致性、增加以后遗漏维护的风险，故仍归类为 SQL 层改动，交由 DBA 处理。
- **本地验证环境**：复用 P0 第 1 项遗留的本地一次性 Docker Postgres 沙盒（未重新 `db reset`，Schema 状态与第 1 项一致），全程未连接生产库，未触碰任何迁移脚本文件。
- **回归确认**：`npx tsc --noEmit` 零错误；`npx vitest run`（不含本地 DB 测试）59 个既有用例全部通过；`RUN_DB_CONCURRENCY_TESTS=true` 跑新增文件：9 个用例全部通过 + 2 个 `test.fails`（Bug A、Bug E，均为预期失败，非红灯）。Bug A 的 `test.fails` 反复运行观测到约 1/7 概率"意外通过"（并发竞态测试固有的时序抖动，不代表已修复，见测试文件头部注释）。

#### P0 第 3 项执行记录（`PackingTaskItemRepository`，2026-07-19）

- **可达性核查（测试方法论第 6 步）先于写测试进行**：全仓库搜索确认 `packingTaskItems`（该仓储 DI 注册名）在 `src/apps/device-api/routes.ts`、`src/apps/admin-api/*` 均无任何调用方。真实的 PDA 打包动作走 `syncEventRepo.insertBatch(...)` → SQL 端 `fn_apply_sync_event` → `fn_apply_pack_action`（`003_extend_sync_event_actions.sql`），后者已经在 SQL 层用 `INSERT ... ON CONFLICT (packing_task_id, order_line_id[, container_id]) DO UPDATE` 原子完成去重累加，且已由 DBA 团队本地验证过（`SYNC_ACTIONS_EXTENSION.md` §9）。也就是说本项测试的是一条当前系统里尚未被任何真实入口调用的应用层代码路径——本表 P0 排序时记录的"迁移脚本注释明确记录过真实历史 bug"，核实后是 003 迁移里 `container_id` 可空导致 `NULL <> NULL` 去重失效的那处注释（`packing_task_items` 表定义正上方），该问题已在 SQL 层用两条局部唯一索引修正（`uq_packing_task_items_no_container`/`uq_packing_task_items_with_container`），并非本仓储此前独有的未修复问题；本仓储自身的 3 个 bug（见下）是独立发现的、SQL 层已修正但 TS 应用层从未对齐的问题。
- 新增 `src/__tests__/integration/packing/fn_apply_pack_action.concurrency.test.ts`，直接实例化 `SupabasePackingTaskItemRepository`，覆盖 `findByPackingTask`/`findByOrderLine`/`findByContainer`/`findByProduct`/`insertBatch`/`updateQty`/`assignContainer`/`getStatsByPackingTask`/`deleteByPackingTask` 全部 9 个接口方法。
- **测试过程中发现并修复 3 个真实缺陷（均为纯 TS 应用层代码，未触碰任何 `.sql` 文件）**：

  | 编号 | 问题 | 处理结果 |
  |---|---|---|
  | Bug 1 | `insertBatch()` 原实现按 `product_id`（经 `findByProduct`）判断去重匹配，但真实唯一索引与 SQL 端 `fn_apply_pack_action` 的 `ON CONFLICT` 目标列都是 `order_line_id`。同一打包任务下两个不同订单行凑巧引用同一 SKU 时，原实现会把它们的数量错误合并进同一行 | **已修复**：改为按 `packing_task_id + order_line_id (+ container_id)` 查找匹配行，与真实约束/SQL 端语义对齐 |
  | Bug 2 | 原去重条件 `dedupe && item.packing_task_id && item.product_id && item.container_id` 对 `container_id` 做真值检查——`container_id` 为 NULL（"同码/批量容器不追踪具体箱子"，文档明确的正常业务场景）时直接跳过去重分支。但该场景下真实唯一索引 `uq_packing_task_items_no_container` 依然生效，同一订单行第二次打包（不指定容器）必然撞上该索引，原实现会抛出未捕获的 PostgREST 23505 错误 | **已修复**：去重判断条件改为 `packing_task_id && order_line_id`，不再要求 `container_id` 为真值，`container_id` 为 NULL/非 NULL 两种情况均正确判定匹配 |
  | Bug 3 | 即便命中去重分支，原实现也是"SELECT 判断是否存在 → 决定 INSERT 还是 UPDATE"的非原子读改写模式，与 P0 第 1/2 项发现的"读改写竞态"同类——真实并发下多个请求可能都在 SELECT 阶段读到"不存在"，其中落败者会直接抛出未捕获的唯一索引冲突 | **已修复**：改为乐观并发重试循环（插入撞 23505 或更新因 `updated_at` 比对失败都视为"被并发请求抢先"，重新读取后重试）。**首次实现只设 5 次重试上限，8 路真实并发测试下复现了"落败者耗尽重试次数"的失败**（根因：多个请求在同一轮读到完全相同的 `updated_at` 快照时集体重试，每轮只能保证恰好 1 个请求胜出，最坏情形所需轮数与并发请求数同量级）；追加随机退避（`Math.random() * 10 * attempt` 毫秒）打散整队重试模式，并将上限提高到 20 次后，8 路并发连续 3 轮重跑稳定全部成功 |

- **本地验证环境**：复用另一 worktree 遗留的本地一次性 Docker Postgres 沙盒（`supabase_db_ecc-governance-pilot`，001-005 迁移均已生效，`schema_migrations` 跟踪表缺 005 记录但函数体已核实包含 005 引入的 `PROCESSING` 中间态，不影响本项测试），全程未连接生产库，未触碰任何迁移脚本文件。
- **回归确认**：`npx tsc --noEmit` 零错误；`npx vitest run`（不含本地 DB 测试）59 个既有用例全部通过；`RUN_DB_CONCURRENCY_TESTS=true` 单独跑新增文件连续 3 轮重跑，9 个用例全部稳定通过；`RUN_DB_CONCURRENCY_TESTS=true` 跑全部 5 个 DB 并发测试文件（含 P0 第 1/2 项、P1 第 1 项既有用例）共 32 个用例全部通过，未见跨文件相互干扰。
- **测试有效性验证**：临时用 `git show HEAD:...` 还原修复前的原始实现覆盖工作区文件（不改动 git 历史），重跑测试：Bug 1 的用例最初误用 `container_id: null` 夹具、未能触发原实现里"仅当 `container_id` 为真值才进入（错误）去重分支"的条件，对照原始实现"意外通过"——据此把该用例改为两条订单行共用同一非空 `container_id`，才能真正命中 `product_id` 误判去重的路径；修正后 Bug 1/2/3 三个用例对原始实现均按预期失败（`uq_packing_task_items_no_container` 唯一索引冲突、`updateQty` 竞态崩溃各 1 处），其余 6 个用例不受影响仍通过；随后恢复修复后的实现，全部 9 个用例转绿。

### P1 — 涉及库存/资金准确性，其次做
| 仓储 | 风险点 | 依据 |
|---|---|---|
| `ExceptionRepository` | `fn_confirm_inventory_recount` 涉及库存盘点确认；统一异常领域是其他模块出错时的兜底安全网 | 若本身有 bug，属于"保护机制失效"级别风险 |
| `SyncPolicyRepository` | `fn_get_sync_policy` 决定任务 `ALLOW`/`LIMITED`/`ONLINE_ONLY` | 读错会让危险品/冷链等本应强制在线的操作被当成允许离线，ADR-011 专门强调的合规/安全场景 |
| `MissingLabelRepository` | `fn_generate_internal_lpn` 生成内部追踪码 | 编码生成类逻辑并发下容易出现唯一性冲突，直接影响漏码货物追踪链路 |

#### P1 第 2 项执行记录（`SyncPolicyRepository`，2026-07-19）

- **可达性核查（测试方法论第 6 步）先于写测试进行，结论与 P0 第 3 项相反**：`src/apps/device-api/routes.ts` 的 `GET /sync/policy` 端点直接调用本仓储——这是**真实生产路径**，PDA 设备在开始任务前必须先查询这个端点判定该任务/库位是否必须强制在线（冷链/危化品合规场景，本表排序依据本身就点名了这个风险）。
- **可达性核查过程中发现一个比"读改写竞态"更严重的问题：响应字段命名与合规判定不一致**。`SYNC_API_CONTRACT.md` §5.2 明确文档化 `GET /sync/policy` 响应契约为 `{"offline_mode": ..., "max_offline_duration_seconds": ...}`（snake_case，与同文件里其余全部 Device API 响应字段命名约定一致：`event_id`/`next_cursor`/`lpn_code`/`exception_id` 等）。但原实现 `SupabaseSyncPolicyRepository.getSyncPolicy()`（不在 `ISyncPolicyRepository` 接口上、却是 `routes.ts` 实际调用的方法）返回的是 camelCase 的 `{offlineMode, maxOfflineDurationSeconds, requiresTaskClaim, conflictStrategy, policyId}`，`routes.ts` 又把这个对象原样透传（`res.json(result)`，无任何字段映射）。核实确认没有任何全局中间件做驼峰/下划线转换。按文档实现的 PDA 客户端读取 `response.offline_mode` 只会读到 `undefined`——这正是决定"该任务是否必须强制在线"的关键字段，fail-open 会让冷链/危化品的强制在线合规检查被静默绕过，不是假设性风险。另外三个字段在 `fn_get_sync_policy` 的真实返回列（仅 `offline_mode`/`max_offline_duration_seconds` 两列，已读 SQL 源码核实）里根本不存在，是永远不变的硬编码常量。
- **修复（均为纯 TS 应用层 + 路由层代码，未触碰任何 `.sql` 文件）**：
  1. 删除未在接口上声明的重复方法 `getSyncPolicy()`，把逻辑合并进接口方法 `getEffectivePolicy()`，返回值只保留 `offlineMode`/`maxOfflineDurationSeconds` 两个真实存在的字段。
  2. `routes.ts` 改为调用 `getEffectivePolicy()` 并显式映射为 `{offline_mode, max_offline_duration_seconds}` 的 snake_case 响应，对齐文档契约与其余端点的命名约定。
  3. **次要缺陷**：数据库 CHECK 约束 `chk_sync_policies_limited_duration` 只强制 `LIMITED` 策略行必须填写 `max_offline_duration_seconds`，`ONLINE_ONLY` 行允许该列为 NULL；原实现对 NULL 简单做 `|| 28800` 兜底，会让 `ONLINE_ONLY` 策略被上报成"最长可离线 8 小时"，与文档"ONLINE_ONLY 时为 0"的约定矛盾，且 `getMaxOfflineDuration()` 对已算出的合法 `0` 值还会再做一次 `|| 28800`，把 `0` 当 falsy 错误改写。已改为 `getEffectivePolicy()` 内部对 `ONLINE_ONLY` 直接归一化为 0，`getMaxOfflineDuration()` 不再做二次兜底。
- 新增 `src/__tests__/integration/sync/fn_get_sync_policy.concurrency.test.ts`，直接实例化 `SupabaseSyncPolicyRepository`，覆盖 `getEffectivePolicy`（含四维优先级匹配：租户+任务+库位 > 租户+任务 > 租户+库位 > 租户默认、未配置时的安全默认值、ONLINE_ONLY 归一化、返回字段形状回归防护）/`isOfflineAllowed`/`getMaxOfflineDuration`/`findByTenant`/`findByTaskType`/`findByZoneType` 全部方法。
- **测试有效性验证**：临时用 `git show HEAD:...` 还原修复前的原始实现覆盖工作区文件（不改动 git 历史），重跑测试：6 个用例中 4 个按预期失败（安全默认值多出 `policyId` 字段、优先级匹配用例的 `ONLINE_ONLY` 结果 `maxOfflineDurationSeconds` 为 `null` 而非 `0`、归一化回归用例、字段形状回归用例），另外 2 个不受这两处改动影响的用例（`isOfflineAllowed`、`findByTenant`/`findByTaskType`/`findByZoneType`）保持通过——失败集合精确对应修复范围，随后恢复修复后的实现，全部 6 个用例转绿。
- **本地验证环境**：复用另一 worktree 遗留的本地一次性 Docker Postgres 沙盒（`supabase_db_ecc-governance-pilot`，001-005 迁移均已生效），全程未连接生产库，未触碰任何迁移脚本文件。
- **回归确认**：`npx tsc --noEmit` 零错误；`npx vitest run`（不含本地 DB 测试）59 个既有用例全部通过；`RUN_DB_CONCURRENCY_TESTS=true` 单独跑新增文件连续 2 轮重跑，6 个用例全部稳定通过；`RUN_DB_CONCURRENCY_TESTS=true` 跑全部 DB 并发测试文件（含 P0 第 1/2 项、P1 第 1 项既有用例；本 worktree 基于 main 分叉，不含尚未合并的 P0 第 3 项 PR）共 29 个用例全部通过，未见跨文件相互干扰。
- **未在本次范围内处理**：`GET /sync/policy` 字段映射的路由层修复目前没有 HTTP 层回归测试覆盖——项目现有测试基建（`vitest` + 直接实例化仓储）不含 `supertest` 类的 Express 路由集成测试模式，引入新测试范式超出本次"仓储测试补齐"任务范围，修复本身已通过人工核对 `SYNC_API_CONTRACT.md`/`routes.ts`/`tsc` 确认正确性。若后续项目补充 Device API 路由层集成测试基建，应把 `GET /sync/policy` 的 snake_case 字段回归纳入覆盖范围。

#### P1 第 3 项执行记录（`MissingLabelRepository`，2026-07-19）

- **可达性核查（测试方法论第 6 步）**：`generateInternalLpn`/`confirmLabelApplied` 是真实生产路径（`src/apps/device-api/routes.ts` 的 `POST /missing-label/generate`/`POST /missing-label/confirm` 直接调用）；`findContainerByLpn`/`findSystemGeneratedContainers`/`createContainer` 目前无真实调用方（与 P0 第 3 项同类），仍按既定优先级补齐测试。
- **发现并修复的真实缺陷（纯 TS 应用层代码，未触碰任何 `.sql` 文件）**：`findContainerByLpn`/`findSystemGeneratedContainers` 原实现对 `containers` 表过滤 `.eq('tenant_id', tenantId)`，但 `containers` 表本身**没有 `tenant_id` 列**（已用 `psql \d containers` 核实：id/lpn_code/parent_container_id/container_type/current_location_id/is_sealed/last_opened_at/status/created_at/updated_at/lpn_source，无 tenant_id，无 RLS 策略——容器是跨租户共享资源，租户隔离通过 `inventory.tenant_id` 间接表达）。过滤不存在的列会被 PostgREST 拒绝（`42703 column containers.tenant_id does not exist`，已用 `curl` 直连 PostgREST 端点实测复现），两个方法此前**每次调用必定抛异常**。修复：`IMissingLabelRepository`/`SupabaseMissingLabelRepository` 去掉这两个方法上从未真实生效过的 `tenantId` 参数。**同样的 bug 复制粘贴进了 `SupabaseUnidentifiedGoodsRepository`，本次未处理，留给 P2 对应项**。
- **测试有效性验证的特殊情况**：这次修复改变了方法签名（去掉一个参数），不是纯内部逻辑修复，经典的"还原实现、重跑同一份测试确认变红"手法在这里不完全适用——用修复后签名写的测试去调用还原后的旧实现时，JS 不校验参数个数，旧方法内部的 `tenantId` 会是 `undefined`，`.eq('tenant_id', undefined)` 被 supabase-js 静默跳过而不是真的发送 `tenant_id=eq.undefined`，因此"重跑同一测试"不会转红，不能证明有效性。改用直接对本地 PostgREST 端点发起 `curl` 请求（`containers?tenant_id=eq.<真实uuid>`）复现 `42703` 错误，作为该项修复的独立经验证据，不依赖测试文件本身的回归对比。
- **一个记录在案、本次不处理的开放行为**：`fn_generate_internal_lpn` 对同一 `exception_id` 重复调用没有幂等保护，每次都新建容器并覆盖 `exceptions.details` 里的最新码，旧容器变孤儿。`.readonly/unWMS_Tracking_Policy_Missing_Label_V1.md` 设计文档只描述了"生成→打印→扫码确认"一次性流程，未明确讨论重复调用场景——按测试方法论第 5 步的标准，这是设计意图未覆盖的开放问题，不是确定性 bug，未推动 `.sql` 改动，测试里用一个用例如实记录当前行为供后续参考。
- 新增 `src/__tests__/integration/exceptions/fn_generate_internal_lpn.concurrency.test.ts`，直接实例化 `SupabaseMissingLabelRepository`，覆盖 `generateInternalLpn`/`confirmLabelApplied`（含扫码不一致拒绝、未生成码时拒绝两条防护路径）/`findContainerByLpn`/`findSystemGeneratedContainers`/`createContainer` 全部方法，以及重复生成行为的记录性用例。
- **本地验证环境**：复用另一 worktree 遗留的本地一次性 Docker Postgres 沙盒（`supabase_db_ecc-governance-pilot`，001-004 迁移已生效），全程未连接生产库，未触碰任何迁移脚本文件。
- **回归确认**：`npx tsc --noEmit` 零错误；`npx vitest run`（不含本地 DB 测试）59 个既有用例全部通过；`RUN_DB_CONCURRENCY_TESTS=true` 单独跑新增文件连续 3 轮重跑，7 个用例全部稳定通过；`RUN_DB_CONCURRENCY_TESTS=true` 跑全部 DB 并发测试文件（含 P0 第 1/2 项、P1 第 1/2 项既有用例；本 worktree 基于 main 分叉，不含尚未合并的 P0 第 3 项 PR）共 30 个用例全部通过，未见跨文件相互干扰。

### P2 — 配置类查询，风险相对低，可以放后面
| 仓储 | 风险点 | 依据 |
|---|---|---|
| `InventoryCountPolicyRepository` | `fn_get_count_tolerance`，"全局默认+租户覆盖"模式 | `CONVENTIONS.md` §5.4.8 记录过此模式设计上的坑，但主要是配置读取，不涉及并发写入 |
| `TenantTrackingPolicyRepository` | `fn_requires_unique_tracking` | 同上，策略查询类，读多写少 |
| `UnidentifiedGoodsRepository` | `fn_receive_unidentified_goods`/`fn_identify_unidentified_goods` | 未识别货物是低频边缘场景，出错影响范围小 |
| `DeviceSyncStateRepository` | 设备同步状态读写 | 结构最简单，基本是状态标记，历史上没有 bug 记录 |

#### P2 第 1 项执行记录（`InventoryCountPolicyRepository`，2026-07-19）

- **可达性核查（测试方法论第 6 步）**：全仓库搜索确认 `inventoryCountPolicies`（DI 注册名）在 `device-api`/`admin-api` 均无任何调用方。真实的盘点动作走 SQL 层 `fn_apply_count_action`，直接调用 `fn_get_count_tolerance`，不经过本仓储——与 P0 第 3 项 PackingTaskItemRepository 同类，仍按既定优先级补齐测试。
- **发现并修复的真实缺陷（纯 TS 应用层代码，未触碰任何 `.sql` 文件）**：`upsertBatch`/`upsertPolicy` 原实现用 PostgREST 的 `.upsert(data, { onConflict: 'tenant_id,product_id' })`。但 `inventory_count_policies` 表上只有两条局部唯一索引（`uq_count_policy_tenant_default (tenant_id) WHERE product_id IS NULL` / `uq_count_policy_tenant_product (tenant_id, product_id) WHERE product_id IS NOT NULL`，已用 `psql \d inventory_count_policies` 核实），没有覆盖 `(tenant_id, product_id)` 的普通唯一约束——这正是 `CONVENTIONS.md` §5.4.8 本身记录的"全局默认+租户覆盖"设计模式（不把可空覆盖字段放进单一唯一约束）。PostgREST 的 `on_conflict` 只能匹配非分区唯一索引，对分区索引必定报 `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification`（已用 `curl` 直连本地 PostgREST 端点实测复现）。也就是说原实现的 `upsertBatch`/`upsertPolicy` **每次调用都会失败**，与本表在 P2 排序依据里点名的"设计上的坑"完全对应，不是假设性风险。修复：改为查找后写入（`product_id` 为 NULL 时按 IS NULL 匹配，否则按等值匹配）+ 乐观并发重试，与 P0 第 3 项 PackingTaskItemRepository 的 `insertBatch` 同一类根因（PostgREST upsert 与真实分区唯一索引设计不兼容）、同一种修法。
- 新增 `src/__tests__/integration/inventory/fn_get_count_tolerance.concurrency.test.ts`，直接实例化 `SupabaseInventoryCountPolicyRepository`，覆盖 `upsertPolicy`/`upsertBatch`/`getCountTolerance`（含商品级覆盖>租户默认>安全默认值 0 的优先级）/`getDefaultTolerance`/`findByTenant`/`findByProduct`，以及 5 路并发 `upsertPolicy` 用例。
- **测试有效性验证**：临时还原修复前的原始实现覆盖工作区文件（不改动 git 历史），重跑测试：7 个用例全部按预期失败，其中 6 个精确报出 `there is no unique or exclusion constraint matching the ON CONFLICT specification`，并发用例报 5 个请求全部 rejected——与预期的失败原因完全对应；随后恢复修复后的实现，全部 7 个用例转绿，连续 2 轮重跑稳定。
- **本地验证环境**：复用另一 worktree 遗留的本地一次性 Docker Postgres 沙盒（`supabase_db_ecc-governance-pilot`，001-004 迁移已生效），全程未连接生产库，未触碰任何迁移脚本文件。
- **回归确认**：`npx tsc --noEmit` 零错误；`npx vitest run`（不含本地 DB 测试）59 个既有用例全部通过；`RUN_DB_CONCURRENCY_TESTS=true` 跑全部 DB 并发测试文件（含 P0 第 1/2/3 项、P1 第 1/2/3 项既有用例）共 45 个用例全部通过，未见跨文件相互干扰。

#### P2 第 2 项执行记录（`TenantTrackingPolicyRepository`，2026-07-19）

- **可达性核查（测试方法论第 6 步）**：全仓库搜索确认 `tenantTrackingPolicies`（DI 注册名）在 `device-api`/`admin-api` 均无任何调用方。真实的追踪策略判定走 SQL 层内部调用 `fn_requires_unique_tracking`，不经过本仓储——与 P0 第 3 项同类，仍按既定优先级补齐测试。
- **与 P0 第 3 项 / P2 第 1 项不同：本项未发现需要修复的真实缺陷**。`upsertBatch` 用的 `.upsert(data, { onConflict: 'tenant_id,abc_class' })` 这次是正确的——`tenant_tracking_policies` 表上有真实的**非分区**唯一约束 `tenant_tracking_policies_tenant_id_abc_class_key UNIQUE (tenant_id, abc_class)`（已用 `psql \d` 核实，`abc_class` 是 `NOT NULL`，不是 P2 第 1 项那种"全局默认+租户覆盖"的可空覆盖字段模式），已用 `curl` 直连本地 PostgREST 端点实测确认 upsert 正常工作，不是理论推测。纯粹测试补齐，不含代码修复，验证了排序依据表里"读多写少、风险相对低"的判断是准确的。
- 新增 `src/__tests__/integration/inventory/fn_requires_unique_tracking.concurrency.test.ts`，直接实例化 `SupabaseTenantTrackingPolicyRepository`，覆盖 `upsertBatch`（含二次调用更新而非重复行）/`getDefaultTracking`（含 A→true/C→false/B→true 保守兜底的未配置行为）/`requiresUniqueTracking`（商品级覆盖 > 租户 ABC 默认，库位强制追踪可把结果从 false 升级为 true 但不能反向覆盖）/`findByTenant`/`findByTenantAndClass`/`deletePolicy` 全部方法。
- **本地验证环境**：复用另一 worktree 遗留的本地一次性 Docker Postgres 沙盒（`supabase_db_ecc-governance-pilot`，001-004 迁移已生效），全程未连接生产库，未触碰任何迁移脚本文件。
- **回归确认**：`npx tsc --noEmit` 零错误；`npx vitest run`（不含本地 DB 测试）59 个既有用例全部通过；`RUN_DB_CONCURRENCY_TESTS=true` 单独跑新增文件连续 3 轮重跑，6 个用例全部稳定通过；`RUN_DB_CONCURRENCY_TESTS=true` 跑全部 DB 并发测试文件共 51 个用例全部通过，未见跨文件相互干扰。

#### P2 第 3 项执行记录（`UnidentifiedGoodsRepository`，2026-07-19）

- **可达性核查（测试方法论第 6 步）**：`receiveUnidentifiedGoods`/`identifyUnidentifiedGoods` 是真实生产路径（`src/apps/device-api/routes.ts` 的 `POST /unidentified/receive`/`POST /unidentified/identify` 直接调用）；`findContainerByException`/`createContainer`/`findContainerByLpn`/`findSystemGeneratedContainers` 目前无真实调用方。
- **发现并修复的真实缺陷（纯 TS 应用层代码，未触碰任何 `.sql` 文件）**：
  1. **比 P1 第 3 项更严重：不是列名笔误，是整个方法的领域模型错误**。`findContainerByException` 原实现对 `containers` 表过滤 `.eq('exception_id', exceptionId).eq('tenant_id', tenantId)`。但读 `fn_receive_unidentified_goods`/`fn_identify_unidentified_goods` SQL 源码确认：UNIDENTIFIED_GOODS 闭环从头到尾只操作 `inventory` 表（`product_id` 记为 NULL 暂存，回填时直接 `UPDATE inventory`），**从不创建 `containers` 行**——与 MISSING_LABEL 闭环（会生成 `SYSTEM_GENERATED` 容器）是完全不同的两条路径（见 `.readonly/unWMS_Tracking_Policy_Missing_Label_V1.md` §3"两条完全不同的异常路径"）。`containers` 表本身也没有 `exception_id` 列（已用 `psql \d containers` 核实）。也就是说"按异常查容器"这个问题在真实数据模型里没有答案，不是可以通过改列名修好的 bug——修复为恒返回 `null` 并在代码注释里说明原因，而不是编一个跨表 join 到 `inventory` 的新查询逻辑（那会改变方法返回类型语义，属于需要人工确认的接口设计变更，不在本次测试补齐范围内）。
  2. **与 P1 第 3 项同一类**：`findContainerByLpn`/`findSystemGeneratedContainers` 过滤 `containers` 表上不存在的 `tenant_id` 列，每次调用必定抛 `42703`。修复：去掉这两个方法上从未真实生效过的 `tenantId` 参数——与 `IMissingLabelRepository` 的同名方法完全同一类根因（P1 第 3 项执行记录里已预告"复制粘贴进了本仓储，留给 P2 对应项处理"，本次即为该项）。
- 新增 `src/__tests__/integration/exceptions/fn_receive_unidentified_goods.concurrency.test.ts`，直接实例化 `SupabaseUnidentifiedGoodsRepository`，覆盖 `receiveUnidentifiedGoods`（含库存暂存 `product_id=NULL` 与异常登记）/`identifyUnidentifiedGoods`（回填 `product_id` + 通过 `fn_resolve_exception` 关闭异常）/`findUnidentifiedGoodsExceptions`/`findContainerByException`（回归防护恒 null）/`findContainerByLpn`/`findSystemGeneratedContainers`（回归防护不再因不存在的列报错）。
- **测试有效性验证**：临时还原修复前的原始实现覆盖工作区文件（不改动 git 历史），重跑测试：2 个回归防护用例精确报出 `column containers.exception_id does not exist`/`column containers.tenant_id does not exist`，其余 3 个不受这两处改动影响的用例保持通过——失败集合精确对应修复范围；随后恢复修复后的实现，全部 5 个用例转绿，连续 3 轮重跑稳定。
- **本地验证环境**：复用另一 worktree 遗留的本地一次性 Docker Postgres 沙盒（`supabase_db_ecc-governance-pilot`，001-004 迁移已生效），全程未连接生产库，未触碰任何迁移脚本文件。
- **回归确认**：`npx tsc --noEmit` 零错误；`npx vitest run`（不含本地 DB 测试）59 个既有用例全部通过；`RUN_DB_CONCURRENCY_TESTS=true` 跑全部 DB 并发测试文件共 57 个用例全部通过，未见跨文件相互干扰。

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