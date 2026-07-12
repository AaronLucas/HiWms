# 基础设施/数据库对齐分析与计划

> 基于 `.readonly/unWMS_Full_Init_Schema_V2.1.sql` (V2.1 原始设计) 与当前项目代码状态的对比分析

---

## 1. 原始设计概况（.readonly/ 版本）

| 维度 | 数量 | 说明 |
|------|------|------|
| 表 | 42 个 | 含 10 个核心业务表 + 履约链路 16 表 + 计费 3 表 + 权限 4 表 + 字典/辅助表 |
| 函数 | 16 个 | 10 核心业务 RPC + 2 定时任务 + 3 触发器 + 1 工具函数 |

---

## 2. 当前代码 vs 原始设计 对比矩阵

### 2.1 表/Repository 对比

| 类别 | 原始设计 | 当前状态 | 差距 |
|------|----------|----------|------|
| **核心表 (10)** | tenants, permissions, roles, users, devices, products, product_constraints, locations, containers, inventory | 全有端口+实现 | ✅ 基本齐全 |
| **订单/波次 (4)** | orders, order_lines, waves, wave_order_mapping | 仅端口，**无实现** | ❌ 4 表无 Repository 实现 |
| **履约链路 (16)** | inbound_receipts, quality_inspections, inspection_items, cross_dock_jobs, sorting_chutes, sorting_tasks, sorting_waves, verification_rules, package_specs, label_templates, packing_tasks, consumable_usages, vehicles, loading_tasks, shipping_documents, vas_boms/vom_items | 仅 IInboundReceiptRepository/IPackingTaskRepository 有端口，**全无实现** | ❌ 16 表无 Repository 实现 |
| **计费 (3)** | billing_rules, billing_rule_tiers, billing_transactions | 仅 IBillingRuleRpc，**无 Repository 端口** | ❌ 3 表无端口/实现 |
| **库存辅助 (3)** | inventory_history, inventory_reservations, inventory_locks | 无端口 | ❌ 3 表无端口 |
| **权限 (4)** | roles, permissions, role_permissions, user_roles | IRoleRepository ✅ 实现 | ✅ |
| **其他 (3)** | devices, barcode_mappings, consumable_usages | 无端口 | ❌ |

**总计：42 表中，仅 10 表有完整链路（端口+实现+UseCase），32 表缺失实现或端口**

### 2.2 函数/RPC 对比

| 类别 | 原始设计 (16) | 端口 | 客户端 | UseCase | 状态 |
|------|--------------|------|--------|---------|------|
| **核心业务 (10)** | | | | | |
| fn_logic_stock_allocation | ✅ | ✅ | ✅ (AllocateInventoryUseCase) | ✅ |
| fn_logic_resolve_blackbox_box | ✅ | ✅ | ✅ (ResolveBlackboxUseCase) | ✅ |
| fn_match_cross_dock | ✅ | ✅ | ❌ | ⚠️ 缺 UseCase |
| fn_allocate_chute | ✅ | ✅ | ❌ | ⚠️ 缺 UseCase |
| fn_verify_weight | ✅ | ✅ | ❌ | ⚠️ 缺 UseCase |
| fn_get_active_billing_rule | ✅ | ✅ | ❌ | ⚠️ 缺 UseCase |
| adjust_inventory | ✅ | ✅ | ✅ (AdjustInventoryUseCase) | ✅ |
| sync_inventory_from_source | ✅ | ✅ | ✅ (SyncInventoryUseCase) | ✅ |
| check_user_permission | ✅ | ✅ | ❌ | ⚠️ 缺 UseCase |
| fn_current_tenant_id | ✅ | ✅ | ❌ | ⚠️ 缺 UseCase |
| **定时任务 (2)** | | | | | |
| fn_cross_dock_timeout_sweep | ✅ | ✅ | ❌ | ⚠️ 缺 UseCase |
| fn_purge_old_action_logs | ✅ | ✅ | ❌ | ⚠️ 缺 UseCase |
| **触发器 (3)** | fn_trg_inventory_version_manager, fn_trg_inventory_history, fn_trg_enforce_product_constraints | N/A | N/A | N/A | 自动执行 |
| **工具 (1)** | fn_update_updated_at | N/A | N/A | N/A | 触发器用 |

**结论：16 个函数中，仅 3 个有完整 UseCase，7 个缺 UseCase，其余为触发器/工具**

---

## 3. 核心问题与风险

| 问题 | 影响 | 严重度 |
|------|------|--------|
| **32/42 表无 Repository 实现** | 路由层直接用 SupabaseClient 绕过端口，破坏六边形架构，测试困难 | 🔴 高 |
| **7 个核心 RPC 缺 UseCase** | 业务逻辑分散在 routes/中，无法复用、测试 | 🔴 高 |
| **Repository 端口定义不全** | 部分表连端口都没有（如 billing、inventory_history） | 🟡 中 |
| **Repository 实现基类不完善** | SupabaseBaseRepository 缺乏复杂查询支持（join、聚合、事务） | 🟡 中 |
| **TypeScript 类型与 DB 不一致** | 部分表字段（如 product_constraints.sku_id vs product_id）导致类型报错 | 🟡 中 |

---

## 4. 建议方案：基础设施对齐专项计划

### 目标
将「原始设计 (V2.1)」与「代码实现」完全对齐，补齐所有缺失的端口、实现、UseCase。

### 分阶段执行

#### Phase A：Repository 端口补全（1 周）
| 任务 | 产出 |
|------|------|
| A.1 补齐 32 个缺失表的 Repository 端口 | `src/core/ports/db/I*.ts` |
| A.2 统一端口命名规范（findByXxx, findByTenant, findAvailable 等） | 规范文档 |
| A.3 增强 SupabaseBaseRepository（join、聚合、事务支持） | 基类增强 |

#### Phase B：Repository 实现补全（2 周）
| 批次 | 表组 | 预估文件 |
|------|------|----------|
| B.1 订单/波次 (4) | orders, order_lines, waves, wave_order_mapping | 4 |
| B.2 履约链路-入库/质检 (6) | inbound_receipts, quality_inspections, inspection_items, cross_dock_jobs, verification_rules | 6 |
| B.3 履约链路-分拣/打包/装车 (10) | sorting_chutes, sorting_tasks, sorting_waves, package_specs, label_templates, packing_tasks, consumable_usages, vehicles, loading_tasks, shipping_documents | 10 |
| B.4 计费/库存辅助 (6) | billing_rules, billing_rule_tiers, billing_transactions, inventory_history, inventory_reservations, inventory_locks | 6 |
| B.5 其他 (6) | devices, barcode_mappings, vas_boms, vas_bom_items, label_templates | 6 |

#### Phase C：RPC UseCase 补全（1 周）
| RPC | 对应 UseCase | 优先级 |
|-----|-------------|--------|
| fn_match_cross_dock | MatchCrossDockUseCase | 高 (直通核心) |
| fn_allocate_chute | AllocateChuteUseCase | 高 (分拣核心) |
| fn_verify_weight | VerifyWeightUseCase | 高 (验货核心) |
| fn_get_active_billing_rule | GetActiveBillingRuleUseCase | 中 (计费查询) |
| check_user_permission | CheckUserPermissionUseCase | 中 (权限复用) |
| fn_current_tenant_id | GetCurrentTenantIdUseCase | 低 |
| fn_cross_dock_timeout_sweep | CrossDockTimeoutSweepUseCase | 高 (定时任务) |
| fn_purge_old_action_logs | PurgeOldLogsUseCase | 中 |

#### Phase D：类型同步与验证（0.5 周）
- 同步 `src/types/database.ts` 与 Supabase 生成类型
- 修复所有类型不匹配（如 product_constraints.sku_id → product_id）
- 全量 lint/test/build 通过

---

## 5. 与当前 CLEANUP_PLAN 关系分析

| 当前计划 | 基础设施对齐计划 | 关系 |
|----------|------------------|------|
| Phase 2.3 删除 `src/supabase/` | **前置依赖**：需先完成 Phase A-C，确保所有代码走端口/UseCase，无直接 SupabaseClient 调用 | **阻塞关系** |
| Phase 3 UseCase 迁移 | **部分重叠**：Phase C 正好是 UseCase 补全的核心部分 | **合并关系** |
| Phase 4 路由迁移 | **后置依赖**：路由层需引用完整的 UseCase，而非直接用 Service/Repository | **依赖关系** |

### 结论：**必须先完成基础设施对齐，再进行 Phase 2.3 和 Phase 4**

**执行策略：**
1. **暂停当前 CLEANUP_PLAN 的 Phase 2.3/4**
2. **新建基础设施对齐计划并行执行**（Phase A→B→C→D）
3. **完成后再回收 CLEANUP_PLAN 剩余阶段**

---

## 6. 预估工时

| 阶段 | 工时 | 并行度 |
|------|------|--------|
| Phase A 端口补全 | 1 周 | 1 人 |
| Phase B 实现补全 (32 表) | 2 周 | 2-3 人可并行 |
| Phase C UseCase 补全 (8 个) | 1 周 | 1-2 人 |
| Phase D 类型同步 | 0.5 周 | 1 人 |
| **总计** | **4.5 周** | 可压缩至 3 周 (3 人并行) |

---

## 7. 立即行动建议

1. **创建独立计划文件**：`docs/04-workflows/INFRA_ALIGNMENT_PLAN.md`
2. **创建任务追踪**：GitHub Issues 或本地任务列表
3. **先做 Phase A.1-A.3**（端口+基类），解除后续阻塞
4. **同步更新 CLEANUP_PLAN**：标记 Phase 2.3 为「阻塞等待基础设施对齐」

---

*生成时间：2026-07-13*  
*分析依据：.readonly/unWMS_Full_Init_Schema_V2.1.sql + 当前代码库扫描*