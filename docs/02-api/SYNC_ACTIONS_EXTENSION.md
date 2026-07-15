# unWMS 同步动作扩展（PUTAWAY / COUNT / PACK）—— 设计文档 V1.0

> 依赖：`unWMS_Full_Init_Schema_V2.1.sql` + `unWMS_Offline_Sync_Exception_Domain_V1.sql`  
> 对应 DDL：`unWMS_Sync_Actions_Extension_V1.sql`  
> 面向：系统开发、数据库维护、PDA 客户端开发  
> 文档版本：v1.0　整理日期：2026-07-16

---

## 一、设计背景与核心修复

### 1.1 问题来源
本模块源于开发团队一份 PR（原文件 `003_extend_sync_event_actions.sql`），意图正确但存在：
- 语法错误（`locations.status` 不存在，实为 `is_active`）
- 并发丢单 Bug（`adjust_inventory` 为读改写模式，无锁）
- 表结构引用错误（把 `packing_tasks` 当明细行表，实为任务级汇总）
- 批次/效期信息捕获了却未写入

### 1.2 核心修复：库存原子写入原语
| 问题 | 修复方案 | 验证结果 |
|------|----------|----------|
| `adjust_inventory` 读改写竞争 | 改为 `UPDATE inventory SET quantity = quantity + delta WHERE ... AND quantity + delta >= 0` | 5 路并发扣减精确无误 |
| PICK/PUTAWAY 需要“具体库位+容器+批次”扣减 | 新增 `fn_adjust_inventory_at_location`（按库位/容器/批次维度原子调整） | 并发下精确扣减目标库位库存 |
| 盘点差异核销无批次 | 新增 `fn_reconcile_location_count`（批次无关，核销到该库位最近更新行） | 避免重复行插入 |

---

## 二、PUTAWAY / COUNT / PACK 三个动作

### 2.1 PUTAWAY（上架）
| 修正点 | 说明 |
|--------|------|
| 库位状态字段 | 引用 `locations.is_active`（非 `status`） |
| 批次/生产日期/效期 | 实际写入 `inventory.batch_no`/`mfg_date`/`exp_date` |
| 合规校验 | 完全交给 V2.1 既有 `fn_trg_enforce_product_constraints`，违规抛出 `SQLSTATE 'WMS01'`，由外层统一捕获分类 |

### 2.2 COUNT（盘点）
| 修正点 | 说明 |
|--------|------|
| 容差配置化 | 新增 `inventory_count_policies` 表（租户默认值 + SKU 级覆盖），未配置时保守取 0（差异一律登记异常） |
| 超容差处理 | 差异 ≤ 容差 → 自动过账；> 容差 → 登记 `COUNT_DISCREPANCY` 异常，等待人工复核 |
| 核销原语 | 使用 `fn_reconcile_location_count`（不指定批次，核销到该库位最近更新行） |

### 2.3 PACK（打包/封箱/面单）
| 修正点 | 说明 |
|--------|------|
| 明细追踪表 | 新增 `packing_task_items`（哪个订单行、多少数量、装进哪个箱子） |
| 两种箱模式 | `container_id` 可空：一箱一码（有容器行） vs 同码/批量箱（无容器行，累加同一行） |
| 唯一性去重 | `container_id` 可空 → 两条局部唯一索引分别处理“有箱号/无箱号” |
| 状态联动 | 打包完成时回写 `order_lines.status = 'PACKED'`，`packing_tasks.status = 'COMPLETED'` |

---

## 三、容器身份模型：一箱一码 vs 同码

| 模式 | 适用场景 | 实现 |
|------|----------|------|
| **一箱一码** | 需精确追溯 | 建 `containers` 行，`lpn_code` 为身份证 |
| **同码/批量箱** | 不需个体追溯 | 不建容器行，仅在 `inventory.batch_no` 体现批次数量 |

> `packing_task_items.container_id` 可空，让同一套表结构天然支持两种模式，无需为每种组合单独建模。

**尚未覆盖的两个缺口（供后续评审）**：
1. `fn_logic_stock_allocation` 为凑数跨批次拼单，无“同批次必须保持完整、不可拆分出库”约束
2. `loading_tasks`/`shipping_documents` 目前不引用 `container_id`，如需“箱子身份从打包到装车到发运单据全程可查”，链路目前是断的

---

## 四、统一分发入口

`fn_apply_sync_event` 是**唯一**处理异常捕获的地方，`PUTAWAY`/`COUNT`/`PACK` 三个动作函数内部**不再**各自重复 `WHEN SQLSTATE 'WMS01' / WHEN OTHERS`（原 PR 在三个新函数里各写一遍，这次统一收回外层，减少后续维护“改一处忘三处”风险）。

---

## 五、验证记录

| 场景 | 预期 | 实测结果 |
|------|------|----------|
| 5 路并发扣减库存 | 精确等于预期值 | ✅ 精确无误 |
| PUTAWAY 批次信息写入 | batch_no/mfg_date/exp_date 正确落库 | ✅ |
| REFERENCE_NOT_FOUND 分类 | 缺失 SKU/库位/订单行时正确分类，不再混进 `INVENTORY_SHORTAGE`/`COLD_CHAIN_VIOLATION` | ✅ |
| COUNT 容差内自动过账 / 超容差登记异常 | 两条路径均正确 | ✅ |
| COUNT 不指定批次 | 正确核销到同一行，不产生重复行 | ✅ |
| PACK 两阶段分批打包 | 明细正确合并，完成时联动更新 `order_lines`/`packing_tasks` 状态 | ✅ |
| 未知动作类型 | 被正确拒绝而非报错崩溃 | ✅ |
| 新表 RLS 隔离 | 生效 | ✅ |

---

## 六、部署检查清单

1. 确认 `unWMS_Offline_Sync_Exception_Domain_V1.sql`（Layer 2）已部署  
2. 执行 `unWMS_Sync_Actions_Extension_V1.sql`（本层）  
3. 补充权限种子数据：`packing_task_items` 相关权限、`inventory_count_policies` 管理权限  
4. 确认 `fn_apply_sync_event` 路由表已包含 `PUTAWAY`/`COUNT`/`PACK` 三个分支

---

## 七、版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2026-07-16 | 基于 DBA 重新实现的 PR 重构，修复语法错误/并发丢单/表引用错误，新增原子原语/明细表/容差配置/容器身份模型 | DBA 团队 / 架构组 |

---

*本文档为 PDA 离线同步动作扩展的单一事实来源。任何变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（操作同步整体架构）、`DEVICE_PROTOCOL_SPEC.md`（Outbox 上传载荷结构）、`CONFLICT_RESOLUTION_STRATEGY.md`（结构性冲突预防策略）、`SYNC_API_CONTRACT.md`（`sync_events`/`task_claims`/`sync_policies`/`exceptions` 相关接口契约）。