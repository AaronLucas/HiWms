# unWMS 唯一追踪策略 + 无码/未识别货物处理闭环 —— 设计文档 V1.0

> 依赖：`unWMS_Full_Init_Schema_V2.1.sql` + `unWMS_Offline_Sync_Exception_Domain_V1.sql` + `unWMS_Sync_Actions_Extension_V1.sql`  
> 对应 DDL：`unWMS_Tracking_Policy_Missing_Label_V1.sql`  
> 面向：系统开发、数据库维护、PDA 客户端开发、合规/运营负责人  
> 文档版本：v1.0　整理日期：2026-07-16

---

## 一、核心判断：不是“有没有码”，而是“要不要追踪”

传统做法容易把“无码”直接当异常处理，但这会导致真实的操作矛盾：一批不值钱的大宗货物，入库时本来就没打算贴码追踪，如果系统看到“无码”就一律报异常，操作员会觉得系统在无理由地增加工作量。

正确的判断顺序应该是：**先问“这个商品/这个库位，策略上要不要唯一追踪”，只有“策略要求追踪但现场恰好没有码”才是真正的异常**；策略本来就不要求追踪的，无码是正常状态，直接按批次数量入库，不触发任何异常流程。

---

## 二、追踪策略解析：三层覆盖，具体覆盖笼统

策略解析函数 `fn_requires_unique_tracking`，优先级从高到低：

| 层级 | 配置字段 | 语义 | 说明 |
|------|----------|------|------|
| 1. 商品级覆盖 | `product_constraints.requires_unique_tracking` | 可为空 = 不覆盖 | 单个 SKU 强制要求/豁免追踪 |
| 2. 库位级强制 | `locations.force_unique_tracking`（默认 `FALSE`） | **只能把要求调严，不能调松** | “贵重品笼”不管放什么商品都强制要求追踪；但不存在“让本该追踪的商品免于追踪” |
| 3. 租户 ABC 默认 | `tenant_tracking_policies` | A=追踪 / C=不追踪 / B=**必须显式配置** | B 类不提供系统默认值，租户必须显式配置；未配置时保守按“需要追踪”处理（宁可多贴几个码，不能漏追踪），**不静默生效** |

三层里任意一层判定“需要追踪”，最终结果就是需要追踪（更严格的一方获胜）。

---

## 三、两条完全不同的异常路径

### 3.1 MISSING_LABEL：商品身份明确，只是缺一个容器身份

**触发条件**：入库时按策略判断该商品在该库位需要唯一追踪，但现场没有可用箱码

**处理流程**：
```
入库扫描 → 策略判定需追踪 → 无可用箱码
    │
    ▼
**先按数量正常记账**（商品是谁、多少件明确，不影响后续正常出库分配）
    │
    ▼
登记 MISSING_LABEL 异常（severity = MEDIUM），等待补码
```

**补码闭环**（复用统一异常领域的审计轨迹机制）：
1. `fn_generate_internal_lpn`：系统生成一个内部码（格式 `INT-{日期}-{随机串}`），`containers.lpn_source` 标记为 `SYSTEM_GENERATED`，区别于供应商自带的 `EXTERNAL` 码。生成事件追加进 `exception_events`，此时异常仍是 `PENDING_REVIEW`，还没关闭。
2. 现场打印、贴码——纯物理动作。
3. `fn_confirm_label_applied`：操作员扫描贴好的码来确认，函数会核对“扫到的码是不是刚才生成的那一个”，防止贴错箱子；确认一致后才把暂存的库存正式挂上这个容器，并通过统一恢复入口 `fn_resolve_exception` 关闭异常。

---

### 3.2 UNIDENTIFIED_GOODS：连商品身份都无法确定

**触发条件**：操作员现场明确标记“不知道这是什么”（不是扫到了一个查无此码的码，而是压根没有可用信息判断 SKU）

**处理流程**：
```
操作员标记“未识别”
    │
    ▼
`fn_receive_unidentified_goods` 先按数量暂存进库存
    （`inventory.product_id` 记为 NULL，这个字段本来就是可空的，不需要改表结构）
    │
    ▼
登记 UNIDENTIFIED_GOODS 异常（默认严重度 HIGH，高于 MISSING_LABEL 的 MEDIUM，因为连基本身份都不确定，风险更高）
```

**恢复**：
`fn_identify_unidentified_goods` 由主管确认这批货实际是哪个商品，回填 `product_id`。

---

## 四、一个本轮测试中发现并修复的真实 Bug：识别动作没有触发合规复查

**问题**：`fn_trg_enforce_product_constraints`（V2.1 既有的冷链/危险品合规触发器）原来只在 `BEFORE UPDATE OF location_id` 时触发。但“回填 `product_id`”这个动作只改 `product_id`，不改 `location_id`——也就是说，主管把一批未识别货物确认成某个危险品/冷链商品时，触发器根本不会重新跑，等于合规校验被静默跳过：货物可能已经在一个不该放这类商品的库位待了很久，系统却毫无察觉。

**修复**：把触发器范围扩展为 `BEFORE INSERT OR UPDATE OF location_id, product_id`。

**验证场景**：
| 场景 | 预期 | 实测 |
|------|------|------|
| 未识别货物误判为冷链商品，但实际堆在非冷藏库位 | 识别动作被直接拦下并报错，倒逼主管先把货移到合规库位，再回来确认身份 | ✅ 拦截生效 |
| 未识别货物正确识别为无存储限制的普通商品 | 识别流程正常走通并关闭异常 | ✅ 正常通过 |

---

## 五、验证记录

| 场景 | 预期 | 实测结果 |
|------|------|----------|
| 策略解析三层优先级 | A/C 默认值、B 类未配置保守兜底、租户显式配置生效、SKU 覆盖压过 ABC 默认 | ✅ 全部正确 |
| MISSING_LABEL 完整闭环 | 登记 → 生成内部码 → 错误扫码被拒绝 → 正确扫码确认 → 容器正式挂载 → 异常关闭 | ✅ |
| UNIDENTIFIED_GOODS 完整闭环 | 登记 → 误判被合规触发器拦下 → 正确识别后成功关闭 | ✅ |
| 合规触发器扩展到 UPDATE OF product_id | 识别危险品/冷链商品时自动复查合规 | ✅ |

---

## 六、部署检查清单补充

1. 新租户上线前，必须在 `tenant_tracking_policies` 里为 B 类商品显式配置追踪策略，不能依赖系统的保守兜底值长期运行（兜底值是安全网，不是长期方案）
2. 哪些库位需要设置 `force_unique_tracking = TRUE`（比如贵重品笼），需要仓库运营方按实际情况配置，不在系统默认值范围内
3. 确认 `fn_trg_enforce_product_constraints` 已扩展到 `UPDATE OF product_id`（Layer 4 部署时自动完成）

---

## 七、版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2026-07-16 | 基于 DBA 重新实现，分离“追踪策略”与“无码/未识别货物”两条异常路径，修复识别动作不触发合规复查的 Bug | DBA 团队 / 架构组 |

---

*本文档为唯一追踪策略 + 无码/未识别货物处理的单一事实来源。任何变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（操作同步整体架构）、`DEVICE_PROTOCOL_SPEC.md`（MISSING_LABEL/UNIDENTIFIED_GOODS 相关接口契约）、`SYNC_API_CONTRACT.md`（`sync_events`/`exceptions` 相关接口契约）、`CONFLICT_RESOLUTION_STRATEGY.md`（合规触发器扩展对冲突预防的影响）。