# 唯一追溯策略与无法扫码商品处理设计

> **版本**: v1.0.0
> **状态**: 草案待评审
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`（v2.0.0，统一异常领域机制）、ADR-011、`docs/02-api/SYNC_ACTIONS_EXTENSION.md`（本设计的前置依赖，Layer 3）、`docs/03-database/DB_SCHEMA.md`（字段变更同步维护）、`docs/02-api/DEVICE_PROTOCOL_SPEC.md`

---

## ⚠️ 范围声明（请先读这一段）

- 本文档是**全新设计，当前代码库中没有任何对应实现**——没有表、没有函数、没有迁移脚本。这与 Layer 3（`SYNC_ACTIONS_EXTENSION.md`）不同：Layer 3 至少已经有一份本地起草（且待修复）的迁移脚本；本设计（Layer 4）目前只是文字设计，**本轮不产出、不起草、不执行任何迁移文件**。
- 任何把本设计落地为实际迁移脚本并在环境中执行的动作，都必须先由用户与 DBA 团队协调排期，本文档不代表已获批准部署。
- **部署顺序是硬约束，不是建议**：本层（Layer 4）的迁移会对 Layer 3 的 `fn_apply_putaway_action` 执行 `CREATE OR REPLACE`，在其基础上补充追溯策略校验。这意味着 Layer 4 **必须严格晚于 Layer 3 部署**。顺序一旦搞反，`CREATE OR REPLACE` 不会报任何 SQL 错误，而是静默丢弃 Layer 3 已实现的逻辑——这不是理论风险，而是 DBA 在自己文档 v1.2 → v1.3 版本修订中真实踩过、真实改正过的坑。详见第 8 节部署检查清单。

---

## 1. 问题背景：两种"扫不出码"必须先分清楚

仓库现场经常遇到"这件货扫不出码"的情况，但这句话背后其实是两种完全不同的业务事实，混为一谈会造成实际运营问题：

| 情形 | 本质 | 如果误判会怎样 |
|---|---|---|
| (a) 这类低值商品本来就不要求逐件追溯 | "没有码"是正常状态 | 如果系统看到没码就自动登记异常，操作员会觉得系统在制造不必要的摩擦，现场效率被拖累 |
| (b) 这件商品本应有码，但现场码丢失/损毁 | "没有码"是异常状态 | 如果系统默默放行，高价值商品的可追溯链条就此断裂，后续无法追溯 |

**正确的提问顺序是：先问"这个商品/这个库位的策略要不要求唯一追溯"，只有在策略明确要求追溯、但现场确实拿不出码的情况下，才构成真正的异常。** 如果策略本身不要求追溯，没有码就是正常状态，不应触发任何异常，只需按批次正常记录数量即可。

本设计的核心，就是先把"要不要追溯"这个策略判断显式建模出来（第 2 节），再在此之上分别处理"身份已知只是缺码"（第 3 节，MISSING_LABEL）和"连身份都不知道"（第 4 节，UNIDENTIFIED_GOODS）两条完全不同的闭环路径。

---

## 2. 容器身份来源：区分供应商码与系统生成码

新增字段：

```sql
ALTER TABLE containers
  ADD COLUMN lpn_source VARCHAR(20) NOT NULL DEFAULT 'EXTERNAL'
    CHECK (lpn_source IN ('EXTERNAL', 'SYSTEM_GENERATED'));
```

| 取值 | 含义 |
|---|---|
| `EXTERNAL` | 供应商/上游实际印刷、物理贴在箱子上的码（默认值，覆盖现存全部历史数据） |
| `SYSTEM_GENERATED` | 系统为弥补"现场缺码"内部生成的码（见第 3 节 `fn_generate_internal_lpn`） |

这个字段的意义是让系统能分清"这个码是供应商真实印上去的"还是"系统为了让缺码场景先跑起来而临时生成的"，为后续追溯/审计提供依据，也是 MISSING_LABEL 闭环里"贴标确认"环节校验的基础。

---

## 3. 追溯策略解析：三层，具体覆盖一般

新增函数 `fn_requires_unique_tracking(tenant_id, product_id, location_id)`，按以下优先级解析（优先级从高到低，**任一层判定"需要追溯"即整体判定为需要追溯**——层级越具体，只能让判定更严格，不能让判定变宽松）：

### 3.1 第一层：商品级覆盖

`product_constraints.requires_unique_tracking`（可空布尔）。`NULL` 表示"本商品不覆盖，向下走 ABC 默认值"；显式 `TRUE`/`FALSE` 直接生效。

### 3.2 第二层：库位级强制

```sql
ALTER TABLE locations
  ADD COLUMN force_unique_tracking BOOLEAN NOT NULL DEFAULT FALSE;
```

用于"高价值笼位"这类场景——不论存放的是什么商品，只要落在这个库位就强制要求追溯。**刻意没有提供反方向的机制**（即"这个库位豁免某个本来要求追溯的商品"）：如果允许库位豁免商品级追溯要求，等于让物理分区绕过商品级的风险管控，这在业务上说不通，因此本设计有意不支持这个方向。

### 3.3 第三层：租户级 ABC 分类默认值

```sql
CREATE TABLE tenant_tracking_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  abc_class CHAR(1) NOT NULL CHECK (abc_class IN ('A', 'B', 'C')),
  requires_unique_tracking BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, abc_class)
);
```

系统通过 `fn_get_tenant_abc_tracking_default(tenant_id, abc_class)` 提供**仅 A、C 两档**的建议起始默认值：

| ABC 分类 | 系统建议默认值 | 说明 |
|---|---|---|
| A | `TRUE`（要求追溯） | 高价值/高风险商品，默认从严 |
| B | **无系统默认值** | 见下方说明 |
| C | `FALSE`（不要求追溯） | 低价值商品，默认从简 |

**B 类没有系统默认值是设计讨论中的明确结论**，不是遗漏：B 类默认策略属于运营/业务决策，系统不应替租户做这个判断。如果租户没有显式为 B 配置，解析时**保守回退为"需要追溯"**（宁可多追溯，也不要默默漏追溯）。

> ⚠️ 这个保守回退**不能被当成可以长期维持的正常状态**，必须在上线前检查清单中明确提示：每个租户上线前必须显式为 B 类配置 `tenant_tracking_policies` 记录，否则会一直吃保守默认值，产生不必要的追溯负担却没有真正拍板。见第 8 节。

### 3.4 解析优先级小结

```
商品级覆盖（非 NULL）
   │ 命中则直接生效（可为 TRUE 或 FALSE）
   ▼
库位级强制（force_unique_tracking = TRUE）
   │ 只能让结果变严格：命中则强制 TRUE，不命中不影响其他层判断
   ▼
租户级 ABC 默认值
   │ A→TRUE，C→FALSE，B 无配置时保守回退 TRUE
   ▼
最终结果：以上任一层判定 TRUE，整体即为 TRUE
```

---

## 4. 路径一：MISSING_LABEL——商品身份已知，只是缺容器身份

### 4.1 触发场景

上架时，策略判定该商品/库位需要唯一追溯，但扫码点当下没有可用的箱码。

### 4.2 处理流程

```
上架扫描时发现：策略要求追溯 + 现场无可用箱码
   │
   ▼
先按正常流程记录数量
   （商品和数量是明确的，不含糊，不阻塞下游分配）
   │
   ▼
登记 MISSING_LABEL 异常
   （域 = INVENTORY，默认严重度 = MEDIUM，
    required_permission_resource = inventory_exception）
   │
   ▼
等待后续补贴标签
```

数量先落地、异常单独挂起，这条设计和统一异常领域"业务连续性通过让单个对象进入异常态保证，而不是卡住整个流程"的原则（见 `PDA_OFFLINE_SYNC_DESIGN.md` 1.2 节）是一致的。

### 4.3 闭环恢复：复用统一异常领域审计轨迹，不发明新状态机

| 步骤 | 函数/动作 | 说明 |
|---|---|---|
| 1 | `fn_generate_internal_lpn(exception_id, actor_user_id)` | 生成内部码，格式 `INT-{YYYYMMDD}-{8位随机十六进制}`；创建一条 `containers` 记录，`lpn_source = 'SYSTEM_GENERATED'`；把生成事件追加进 `exception_events`（此时异常仍为 `PENDING_REVIEW`，尚未关闭）。**只在 MISSING_LABEL 异常处理流程内部调用，不作为通用的"生成一个码"工具暴露给正常收货流程使用** |
| 2 | 现场打印并实际贴标 | 纯物理动作，不涉及任何系统调用 |
| 3 | `fn_confirm_label_applied(exception_id, scanned_lpn_code, resolver_user_id)` | 操作员扫描已贴好的标签进行确认；函数校验扫描码是否与步骤 1 生成的码一致，**不一致直接报错**（防止把标签贴错箱子）；只有匹配才会把此前挂起的库存关联到该容器（这次 UPDATE 会同时改变 `container_id`，并按第 5 节的范围扩展一并触发合规校验触发器），并通过统一恢复入口 `fn_resolve_exception` 关闭异常（复用其权限校验 + 审计轨迹，不写一套单独的关闭逻辑） |

---

## 5. 路径二：UNIDENTIFIED_GOODS——连商品身份都无法判断

### 5.1 触发场景与操作员声明的区别

操作员在现场明确宣告"无法判断这是什么"。**这与"扫了一个码但系统查不到对应商品"是完全不同的两回事**——后者是"有信息但信息无效/未收录"，前者是"现场根本没有任何可用信息来判断 SKU"，是操作员的主动声明，不能混淆。

### 5.2 接收

`fn_receive_unidentified_goods(tenant_id, location_id, qty, note, actor_user_id)`：

- 立即把数量暂存进库存，`product_id = NULL`（该字段本来就允许为空，无需改表结构），落在指定库位；
- 登记 `UNIDENTIFIED_GOODS` 异常：域 = INVENTORY，默认严重度 = **HIGH**（比 MISSING_LABEL 的 MEDIUM 更高——这里连基本身份都不确定，风险更大）。

### 5.3 恢复

`fn_identify_unidentified_goods(exception_id, confirmed_product_id, resolver_user_id)`：由主管确认这批货实际是什么，回填 `product_id`。

**这一步会刻意重新触发一次完整的合规校验**（见第 6 节）——因为这批货此前可能一直放在一个位置，而这个位置对"确认后的真实商品"未必合规。

---

## 6. 一个真实发现并修复的 bug：身份确认没有重新触发合规校验

### 6.1 问题

既有（Layer 1）合规触发器 `fn_trg_enforce_product_constraints`（负责校验冷链/危险品库位要求）原本只在 `BEFORE UPDATE OF location_id` 时触发——也就是只有一行记录的库位发生变化时才会重新校验。

但第 5.3 节"回填 `product_id`"的恢复动作**只改 `product_id`，不改 `location_id`**——这意味着触发器在这个路径上从未被真正触发过：主管完全可能把一批无法识别的货确认为冷链/危险品商品，而这批货实际上已经在一个完全不合规的库位放了很久，系统对此毫无察觉。

### 6.2 修复

```sql
-- 触发器范围扩展
CREATE TRIGGER trg_enforce_product_constraints
  BEFORE INSERT OR UPDATE OF location_id, product_id ON inventory
  FOR EACH ROW EXECUTE FUNCTION fn_trg_enforce_product_constraints();
```

将触发范围从"仅 `location_id` 变化"扩展为"`location_id` 或 `product_id` 任一变化都触发"。

### 6.3 验证场景

- 把一批未识别货物误判定为冷链商品，而其当前所在库位实际上不是冷链库位 → 身份确认动作被直接拒绝并报错，迫使主管先把货物物理转移到合规库位，才能再次确认身份。
- 把同一批货确认为一个没有存储限制的普通商品 → 正常通过，异常正常关闭。

这个修复同时也是第 4.3 节步骤 3（`fn_confirm_label_applied` 里 `container_id` 变更引发的 UPDATE）复用同一条触发器路径的原因——两条闭环最终都要接受同一套合规校验，不需要各自重新实现一遍。

---

## 7. DBA 本地验证情况（已完成，落地前仍需正式迁移）

DBA 已在本地 PostgreSQL 16 完成以下验证（均通过，尚未产出正式迁移脚本，见范围声明）：

1. 追溯策略三层优先级全部按预期解析：A/C 系统默认值生效、B 类无默认值时保守回退、租户显式配置生效、商品级覆盖优先于 ABC 默认值。
2. MISSING_LABEL 完整闭环：登记 → 生成内部码 → 错误扫码被正确拒绝 → 正确扫码确认 → 容器正确关联 → 异常关闭。
3. UNIDENTIFIED_GOODS 完整闭环：登记 → 误判定被合规触发器正确拦截 → 正确判定成功并关闭异常。

---

## 8. 部署检查清单（供后续正式排期时使用，本轮不执行）

1. **确认 Layer 3（`docs/02-api/SYNC_ACTIONS_EXTENSION.md`）已先行部署完成**，且其 `fn_apply_putaway_action` 已在目标环境验证通过。**严禁在 Layer 3 之前或与 Layer 3 顺序不明的情况下部署本层**——`CREATE OR REPLACE` 顺序颠倒不会报任何 SQL 错误，会静默丢弃 Layer 3 逻辑，这是 DBA 文档 v1.2→v1.3 修订中真实发生过的错误。
2. 本设计涉及的迁移脚本（`containers.lpn_source`、`locations.force_unique_tracking`、`tenant_tracking_policies` 建表、`fn_requires_unique_tracking`/`fn_get_tenant_abc_tracking_default`/`fn_generate_internal_lpn`/`fn_confirm_label_applied`/`fn_receive_unidentified_goods`/`fn_identify_unidentified_goods`、`fn_trg_enforce_product_constraints` 触发范围扩展、`fn_apply_putaway_action` 的 `CREATE OR REPLACE`）**均尚未起草**，需与 DBA 团队协调后另行编写、评审、执行。
3. 补充 `exception_type_catalog` 种子数据：`MISSING_LABEL`（INVENTORY / MEDIUM / `inventory_exception`）、`UNIDENTIFIED_GOODS`（INVENTORY / HIGH / `inventory_exception`）。
4. **每个租户上线前，`tenant_tracking_policies` 必须显式配置 B 类记录**——系统的保守回退是安全网，不是长期运营模式，不能默认吃保守值上线。
5. 哪些库位需要设置 `force_unique_tracking = TRUE`（例如高价值笼位）属于仓库运营侧的现场配置决策，不是系统默认值，需要在上线前由运营侧盘点确认。
6. 回归验证第 4.3 节、第 5.3 节两条闭环，以及 `fn_apply_putaway_action` 在追溯策略校验叠加后，原 Layer 3 的 PUTAWAY 动作路由逻辑仍然完整可用（重点核对 `CREATE OR REPLACE` 没有意外丢失 Layer 3 分支）。

---

## 9. 版本变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|---|---|---|---|
| 1.0.0 | 2026-07-16 | 初版：唯一追溯策略三层解析（商品覆盖/库位强制/租户 ABC 默认值）、`containers.lpn_source` 供应商码与系统生成码区分、MISSING_LABEL 闭环（记录数量→登记异常→生成内部码→贴标确认→关闭）、UNIDENTIFIED_GOODS 闭环（暂存 NULL 商品→登记异常→身份确认）、修复 `fn_trg_enforce_product_constraints` 未在 `product_id` 变化时重新校验合规的 bug。本设计依赖 Layer 3（`SYNC_ACTIONS_EXTENSION.md`），必须严格晚于其部署 | DBA 团队 / 架构组 |

---

*本文档为唯一追溯策略与无法扫码商品处理设计的单一事实来源。本轮为设计草案，不含可执行迁移脚本；任何落地排期需与 DBA 团队另行协调，并严格遵守"Layer 3 先于 Layer 4"的部署顺序约束。*
