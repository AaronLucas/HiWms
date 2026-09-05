# 货主/仓储运营方分离——设计缺陷与不明晰点分析 V1

> 日期：2026-09-06
> 触发原因：Council 裁决决策1（`WMS7_COUNCIL_INTEGRATION_VERDICT_V1.md`）曾以"行业无先例验证"
> 否决"多货主混放"产品方向。该前提已被推翻：(1) 闭源竞品 GoodCang 已规模化验证此模式；
> (2) 更关键——DBA 团队（`HiWmsSupabase` 仓库）自己的研究检查点文档里，业务方向已由人工
> **正式确认**（`3PL-D001/D002/D009`），且与 GoodCang/Extensiv 的实际结构吻合。
>
> 本文档不重新评价"该不该做"，只回答"现有设计要支撑这个方向，缺什么、哪里不明晰"。
> 方法：4 个独立视角（architect/database-reviewer/Identity & Access Engineer/
> Supply Chain Strategist）并行分析 + 本文对 DBA 侧原始文档的直接核实。

---

## 一、必须先澄清的事实（纠正 council 裁决的错误前提）

### 1.1 Cross-Dock D-Core Phase 4 不是"失败案例"，是"因同一问题被主动暂停"

`HiWmsSupabase/design-docs/unWMS_Cross_Dock_D_Core_Phase4_Atomic_Cutover_V1.md` 头部原文：

> 当前模型仍可能把系统访问 tenant、仓库运营方和库存货主合并为同一概念……
> 在业务模型、只读 schema 审计、威胁/并发原型和兼容迁移路径通过评审前，不得创建 `042`。

暂停原因是**语义未澄清**，不是"混放这个想法本身跑不通"。迁移 `041_cross_dock_d_core_judgment_primitives.sql` 里已经造好的判定原语目前是"孤儿函数"——应用层零接线**是刻意冻结，不是遗漏**。

### 1.2 DBA 侧已有正式研究文档，业务方向部分已由人工确认

`HiWmsSupabase/design-docs/unWMS_3PL_Multi_Party_Fusion_Architecture_V1.md`（2026-08-15，
状态标注 **RESEARCH / DESIGN CHECKPOINT，未批准任何 DDL/RLS/迁移**）：

| 决策 | 状态 | 内容 |
|---|---|---|
| 3PL-D001 | `USER_CONFIRMED` | 现状继续禁止跨 tenant 共享 location 或放宽 RLS（安全冻结维持） |
| 3PL-D002 | `USER_CONFIRMED` | **真 3PL 完整设计做完之后**可支持受控多货主混储 |
| 3PL-D009 | `USER_CONFIRMED` | 目标业务模型：tenant=独立运营仓储实体（登录域+默认计费主体）；tenant 名下可有多个不属于本公司的客户，每个客户是特殊角色的 `user`（非独立顶层账号），只看自己范围内货物；系统由多个这样的 tenant 组成；客户看到的是自己货物的"虚拟聚合状态" |

**关键限定（文档原话，不可省略）**："本决定只是业务方向确认，不代表已经跳过 G2（`001`—`041`
只读 schema 审计）或后续并发/安全原型验证；具体如何在当前 schema 上落地……仍是
`AGENT_PROPOSAL`/`OPEN_QUESTION`，不因这条业务方向确认而自动升级为已解决。"

**已直接核实的现状事实（`3PL-H022`/`E4`，DBA 侧协调者亲自核对 `001`-`041` 迁移得出）**：
当前 schema 是纯单一货权/单一租户模式——`tenant_id` 是唯一归属维度，全仓库无
`customers`/`clients`表，`products`/`inventory`/`orders`/`order_lines`/
`shipping_documents`/`loading_tasks`/`packing_tasks`/`carriers`/`vehicles`
**均无 owner/client 字段**。`3PL-D009` 目标模型在现有 schema 里没有任何对应实现。

**结论**：业务方向"要不要做"这一层，DBA 侧已经拍板，且与 GoodCang/Extensiv 的真实结构吻合，
council 裁决"无先例"的否决前提确实站不住。但"具体怎么落地"这一层，**DBA 侧自己也还没有
答案**（G2 审计未完成，多个 `OPEN_QUESTION`/`OPEN_BLOCKING` 悬而未决）。WMS7 不能越过 DBA
的 schema 设计自行开工，但需要修正自己文档里"禁止预留任何多货主字段或分支"这条已经过时
的硬规矩（`DBA_SYNC_GAP_ANALYSIS_AND_UPGRADE_PLAN_V1.md:509-512,577-578`），并出一份 ADR
正式记录方向已变、以及"WMS7 现在能做什么/不能做什么"的边界。

---

## 二、技术设计缺陷清单（4 视角综合，按撞击顺序）

### 2.1 架构/数据模型层（architect）

1. **端口层身份轴是标量，无第二维插槽**：`ITenantResolver.ts:17-21` 返回单一
   `Promise<string|null>`；47 个 Repository 端口共 189 处 `tenantId` 形参——引入
   owner 需要一次性改签名 + 44 个仓储实现。
2. **RPC 自动注入用子串匹配，是活雷管**：`SupabaseClient.ts:248-257`
   `key.includes('tenant_id')`——一旦出现 `p_owner_tenant_id` 之类的参数名，会被
   静默误注入。
3. **RLS 只能表达一个谓词，且关键表未启用 RLS**：`order_lines`、`wo_action_logs`、
   `inventory_reservations`、`containers`、`inventory_history`、`wave_order_mapping`
   ——这些恰恰是"这批货是谁的"必须落地的行级层，目前完全没有防护。
4. **履约链路（波次/工单/动作日志，ADR-003）owner 维度完全缺失，不是隐含**：
   `fn_logic_stock_allocation` 无 owner 参数，配合 FEFO 索引 `(product_id,
   picking_priority, exp_date)`，混放后必然把 A 货主库存分给 B 的订单。
5. **主数据唯一键会先炸**：`products UNIQUE(tenant_id, sku)`——两个货主用同一
   SKU 编码会被迫共用一行；`orders.external_order_id` 全局唯一（连 tenant 都不含）
   ——多货主各自 ERP 单号必然冲突。
6. **类型系统 drift 会让 owner 列静默失效**：`database.ts` 落后迁移到 026，系统性
   用 `(getClient() as any)` 绕过类型检查——`containers` 表已经因为同样的模式
   造成过真实的 NULL 跨租户漏洞，owner 维度引入会原样重演这个失败模式。

### 2.2 数据库 schema/RLS 层（database-reviewer）

1. **041 迁移的判定函数是 `SECURITY DEFINER`，RLS 对它们形同虚设**——隔离靠函数体
   内硬编码 `tenant_id = v_tenant` 过滤。加 owner 维度不能只在 RLS 策略里加
   `AND owner_id = ...`，必须逐个改写这批函数体，否则 owner 隔离在这批函数上必然
   穿透，且比表级 RLS 漏防更隐蔽、更难发现。
2. **`containers` 表现状印证同一断裂**：036 迁移刚给它补上 `tenant_id`，但当前分支
   `database.ts` 生成的类型里这张表完全没有 `tenant_id` 字段——DB 与类型层的同步
   链路本身就是断的，再叠一层 owner 维度会把同类断层复制一遍，而且 owner 漏判是
   货主能直接感知的"串货"事故，比 tenant 漏判后果更直接、更致命。
3. **计费表零预留**：`billing_rules`/`billing_transactions` 44 次迁移零向 owner
   方向演进，完全没有按货主拆账的字段。

### 2.3 身份/权限层（Identity & Access Engineer）

1. **`users` 表结构锁死"单租户身份"**：`users.tenant_id` 单一外键 +
   `UNIQUE(tenant_id, username)`，一个用户行只能属于一个 tenant。3PL 场景里
   货主/客户理论上可能同时对接多个仓储运营方，当前结构表达不了"一个身份关联
   多个 tenant"。
2. **RBAC 是字符串 scope 匹配，无资源实例维度**：`check_user_permission` 只判断
   "调用者 tenant vs 目标用户 tenant"，完全没有"资源属于哪个 owner"的概念——
   "货主 A 看不到货主 B 库存"需要新增 owner_id 作为真实资源属性并改写 RLS，是
   要素级新增，不是加个配置值。
3. **L0 账号管理缺口与货主体系不是线性叠加**：全仓库搜不到任何用户创建 API——
   目标模型至少需要三层账号管理（平台超管→仓储运营方管理货主→各自管理内部
   用户），是从 0 到 1 做账号系统，不是在现有系统上加一层。
4. **已有失败模式会重演**：`admin-api` 的 `isPlatformAdmin` 漏洞（把租户内布尔
   字段 `is_system_user` 误判为平台级权限）正是"扁平字段冒充多层身份"的真实
   案例——货主如果也用类似的简单字段挂在同一张 `users` 表上，几乎必然重演
   同类漏洞，除非从设计上把身份层级拆成独立实体。

### 2.4 业务/运营层（Supply Chain Strategist）

1. **计费口径要换轨，不是分区**：混放模式行业惯例是"仓储费按占用量日滚动 +
   操作费按动作次数"的双层计价，本质是从"为闲置产能付费"变成"为实际用量付费"
   ——这正好和本项目诊断出的最薄弱环节（计费引擎，零调用）直接相关。
2. **归属追溯靠批次级绑定，不靠物理隔离**：库存账应设计成"货主-SKU-批次-数量-
   货位"的多对多关系，货位只是物理坐标，不是货权依据——这是混放模式成立的
   前提条件，不是可选项。
3. **责任边界要有完整证据链**：每次触碰库存的操作都要留操作人+时间戳+前后
   数量+关联单据，否则纠纷发生时仓储方无法自证清白。
4. **行业打法是"账实分离，以账为准"**：物理层允许混放，系统层给每个货主一个
   逻辑独立的虚拟仓——这与 DBA 侧 `3PL-D009` 第 4 点"虚拟聚合状态"的方向
   一致，互相印证。
5. **业务/运营坑常被低估**：仓储责任险缺失、客户信任基础设施（对账/赔付/
   审计记录）倒挂、加盟仓现场操作水平参差不齐、可能涉及保税仓/监管仓资质
   ——这些不是技术团队规划里天然会想到的。

---

## 三、DBA 侧仍未解决、WMS7 需要一起关注的悬而未决问题

以下是 DBA 研究文档里明确标注 `OPEN_QUESTION`/`OPEN_BLOCKING` 的关键项，落地前
双方都还没有答案，不是 WMS7 单方面欠账：

- **3PL-Q019（OPEN/BLOCKING）**：owner 未知、有争议、标签损坏、盘盈的货由谁保管、
  谁能裁决、怎么计费？现有 schema 连"owner是谁"这个字段都不存在，连"未知"这个
  状态都无法表达。
- **3PL-H018（AGENT_PROPOSAL，未定案）**：RLS 双轴过滤方案——operator 角色按
  facility 过滤（仓内跨 owner 可见），client 角色按 owner_id 过滤（跨仓只看
  自己）——具体走"同表叠两条 USING 分支"还是"独立聚合函数"，仍待 G4/G5 阶段
  确认。
- **G2 审计本身未完成**：DBA 侧已经可以从直接核实（E4）得出"现状确实不符合，
  需要设计迁移路径"这个结论，但完整的引用/RLS/计费审计仍未跑完。

---

## 四、给 WMS7 的建议动作

1. **出一份 ADR，正式撤销"禁止预留任何多货主字段或分支"这条规矩**，并记录
   撤销依据（GoodCang 市场证据 + DBA 侧 `3PL-D001/D002/D009` 已确认的业务方向）。
   这是纠正历史判断，不是新决策。
2. **不要在应用层抢跑写 owner 相关的 schema/RLS 代码**——DBA 侧的 G2 审计和
   H018/H022/Q019 等具体设计问题没有答案之前，WMS7 写出来的东西大概率要推倒
   重来（迁移 041 的判定原语被刻意冻结不接线，就是前车之鉴）。
3. **WMS7 能且应该现在做的**：把本文档第二节列出的技术缺陷清单，同步给 DBA
   团队作为"应用层视角的输入"（他们的审计目前主要是 schema 视角，`users`表/
   RBAC/权限层的问题他们的文档里覆盖较少）——**已提交为
   [HiWmsSupabase#91](https://github.com/AaronLucas/HiWmsSupabase/issues/91)**
   （SECURITY DEFINER 函数/users表锁定/RBAC无资源维度/计费表零owner预留 4点）；
   同时着手准备"账号权限管理 L0"的最简版本设计（仓库经理能给拣货员开号）——
   这件事无论最终 owner 模型定成什么样，都是必须先补的地基，不依赖 owner 设计
   定案。
4. **当前没有真实生产数据**（DBA 侧已核实确认），这是做这类基础性 schema 扩展
   风险最低的窗口期——越往后拖、真实客户数据越多，成本越高，这是这次方向
   反转里少数对项目有利的时间因素。

---

## 五、与已有报告的关系

本文档**修正**（不是推翻）`WMS7_COUNCIL_INTEGRATION_VERDICT_V1.md` 决策1的前提
判断部分（"无先例"不成立），但不改变该决策附带的4个前置条件（修复2个CRITICAL
漏洞/类型系统追平/确认PDA链路状态[已完成]/补充回归测试）——这些前置条件与
owner/tenant 方向无关，依然成立，且情况更紧迫：本文档发现的多处"同一失败模式
会在 owner 维度重演"（containers NULL漏洞模式、admin-api扁平字段冒充身份模式），
说明这些前置条件不修，owner 维度扩展只会把风险敞口再放大一次。
