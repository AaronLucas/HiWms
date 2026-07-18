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
| 2 | `src/core/ports/db/ISyncPolicyRepository.ts` | 🔨 已实现未验证 | ~60 | 离线策略配置：封装 `fn_get_sync_policy`，CRUD `sync_policies` |
| 3 | `src/core/ports/db/IDeviceSyncStateRepository.ts` | 🔨 已实现未验证 | ~60 | 设备同步状态：`device_sync_state` 读写 |
| 4 | `src/core/ports/db/ISyncEventRepository.ts` | ✅ 已完成 | ~100 | 同步事件收件箱：`sync_events` 写入 + 封装 `fn_apply_sync_event`/`fn_apply_pick_action`。测试证据：`src/__tests__/integration/sync/fn_apply_sync_event.concurrency.test.ts`（2026-07-19，2026-07-19 更新为回归测试）。曾有的 2 项已知问题（Bug A 并发重复扣库存、Bug E 未知 action_type 不登记异常）已由 DBA `005_concurrency_hardening_V1.sql` 修复，本地应用该迁移后连续多轮重跑验证稳定通过，详见 `BUG_REPORT_SYNC_EVENT_APPLY_FUNCTIONS_2026-07-19.md` 及 P0 第 2 项执行记录 |
| 5 | `src/core/ports/db/IExceptionRepository.ts` | ✅ 已完成 | ~110 | 统一异常领域：`exception_type_catalog`/`exceptions`/`exception_events`，封装 `fn_raise_exception`/`fn_resolve_exception`/`fn_confirm_inventory_recount`。测试证据：`src/__tests__/integration/exceptions/fn_resolve_exception.concurrency.test.ts`（2026-07-19）。**2026-07-19 核对 DBA 的 `005_concurrency_hardening_V1.sql` 时顺带发现并修复 4 处缺陷**：（1）`ExceptionStatus` 类型（`OPEN/INVESTIGATING/RESOLVED/CLOSED/ESCALATED`）与 `exceptions.status` 真实 `chk_exceptions_status` CHECK 约束（`PENDING_REVIEW/CONFLICT/RESOLVED/DISMISSED`）几乎完全对不上，同 SyncEventStatus 的 Bug D 一类问题，已改为与真实约束一致；（2）`escalateException()` 写入不合法的 `'ESCALATED'`，已改为约束里真实存在的 `CONFLICT`（对应设计文档"升级"语义），并补了"已 RESOLVED/DISMISSED 不可再升级"的防护；（3）`resolveException()` 硬编码的 `p_resolution_details` 永远不含 `fn_confirm_inventory_recount` 需要的 `confirmed_available_qty`，导致 INVENTORY_SHORTAGE 异常"确认解决"后库存从未被真正修正（DBA 自查清单第 8 条点名的"函数返回成功但业务表没联动"），已开放 `resolutionDetails` 透传；（4）`confirmInventoryRecount()` 之前绕开 `fn_resolve_exception` 直接调用底层函数（跳过权限校验/状态转移/审计轨迹），且 JSON key 用的是 `recount_qty` 而不是函数实际读取的 `confirmed_available_qty`，双重原因导致库存不会被调整，已改为委托给 `resolveException()`；（5）`recordEvent()` 写入不存在的 `description` 列（真实列名 `note`），导致每次调用必定报错，连带 `escalateException()` 失败，已修正列名 |

### 5.2 Supabase 实现
| # | 文件 | 状态 |
|---|------|------|
| 1 | `src/adapters/supabase/repositories/SupabaseTaskClaimRepository.ts` | ✅ 已完成 |
| 2 | `src/adapters/supabase/repositories/SupabaseSyncPolicyRepository.ts` | 🔨 已实现未验证 |
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

### P1 — 涉及库存/资金准确性，其次做
| 仓储 | 风险点 | 依据 |
|---|---|---|
| `ExceptionRepository` | `fn_confirm_inventory_recount` 涉及库存盘点确认；统一异常领域是其他模块出错时的兜底安全网 | 若本身有 bug，属于"保护机制失效"级别风险 |
| `SyncPolicyRepository` | `fn_get_sync_policy` 决定任务 `ALLOW`/`LIMITED`/`ONLINE_ONLY` | 读错会让危险品/冷链等本应强制在线的操作被当成允许离线，ADR-011 专门强调的合规/安全场景 |
| `MissingLabelRepository` | `fn_generate_internal_lpn` 生成内部追踪码 | 编码生成类逻辑并发下容易出现唯一性冲突，直接影响漏码货物追踪链路 |

### P2 — 配置类查询，风险相对低，可以放后面
| 仓储 | 风险点 | 依据 |
|---|---|---|
| `InventoryCountPolicyRepository` | `fn_get_count_tolerance`，"全局默认+租户覆盖"模式 | `CONVENTIONS.md` §5.4.8 记录过此模式设计上的坑，但主要是配置读取，不涉及并发写入 |
| `TenantTrackingPolicyRepository` | `fn_requires_unique_tracking` | 同上，策略查询类，读多写少 |
| `UnidentifiedGoodsRepository` | `fn_receive_unidentified_goods`/`fn_identify_unidentified_goods` | 未识别货物是低频边缘场景，出错影响范围小 |
| `DeviceSyncStateRepository` | 设备同步状态读写 | 结构最简单，基本是状态标记，历史上没有 bug 记录 |

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