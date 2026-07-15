# ADR-013: 同步动作扩展 — PUTAWAY/COUNT/PACK 原子原语与明细追踪

## 状态
✅ Accepted (2026-07-16)

## 背景

Layer 2（离线同步骨架 + 统一异常领域）仅完整实现了 `PICK` 一个 `action_type`。Layer 3 需补齐 `PUTAWAY`（上架）、`COUNT`（盘点）、`PACK`（打包）三个核心离线动作的服务端完整实现。

原 PR（`003_extend_sync_event_actions.sql`）意图正确但存在：
- 语法错误：引用不存在的 `locations.status`（实为 `is_active`）
- 并发丢单：`adjust_inventory` 为读改写模式，无锁，实测 5 路并发扣减丢单
- 表结构引用错误：把 `packing_tasks` 当明细行表，实为任务级汇总
- 批次/效期信息捕获了却未写入
- 无盘点容差机制，差异一律异常

## 决策

引入三大机制替代原 PR 的易错实现：

### 1. 库存原子写入原语
| 原语 | 用途 | 关键特性 |
|------|------|----------|
| `fn_adjust_inventory_at_location` | PUTAWAY/PICK：按“库位+容器+批次”维度原子调整 | `UPDATE ... SET quantity = quantity + delta WHERE ... AND quantity + delta >= 0` 单条 SQL 完成判断+写入，零竞争窗口 |
| `fn_reconcile_location_count` | COUNT：批次无关的盘点差异核销 | 不指定批次，核销到该库位最近更新行，避免重复行 |

废弃旧 `adjust_inventory` 的读改写模式，所有离线同步落库均走原子原语。

### 2. 打包明细表 `packing_task_items`
| 字段 | 说明 |
|------|------|
| `container_id` 可空 | 支持“一箱一码”（有容器行）与“同码/批量箱”（无容器行，累加同一行）两种模式 |
| 双局部唯一索引 | `(packing_task_id, order_line_id, container_id) WHERE container_id IS NOT NULL` + `(packing_task_id, order_line_id) WHERE container_id IS NULL` —— 正确处理 `NULL` 去重 |

打包完成时联动更新：
- `order_lines.status = 'PACKED'`
- `packing_tasks.status = 'COMPLETED'`

### 3. 盘点容差策略表 `inventory_count_policies`
| 配置层级 | 优先级 | 说明 |
|----------|--------|------|
| 租户默认 | 低 | `inventory_count_policies` 表 `is_default=true` 行 |
| SKU 覆盖 | 高 | 同表 `sku_id` 非空行，优先级高于默认 |

未配置时保守取 0（差异一律登记异常），不自动放行。

### 容器身份模型
| 模式 | 适用 | 实现 |
|------|------|------|
| 一箱一码 | 需精确追溯 | 建 `containers` 行，`lpn_code` 为身份证 |
| 同码/批量箱 | 不需个体追溯 | 不建容器行，仅在 `inventory.batch_no` 体现批次数量 |

`packing_task_items.container_id` 可空，同一套表结构天然支持两种模式。

---

## 后果

### 正面
- 并发丢单彻底消除：原子 `UPDATE ... WHERE quantity + delta >= 0` 替代读改写
- 明细追踪完整：`packing_task_items` 支持一箱一码与同码两种模式，状态联动正确
- 盘点容差可配置：租户/SKU 两级策略，保守默认值避免误放行
- 统一异常入口：`fn_apply_sync_event` 唯一处理异常捕获，动作函数内部不再重复 `WHEN SQLSTATE 'WMS01' / WHEN OTHERS`

### 负面/风险
- 新增 2 表（`packing_task_items`、`inventory_count_policies`）+ 5 函数，需对应端口/实现
- 容器身份模型在 `loading_tasks`/`shipping_documents` 端仍未引用 `container_id`，如需“箱子身份从打包到装车到发运单据全程可查”，链路目前是断的（已记录为已知缺口）
- `fn_logic_stock_allocation` 仍会跨批次拼单，无“同批次必须保持完整、不可拆分出库”约束（如有合规需求需单独加逻辑）

---

## 参考
- `SYNC_ACTIONS_EXTENSION.md`（详细设计）
- `unWMS_Sync_Actions_Extension_V1.sql` / `.md`
- `PDA_OFFLINE_SYNC_DESIGN.md` §9（统一分发入口）