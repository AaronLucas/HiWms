# ADR-003: 履约链路设计——波次驱动的六阶段流水线

## 状态
✅ Accepted (2026-07-08)

## 背景
WMS 核心业务是「订单 → 发货」的履约闭环，涉及拣货、分拣、验货、打包、装车、直通等多环节。原有设计缺乏统一流水线抽象，导致：
- 环节间状态流转不清晰，难以追踪全链路进度
- 异常处理分散（拣货异常、分拣异常、验货不合格各自为政）
- 无法复用同一套波次/工单/动作日志模型
- 直通越库作业与常规流程割裂，匹配/超时/降级逻辑分散

## 决策
采用 **波次驱动的六阶段流水线** 作为履约链路统一抽象：

### 六大阶段
```
Wave (波次规划)
    ↓ 释放
Pick (拣货) → work_orders(type=PICK) + wo_action_logs(扫码/移动/确认)
    ↓ 分配
Sort (分拣) → sorting_waves + sorting_tasks + sorting_chutes
    ↓ 验货
Verify (验货) → quality_inspections + inspection_items (WEIGHT/DIMENSION/BARCODE/...)
    ↓ 打包
Pack (打包) → packing_tasks + label_templates + package_specs + consumable_usages
    ↓ 装车
Load (装车) → loading_tasks + vehicles + shipping_documents
    ↓ 发货
Ship (发货/直通) → cross_dock_jobs (可选越库) / 直接发运
```

### 核心设计原则
1. **波次为主线**：`waves` 表贯穿全链路，`wave_order_mapping` 关联订单，`sorting_waves` 继承波次进度
2. **工单为执行单元**：每阶段产出 `work_orders`，类型区分（PICK/SORT/VERIFY/PACK/LOAD），支持父子工单
3. **动作日志为原子证据**：`wo_action_logs` 记录每次扫码、移动、确认，含 `action_type`、`quantity`、`location_id`、`container_id`、`result`
4. **进度聚合自底向上**：工单完成度 → 波次阶段完成度 → 全链路看板（`v_fulfillment_chain_progress`）
5. **异常即工单状态**：EXCEPTION 态触发告警、人工介入、可重试/取消/降级

### 直通越库作为特例并入流水线
- `cross_dock_jobs` 匹配入库单 + 出库单，状态机：MATCHED → STAGING → PICKING → PACKING → LOADING → SHIPPED
- 超时自动降级：`fn_cross_dock_timeout_sweep()` 每 5 分钟跑批，MATCHED/STAGING → FALLBACK
- FALLBACK 后转入常规拣货流水线（重新生成 PICK 工单）

### 关键表/函数对应
| 阶段 | 核心表 | 核心 RPC/触发器 |
|------|--------|----------------|
| Wave | `waves`, `wave_order_mapping` | — |
| Pick | `work_orders(type=PICK)`, `inventory`, `inventory_reservations` | `fn_logic_stock_allocation`, `fn_logic_resolve_blackbox_box` |
| Sort | `sorting_waves`, `sorting_tasks`, `sorting_chutes` | `fn_allocate_chute` |
| Verify | `quality_inspections`, `inspection_items`, `verification_rules` | `fn_verify_weight`, `fn_trg_enforce_product_constraints` |
| Pack | `packing_tasks`, `label_templates`, `package_specs`, `consumable_usages` | — |
| Load | `loading_tasks`, `vehicles`, `shipping_documents` | — |
| Cross-Dock | `cross_dock_jobs`, `inbound_receipts` | `fn_match_cross_dock`, `fn_cross_dock_timeout_sweep` |

## 替代方案评估
| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 各环节独立表/流程 | 简单解耦 | 状态割裂、进度难聚合、复用差 | ❌ |
| 单一巨型订单状态机 | 集中 | 状态爆炸、难扩展新环节 | ❌ |
| **六阶段流水线** | **统一抽象、进度可聚合、异常统一、直通可并入** | **阶段间耦合需约定** | ✅ |

## 后果
- 正面：全链路可视、异常统一入口、新环节可插拔（如增加「贴标」阶段只需加工单类型）
- 负面：跨阶段事务需应用层补偿（无分布式事务）
- 风险：波次释放后取消/修改订单需级联处理 → 需明确「截单时间」截止规则

## 关联
- 实现见 `supabase/migrations/001_initial_schema.sql` §22-§28, §32-§47
- 视图 `v_fulfillment_chain_progress` 聚合全链路进度
- Cron 任务 `cross-dock-timeout-sweep`、`purge-old-action-logs`
