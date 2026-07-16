# 同步动作扩展设计（PUTAWAY / COUNT / PACK）

> **版本**: v1.0.0
> **状态**: 草案待评审
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`（第 9 节 `fn_apply_sync_event`）、`ADR/011-offline-sync-operation-log-exception-domain.md`、`SYNC_API_CONTRACT.md`（3.1.2 节动作类型枚举）、`DEVICE_PROTOCOL_SPEC.md`、`DB_SCHEMA.md`（待同步更新）、`TRACKING_POLICY_MISSING_LABEL.md`（第 4 层，依赖本文档）

---

## 0. 范围声明（请务必先读）

> ⚠️ **本文档仅为设计记录，不代表任何数据库变更已经执行。**

- 本文档描述的是对开发团队已提交的一份本地 PR（本地文件名 `003_extend_sync_event_actions.sql`，因 `supabase/` 目录已加入 `.gitignore`，从未进入 git 历史）的**修正性重新实现**，而不是一次全新的功能设计。原 PR 试图实现 `PUTAWAY`/`COUNT`/`PACK` 三种动作类型的服务端处理逻辑（在此之前，`fn_apply_sync_event` 只完整实现了 `PICK`，其余类型统一返回 `REJECTED_UNKNOWN_ACTION`，见 `SYNC_API_CONTRACT.md` 3.1.2 节）。
- DBA 团队通过**直接阅读原 PR 本地文件**（非道听途说）逐行核实，确认了本文档第 1～7 节所述的全部问题（语法错误、字段引用错误、表粒度错误、硬编码容差、异常分类错误，以及一个更严重的、在 `adjust_inventory` 中早已存在的并发写入竞态问题）。
- **本轮工作只是文档撰写**：对应的本地迁移文件**尚未被修正/替换**，其中所述 bug 目前仍然原样存在于本地文件中；`supabase/migrations/` 目录未被触碰，数据库中未执行任何新脚本。任何实际的修正与执行，都需要用户先与 DBA 团队协调后另行推进，本文档不构成该协调的替代品。
- 部署顺序要求：本层（第 3 层）必须严格晚于第 2 层（`PDA_OFFLINE_SYNC_DESIGN.md` 描述的离线同步 + 统一异常域）部署；`TRACKING_POLICY_MISSING_LABEL.md` 描述的第 4 层（追踪策略 + 缺失标签处理）必须严格晚于本层部署——详见第 8 节。

---

## 1. 背景与问题清单

原 PR 的目标是让 `fn_apply_sync_event` 从"只认识 `PICK`"扩展为同时支持 `PUTAWAY`（上架）、`COUNT`（盘点）、`PACK`（打包）。DBA 评审后确认以下真实问题：

| # | 问题 | 位置 | 严重程度 |
|---|------|------|----------|
| 1 | 字面语法错误：函数体内大量应为语句结束分号 `;` 的地方被误写成句号 `.`（例如 `END IF.` 应为 `END IF;`，`RETURN 'EXCEPTION_RAISED'.` 缺少正确的语句终止符），无法通过编译 | `fn_apply_pack_action` | 阻断性（不可执行） |
| 2 | 错误的字段引用：引用了不存在的 `locations.status`，实际列名为 `locations.is_active`（boolean） | `fn_apply_putaway_action` | 阻断性 |
| 3 | 错误的表粒度：把 `packing_tasks`（任务级/汇总表）当作明细行表使用，引用了该表上并不存在的 `order_line_id`/`container_id`/`sku`/`qty`/`weight` 等列 | `fn_apply_pack_action` | 阻断性 |
| 4 | 硬编码容差：盘点差异判断使用写死的 `0.01`，不可配置 | `fn_apply_count_action` | 功能缺陷 |
| 5 | 异常分类错误："SKU 不存在"/"库位不存在"被误标为 `INVENTORY_SHORTAGE` 或 `COLD_CHAIN_VIOLATION`，污染这两个异常类型的统计口径 | 三个新动作函数 | 数据质量问题 |
| 6 | **更严重的既有 bug**：`adjust_inventory`（自第 2 层起就被 `PICK` 使用，即将被 3 个新动作类型共同调用，风险随调用面扩大而放大）采用"先 SELECT 当前值、应用层计算、再 UPDATE"模式，无任何锁保护 | `adjust_inventory`（既有函数） | 严重（数据正确性） |

第 6 项已用真实并发测试复现：初始库存 100，两个并发请求分别扣减 10 和 15，正确结果应为 75，实际观测结果为 85（其中一次写入被静默丢失）。这是本轮修正中优先级最高的问题——即便只看 `PUTAWAY`/`COUNT`/`PACK` 三个新动作本身的正确性，也必须先解决底层原子写入原语，否则新增的调用方只是在放大一个已存在的坑。

---

## 2. 原子库存写入原语（本次修正的地基）

### 2.1 `adjust_inventory`（既有函数，签名不变，内部重写）

保留原有签名以兼容 `fn_confirm_inventory_recount` 等第 2 层既有调用方，内部实现改为单条原子语句：

```sql
UPDATE inventory
SET quantity = inventory.quantity + delta
WHERE id = (SELECT id FROM inventory WHERE ... FOR UPDATE)
  AND quantity + delta >= 0
```

行锁获取（`FOR UPDATE`）、非负校验、写入三者合并为同一条 SQL 语句执行，中间不存在其他事务可插入的间隙。已验证：5 个并发请求得到的是按正确串行顺序推演出的精确结果，而不是任意的中间态。

### 2.2 `fn_adjust_inventory_at_location`（新增）

比 `adjust_inventory` 更精确的原语，作用于具体的"商品 + 库位 + 容器 + 批次"组合，而非"该 SKU 最近更新的一行"。

**为什么需要**：`PICK`/`PUTAWAY`/`COUNT` 需要对"操作员实际扫描到的这个具体库位"生效，而不能让系统静默地选中另一个库位/批次去顶替。

**语义**：
- `p_delta >= 0`（入库/盘点盈余）：原子地对匹配行做增量更新；若不存在匹配行则新建一行。
- `p_delta < 0`（出库/盘点短缺）：只对已存在的匹配行做减量，要求减量后结果非负；若找不到匹配行或数量不足，**不写入任何数据**，返回空结果集（NOT FOUND）——是否将"库存不足"转入统一异常域，由调用方决定，而不是抛出异常中断。

**设计说明（澄清一个容易混淆的边界）**：既有的 `fn_logic_stock_allocation`（第 1 层函数）负责回答**规划**问题——"该派操作员去哪个库位/批次拣货"；而 `fn_apply_pick_action` 负责回答**执行确认**问题——"操作员已经扫描了这个具体库位，确认实际拣了什么"。这是两个不同的关注点，不应混为一谈：事件 payload 里的 `location_id` 是操作员实际扫描到的库位，不是需要重新通过分配逻辑再推导一遍的东西。

### 2.3 `fn_reconcile_location_count`（新增）

批次无关的库位级对账原语，专为 `COUNT` 而设计。

**发现的真实 bug**：如果盘点差异不指定批次（现实中很常见——"盘这整个库位"通常不区分批次）时用 `fn_adjust_inventory_at_location` 去调账，会因为无法匹配已存在的"批次 = NULL"那一行，转而**新建一行空批次库存**，导致同一库位+SKU 出现两条互相矛盾的库存行。

**处理方式**：专门处理"批次未知，只知道库位级总差异"的场景：
- 盈余：对账进该库位**最近更新的一行**（不存在则新建）；
- 短缺：从该库位最近更新的一行扣减（数量不足则视为真实短缺）。

若盘点场景**能**明确批次，仍应优先使用 `fn_adjust_inventory_at_location` 以获得更高精度。

---

## 3. 盘点容差可配置化：`inventory_count_policies`

替代原 PR 中硬编码的 `0.01`。

### 3.1 表结构

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK→tenants(id) | |
| product_id | uuid | FK→products(id)，可为 NULL | NULL = 该租户的默认容差 |
| tolerance_qty | decimal | NOT NULL DEFAULT 0 | 允许的盘点数量差异 |
| created_at / updated_at | timestamptz | | |

两条局部唯一索引，与 `sync_policies`/`exception_type_catalog` 一致的"具体覆盖通用"模式：

```sql
CREATE UNIQUE INDEX uq_count_policy_tenant_default
  ON inventory_count_policies (tenant_id) WHERE product_id IS NULL;
CREATE UNIQUE INDEX uq_count_policy_tenant_product
  ON inventory_count_policies (tenant_id, product_id) WHERE product_id IS NOT NULL;
```

### 3.2 `fn_get_count_tolerance(tenant_id, product_id)`

查找顺序：商品级覆盖 → 租户默认 → 都未配置时回退为 `0`（安全默认：任何差异都会被判定为异常上报，而不是被静默自动过账）。

---

## 4. 新表 `packing_task_items`（明细行）

原 PR 误把 `packing_tasks`（任务级/汇总表，一个打包任务/波次一行，跟踪箱数、重量体积等聚合信息，见 `DB_SCHEMA.md` §2.x）当作明细行表使用。本表补上真正缺失的部分：一个打包任务里，哪个订单行、装了多少数量、进了哪个容器。

### 4.1 表结构

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK→tenants(id) | |
| packing_task_id | uuid | FK→packing_tasks(id) | |
| order_line_id | uuid | FK→order_lines(id) | |
| product_id | uuid | FK→products(id) | |
| container_id | uuid | FK→containers(id)，**可为 NULL** | 见第 5 节容器身份模型 |
| qty | decimal | NOT NULL | |
| created_at / updated_at | timestamptz | | |

### 4.2 是否启用本表——留给业务决策，不是既定结论

> ⚠️ 本表是否需要被写入，取决于业务需求，本文档不替业务下结论。

- 若打包需要"一箱一码"级别的可追溯性（需要精确知道某个具体物理箱子里装了什么），则本表是必需的。
- 若打包只需要知道"这张订单是否打包完成"而不需要箱级明细，`packing_tasks` 本身的汇总字段已经足够，本表可以不启用。

### 4.3 发现并修正的 bug：`container_id` 可空导致的去重失效

`container_id` 设计上允许为 NULL（很多打包场景不追踪具体箱子——同码/批量容器）。一个朴素的 `UNIQUE(packing_task_id, order_line_id, container_id)` 约束在 `container_id` 为 NULL 时无法用于去重：因为 Postgres 中 `NULL <> NULL`，`ON CONFLICT` 永远不会匹配到 NULL 的那一行，导致同一订单行在两个批次中打包两次时，插入了两条独立的行，而不是累加进同一行。

**修正方式**：与本文档其他地方一致的"两条局部唯一索引"模式：

```sql
CREATE UNIQUE INDEX uq_packing_task_items_no_container
  ON packing_task_items (packing_task_id, order_line_id) WHERE container_id IS NULL;
CREATE UNIQUE INDEX uq_packing_task_items_with_container
  ON packing_task_items (packing_task_id, order_line_id, container_id) WHERE container_id IS NOT NULL;
```

`INSERT ... ON CONFLICT` 根据本次是否提供了 `container_id`，定向命中对应的索引。

---

## 5. 容器身份模型：一箱一码 vs. 同码/批量容器

这是一条贯穿 `PUTAWAY` 与 `PACK` 的概念主线：一个物理箱子是否需要在 `containers` 表中拥有自己独立的一行（自己的 `lpn_code` 身份），取决于"这个具体箱子丢失/被调包"是否需要被单独追溯。

| 模式 | 是否创建 `containers` 行 | 数量如何表达 |
|------|--------------------------|--------------|
| 一箱一码 | 是，`lpn_code` 即其身份 | 该容器行自身 |
| 同码/批量容器 | 否 | 通过 `inventory.batch_no` 表达批量数量 |

`packing_task_items.container_id` 允许为 NULL，使同一张表结构无需按模式分别建模即可同时支持两种场景。

### 5.1 已知但本轮不解决的开放缺口（留待后续评审）

1. `fn_logic_stock_allocation` 目前可能跨多个批次凑齐所需数量——没有"必须保持同批次、不能跨包裹拆分"的约束，这可能影响真实的合规需求（例如同批次药品不得被拆分到不同包裹）。
2. `loading_tasks`/`shipping_documents` 目前都不引用具体的 `container_id`——如果需要"箱子身份从打包→装车→发货单端到端可追溯"，这条链路目前是断的。

---

## 6. 新异常类型：`REFERENCE_NOT_FOUND`

| 字段 | 值 |
|------|-----|
| domain | SYNC |
| default_severity | MEDIUM |
| required_permission_resource | `sync_exception` |

替代原 PR 中把"SKU 不存在"/"库位不存在"误标为 `INVENTORY_SHORTAGE`/`COLD_CHAIN_VIOLATION` 的做法——否则这两个类型原本承载的统计含义（"真实缺货率""真实合规违规率"）会被无关的数据引用完整性噪音污染。

---

## 7. 三个动作函数（修正版）

### 7.1 `fn_apply_putaway_action`

payload：`{sku, qty, location_id, container_id?, batch_no?, mfg_date?, expiry_date?}`

修正点：
- 检查 `locations.is_active = TRUE`（而非原 PR 中不存在的 `.status`）；
- 通过 `fn_adjust_inventory_at_location` 实际写入 `batch_no`/`mfg_date`/`expiry_date`（原 PR 捕获了这些字段但从未使用）；
- 合规校验（冷链/危险品）完全交给既有的 `fn_trg_enforce_product_constraints` 触发器处理，该触发器抛出自定义 SQLSTATE `'WMS01'`，由外层 `fn_apply_sync_event` 统一捕获（见第 7.4 节）。

### 7.2 `fn_apply_count_action`

payload：`{sku, location_id, counted_qty}`

与该库位的系统数量比较，容差通过 `fn_get_count_tolerance` 获取（不再硬编码）：
- **容差范围内**：通过 `fn_reconcile_location_count`（批次无关）自动过账；
- **超出容差**：不自动写入，登记 `COUNT_DISCREPANCY` 异常，交由人工复核，后续通过标准的 `fn_resolve_exception` 统一恢复入口处理（`resolution_action = 'RECOUNT_CONFIRMED'`）。

> 说明：`COUNT_DISCREPANCY` 在第 2 层设计中原本"当前无自动检测子系统，仅支持人工发起"（见 `PDA_OFFLINE_SYNC_DESIGN.md` §10.4、`DB_SCHEMA.md` §2.14）。本层为其新增了一条自动触发路径（超容差盘点自动登记），人工发起路径依旧保留、并不互斥。

### 7.3 `fn_apply_pack_action`

payload：`{order_id, container_id?, sku, qty, package_spec_id?, weight?}`

修正为匹配真实 schema：
- 查找并复用该订单下**进行中**的 `packing_tasks` 行（而非每次都新建一行）；
- 将本次明细记录/累加进 `packing_task_items`（遵循第 4.3 节的可空容器去重修正）；
- 更新任务的汇总字段 `total_weight`；
- **原 PR 完全遗漏的一步**：检查该订单行的累计已打包数量是否已达到目标，达到则将 `order_lines.status` 置为 `PACKED`；当该打包任务下所有订单行均已打包/取消时，将整条 `packing_tasks` 置为 `COMPLETED`。缺少这一步会导致订单行/任务的状态机永久卡死。

### 7.4 统一异常处理保持集中（不再各自为政）

原 PR 让三个新动作函数各自重复实现了一遍 `EXCEPTION WHEN SQLSTATE 'WMS01' / WHEN OTHERS` 处理逻辑。修正版移除了这些重复——只有最外层的 `fn_apply_sync_event` 分发器捕获异常（`WMS01` → `COLD_CHAIN_VIOLATION`，其余 → `SYNC_APPLY_FAILURE`），与第 2 层设计（`PDA_OFFLINE_SYNC_DESIGN.md` §9）的原始意图保持一致。这降低了"改一处、忘改另外三处"的维护风险。

---

## 8. 部署顺序与对第 4 层的影响

本层（第 3 层：同步动作扩展）必须严格晚于第 2 层（离线同步 + 统一异常域，已合并至 main）部署。

`TRACKING_POLICY_MISSING_LABEL.md` 描述的第 4 层（追踪策略 + 缺失标签处理，正在并行撰写）必须严格晚于本层部署，因为第 4 层会用 `CREATE OR REPLACE` 覆盖本层的 `fn_apply_putaway_action`，加入追踪策略检查。**顺序颠倒会导致第 4 层的逻辑被静默丢弃、且不会报错**——`CREATE OR REPLACE FUNCTION` 不会因为"覆盖了一个更旧的版本"而失败或警告。

---

## 9. DBA 本地验证情况（交付本设计前已完成，非本项目内验证）

在本地 PostgreSQL 16 上验证过：

| 场景 | 结果 |
|------|------|
| 5 路并发库存扣减 | 得到精确正确结果 |
| PUTAWAY 写入批次信息 | 正确写入 `batch_no`/`mfg_date`/`expiry_date` |
| "引用不存在"类场景分类 | 正确归入 `REFERENCE_NOT_FOUND`，不再污染 `INVENTORY_SHORTAGE`/`COLD_CHAIN_VIOLATION` |
| COUNT 容差内/外两条路径 | 均正确（容差内自动过账，容差外生成异常） |
| COUNT 不指定批次的对账 | 正确合并进同一行，不再产生重复行 |
| PACK 跨两个批次累加 | 正确累加明细，且完成后正确更新 `order_lines`/`packing_tasks` 状态 |
| 未知 action_type | 干净拒绝，不崩溃 |
| 新增表的 RLS 隔离 | 已验证 |

> 以上验证均为 DBA 团队在其本地环境的独立测试，**不构成本项目内针对实际数据库执行的验证**。本项目内的实际迁移执行与验证仍需按第 0 节所述流程另行推进。

---

## 10. 版本变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2026-07-16 | 初版：作为对开发团队本地 PR（`003_extend_sync_event_actions.sql`，未入库）的修正性设计记录。修正语法错误、`locations.status`→`is_active` 字段引用错误、`packing_tasks` 表粒度误用、盘点容差硬编码、异常分类错误（新增 `REFERENCE_NOT_FOUND`）；修复更严重的既有 `adjust_inventory` 并发写入竞态（改为单语句原子 UPDATE）；新增 `fn_adjust_inventory_at_location`、`fn_reconcile_location_count`、`inventory_count_policies`、`packing_task_items`；统一异常处理收敛回外层 `fn_apply_sync_event`。本轮仅为文档设计记录，未执行任何迁移脚本。 | DBA 团队 / 架构组 |

---

*本文档为"同步动作扩展"（第 3 层）单一事实来源。任何设计变更需同步更新：`DB_SCHEMA.md`（新增表/函数落库文档）、`SYNC_API_CONTRACT.md`（3.1.2 节动作类型状态登记）、`DEVICE_PROTOCOL_SPEC.md`、`TRACKING_POLICY_MISSING_LABEL.md`（第 4 层，依赖本层 `fn_apply_putaway_action`）。*
