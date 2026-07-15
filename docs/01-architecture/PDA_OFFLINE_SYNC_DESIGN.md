# PDA 离线同步协议详细设计

> **版本**: v2.0.0
> **状态**: 草案待评审
> **关联文档**: `ARCHITECTURE.md` (3.4节/ADR-008), `API_SPEC.md` (4.1节), `DEVICE_PROTOCOL_SPEC.md`, `SQLITE_LOCAL_SCHEMA.md`, `CONFLICT_RESOLUTION_STRATEGY.md`, `SYNC_API_CONTRACT.md`

---

## 0. 本次重写说明

本版本由 DBA 团队对 v1.0.0 设计（状态同步 + 版本向量 + OT/CRDT 冲突合并）进行评审后判定不适用于实际业务，提出并交付了一套全新范式的设计，本文档据此**整体重写**，不再是对旧版的增量修订。v1.0.0 中的版本向量、`sync_queue`、OT 变换、CRDT 合并、20 项冲突解决矩阵等内容已被完全取代，详见第 14 节版本变更记录。

---

## 1. 设计目标与核心原则

### 1.1 核心目标

| 目标 | 说明 |
|------|------|
| **离线可用性** | PDA 在无网络覆盖区域仍能完成核心作业（收货/上架/拣选/打包/发货/盘点） |
| **冲突从概率问题变为不可能问题** | 优先通过预分工让操作范围不重叠，而非依赖事后合并算法 |
| **强约束不因离线让步** | 库存非负、危险品/冷链合规等硬约束在任何路径下都不可绕过 |
| **异常处理只有一套机制** | 不论异常来自哪个业务域，登记/查看/权限/处理/审计走同一套流程 |

### 1.2 核心原则

1. **操作同步优先于状态同步**：PDA 离线时记录的是"发生了什么动作"（事件/指令），不是"最终应该是什么状态"。服务器收到动作后，用现成的业务函数重放执行，而不是拿 PDA 的最终值去覆盖数据库。冲突处理退化为"按顺序执行动作"，不需要发明状态合并算法。
2. **预分工优先于事后冲突处理**：能在任务下发那一刻就把资源切成互不重叠的范围，冲突就从概率问题变成不可能发生的问题。事后的冲突/异常机制只兜底处理"计划之外"的真实业务意外，不是主防线。
3. **强约束不因离线而让步**：库存不允许为负、危险品/冷链合规校验，这些硬约束在任何路径（在线实时/离线补传）下都不能被绕过。业务连续性通过"让单个订单/任务进入异常态"来保证，而不是放松约束。
4. **异常处理只有一套机制**：不管异常来自哪个业务域，登记、查看、权限校验、处理、审计都走同一套流程，不再各业务表自行发明一套 status/remark 字段。

---

## 2. 同步架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PDA 端 (离线优先)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────┐   │
│  │ 业务操作层    │──►│ 只读缓存      │   │ Outbox 队列   │──►│ 同步引擎    │   │
│  │ (扫码/确认)   │   │ (参考数据，   │   │ (只追加动作   │   │ (幂等推送、 │   │
│  │              │   │  允许过期)    │   │  日志)        │   │  策略判断)  │   │
│  └──────────────┘   └──────────────┘   └──────────────┘   └─────┬──────┘   │
└──────────────────────────────────────────────────────────────────│──────────┘
                                                                   │ HTTPS
                                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Device API /sync 事件收件箱                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────┐   │
│  │ 认证/限流     │──►│ sync_events   │──►│ fn_apply_    │──►│ 领域业务    │   │
│  │ (Device JWT)  │   │ (主键幂等、  │   │ sync_event    │   │ 函数重放    │   │
│  │              │   │  device_seq) │   │ (按 action_   │   │ (PICK/...)  │   │
│  │              │   │              │   │  type 路由)   │   │            │   │
│  └──────────────┘   └──────────────┘   └──────────────┘   └─────┬──────┘   │
└──────────────────────────────────────────────────────────────────│──────────┘
                                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        主库 + 统一异常领域（影子台账）                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL (RLS)：work_orders / inventory / order_lines / task_claims /   │
│  sync_policies / device_sync_state ◄──► exceptions / exception_events     │
└─────────────────────────────────────────────────────────────────────────────┘
```

与 v1.0.0 的关键差异：不再有"冲突检测引擎 + 合并/写入"环节——服务端收到的是动作指令，交给既有业务函数按顺序重放执行；能提前预分工的资源在波次/任务下发时已经切分完毕，重放阶段天然不会踩到别的工单的数据。

---

## 3. 预分工机制

### 3.1 库存预占精确到工单

`inventory_reservations` 新增 `work_order_id` 列（`FK → work_orders`，`ON DELETE SET NULL`）。波次下发工单时（服务器此时必然在线），服务器应在下发前为该工单要用到的具体库存行创建预占记录。只要预占完成，其他工单（哪怕分配给另一台离线设备）在正常业务逻辑下不会再动这批库存——**冲突从数学上不可能发生，而不是"概率降低"**。

类比：几十年前仓库主管下发纸质拣货单、划定各人负责范围，PDA 只是把它数字化。

```sql
ALTER TABLE inventory_reservations
  ADD COLUMN work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL;
```

### 3.2 订单行新增 EXCEPTION 状态

`order_lines` 状态新增 `EXCEPTION`（CHECK 约束更新为 `PENDING/ALLOCATED/PICKED/PACKED/SHIPPED/CANCELLED/EXCEPTION`），用于库存异常工作流里"订单进异常，但不影响其他订单"（见第 8 节库存异常闭环）。

```sql
ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS chk_order_lines_status;
ALTER TABLE order_lines ADD CONSTRAINT chk_order_lines_status
  CHECK (status IN ('PENDING','ALLOCATED','PICKED','PACKED','SHIPPED','CANCELLED','EXCEPTION'));
```

---

## 4. 竞争性在线锁：`task_claims`

有些任务没法提前切分（比如一个大宗库位可能被多个工单需要）。这类任务改为"必须先在线申领一把短时租约才能开始操作"。

### 4.1 表结构

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `tenant_id` | 租户 |
| `work_order_id` | 目标工单 |
| `claimed_by_user_id` / `claimed_by_device_id` | 领用人/设备 |
| `status` | `ACTIVE` / `RELEASED` / `EXPIRED` |
| `claimed_at` / `expires_at` / `released_at` | 租约生命周期时间戳 |
| `created_at` / `updated_at` | 审计时间戳 |

```sql
CREATE UNIQUE INDEX uq_task_claims_active
  ON task_claims (work_order_id) WHERE status = 'ACTIVE';
```

同一工单同一时刻只能有一条 `ACTIVE` 租约——**并发保证完全依赖数据库唯一约束的原子性，不依赖应用层加锁**。

### 4.2 相关函数

| 函数 | 作用 |
|------|------|
| `fn_claim_task(work_order_id, user_id, device_id, lease_seconds=300)` | 返回 `(success, claim_id, message)`。尝试插入租约，成功即领用成功；因唯一约束冲突而失败时返回明确失败原因，**不抛异常中断调用方**，方便 PDA 直接展示"该任务已被领用" |
| `fn_release_task_claim(claim_id)` | 任务正常完成后主动释放 |
| `fn_expire_task_claims()` | 定时清扫过期租约（建议每 1~5 分钟一次，挂 `pg_cron`）。发现租约到期但工单未完成时，自动把工单标记为 `EXCEPTION` 并登记 `TASK_CLAIM_EXPIRED` 异常（不是简单释放了事） |

这一机制类比"分布式租约锁 / lease-based lock"（类似 Chubby/etcd），用 Postgres 唯一约束 + 过期扫描实现，不需要引入 Redis/ZooKeeper。

---

## 5. 离线策略配置：`sync_policies`

### 5.1 三态枚举

```
offline_mode: ALLOW | LIMITED | ONLINE_ONLY
```

| 取值 | 含义 | 配合的冲突防护机制 |
|---|---|---|
| `ALLOW` | 允许离线，不设强制上限（兜底一个宽松默认值） | 完全依赖预分工，操作范围本来不重叠 |
| `LIMITED` | 允许离线，但超过 `max_offline_duration_seconds` 后 PDA 必须联网才能继续该类任务 | 同上，给"数据可能变旧"设一个容忍上限 |
| `ONLINE_ONLY` | 必须先联网拿到 `task_claims` 租约才能开始 | 竞争性在线锁（第 4 节） |

`sync_policies` 按 `tenant_id + task_type + zone_type` 三个维度配置，维度越具体优先级越高（`priority` 字段兜底手动调整顺序）。`fn_get_sync_policy` 找不到匹配策略时返回安全默认值（`ALLOW` + 8 小时 = 28800 秒），不会因未配置策略导致 PDA 完全无法工作。

### 5.2 需要业务/合规负责人确认的事项（尚未拍板，仅为参考起点）

> 以下数值均为讨论起点，不是最终决策，必须由合规/业务负责人确认后方可落地。

- 危险品/冷链相关的 `task_type`/`zone_type` 组合，建议默认设为 `ONLINE_ONLY`，但最终数值需合规负责人确认。
- 各类任务的 `max_offline_duration_seconds` 起始参考值：
  - 普通拣货/上架/盘点：4~8 小时
  - 危险品/冷链相关任务即使意外走到 `LIMITED`（设计上不应该发生，仅作兜底）：15~30 分钟
  - 直通（cross-dock）相关：参考 `cross_dock_jobs.timeout_at` 现有的分钟级时效
  - 这些数字必须由每个租户根据自己的实际运营节奏调整，不作为全局固定值写死。

---

## 6. 设备同步状态：`device_sync_state`

记录每台设备的 `last_pull_at` / `last_push_at` / `last_applied_seq` / `last_seen_online_at`，供：

- PDA 增量拉取参考数据时用作游标；
- 运维监控"哪些 PDA 长期没同步"；
- 排查纠纷时还原"这台设备最后一次成功同步是什么时候"。

---

## 7. 本地 SQLite 应用层结构（概述）

> 详细字段设计见 `SQLITE_LOCAL_SCHEMA.md`，本节仅概述两类表的职责边界，不在数据库 DDL 范围内。

1. **只读缓存**：联网时拉取的参考数据（分配给本设备的工单、常用商品/库位信息）。允许过期，界面上必须显示"数据同步于 X 分钟前"。
2. **待同步队列（Outbox）**：本地只追加的动作日志，每条须包含：
   - 设备端生成的全局唯一 ID（幂等键）；
   - 本设备单调递增序号 `device_seq`（不依赖设备时钟）；
   - 动作类型 + 结构化参数；
   - 设备本地捕获时间（仅供审计，非权威时间）。

---

## 8. 服务端事件收件箱：`sync_events`

| 字段 | 说明 |
|------|------|
| `id` | 主键，由 PDA 生成，**不使用 DEFAULT**，重复上传同一条记录会被主键约束天然去重（主键即幂等键） |
| `tenant_id` / `device_id` / `operator_user_id` | 归属信息 |
| `device_seq` | `bigint`，配合 `UNIQUE(device_id, device_seq)` 作为第二重防线，同时便于检测"这台设备是否有序列号缺口"（可能意味着丢包） |
| `action_type` | 动作类型 |
| `payload` | `jsonb` 结构化参数 |
| `captured_at` / `received_at` / `applied_at` | 生命周期时间戳 |
| `status` | 生命周期：`PENDING → APPLIED / EXCEPTION / REJECTED` |

```sql
CREATE UNIQUE INDEX uq_sync_events_device_seq ON sync_events (device_id, device_seq);
```

---

## 9. 分发执行：`fn_apply_sync_event`

按 `action_type` 路由到具体处理函数（目前完整实现 `PICK` 通过 `fn_apply_pick_action`，其余动作类型作为可扩展分支）。关键设计：

### 9.1 业务性异常：主动判断后抛出，不是等数据库报错再抓

库存不足在 `fn_apply_pick_action` 里通过**预先查询可用库存主动判断**，判断不足时**完全不执行任何库存写入**，直接登记异常。这是相对早期草稿的重要修正——草稿依赖捕获数据库内部触发的 CHECK 约束报错，这次改成不产生任何非预期报错的显式判断，业务语义更清晰，日志也更干净。

### 9.2 系统级异常：仍依赖捕获，但用自定义 SQLSTATE 精确分类

冷链/危险品合规校验依然由既有的 `fn_trg_enforce_product_constraints` 触发器把关——该触发器在真正的实时在线写入路径上应继续硬拦截，防止错误物理发生；离线补传路径下同一个触发器仍会触发，但现在通过 `RAISE EXCEPTION USING ERRCODE = 'WMS01'` 抛出专属错误码，`fn_apply_sync_event` 能精确捕获并分类为 `COLD_CHAIN_VIOLATION`，而不是笼统地当成"未知系统错误"。

### 9.3 兜底

任何其余未预期的错误，走 `WHEN OTHERS` 兜底，登记为 `SYNC_APPLY_FAILURE`，绝不会让一条坏数据中断整批同步。

---

## 10. 统一异常领域（Exception Domain）

### 10.1 为什么不是简单地"删掉各表的 status，全部改查一张通用表"

各业务表（`work_orders`、`cross_dock_jobs` 等）自身的 `status` 字段仍然保留——它们支撑高频的本表内操作查询（比如"PDA 现在该干什么活"要直接过滤 `work_orders.status='OPEN'`），如果全部改成 join 通用表，会拖慢常规查询、也要重写大量已验证过的业务函数。

统一异常领域的定位是**在各表本地状态之上的一层"影子台账"**：本地字段负责"这一行现在的状态"，`exceptions` 负责"跨领域的统一查看入口 + 权限校验 + 审计 + 恢复流程"。

### 10.2 表结构与生命周期

| 表 | 职责 |
|---|---|
| `exception_type_catalog` | 异常类型元数据（属于哪个域、默认严重度、需要什么权限才能处理）。新增异常类型只需插入一行数据。支持 `tenant_id IS NULL`（全局默认）与按租户覆盖并存 |
| `exceptions` | 统一台账 |
| `exception_events` | 追加型审计轨迹，永不修改，与 `wo_action_logs`/`inventory_history` 同一设计哲学 |

`exceptions` 生命周期：

```
🟡 PENDING_REVIEW（默认起点）
   → 🔴 CONFLICT（处理中发现复杂需要升级，不是所有异常一开始就是红色）
   → 🟢 RESOLVED（已处理） / DISMISSED（已知悉但判定不需要处理，误报，用于统计"多少异常是真问题、多少是误报"）
```

### 10.3 统一入口函数

| 函数 | 作用 |
|---|---|
| `fn_raise_exception` | 统一登记入口，所有业务域触发异常都调用这一个函数 |
| `fn_resolve_exception` | 统一恢复入口，内部顺序执行：权限校验（复用既有 `check_user_permission`）→ 领域专属收尾动作（目前完整实现库存异常闭环，其余类型作为可扩展分支）→ 更新台账状态 → 写审计轨迹。权限不足会直接报错阻止操作 |

### 10.4 已接入统一异常领域的业务域

| 异常类型 | 域 | 默认严重度 | 触发方式 |
|---|---|---|---|
| `INVENTORY_SHORTAGE` | INVENTORY | HIGH | `fn_apply_pick_action` 主动判断触发 |
| `SYNC_APPLY_FAILURE` | SYNC | MEDIUM | `fn_apply_sync_event` 兜底捕获 |
| `COLD_CHAIN_VIOLATION` | COMPLIANCE | CRITICAL | 合规触发器（自定义 SQLSTATE）捕获 |
| `HAZMAT_CONFLICT` | COMPLIANCE | CRITICAL | 同上 |
| `TASK_CLAIM_EXPIRED` | TASK | MEDIUM | `fn_expire_task_claims` 定时巡检触发 |
| `COUNT_DISCREPANCY` | INVENTORY | MEDIUM | 人工发起（当前无自动检测子系统） |
| `CROSS_DOCK_TIMEOUT` | FULFILLMENT | LOW | `fn_cross_dock_timeout_sweep` 定时巡检触发，默认低严重度 |
| `BILLING_DISCREPANCY` | BILLING | MEDIUM | 人工发起（当前无自动稽核逻辑） |
| `MANUAL_REVIEW` | OTHER | LOW | 人工发起的通用兜底类别 |

---

## 11. 库存异常完整闭环

```
服务器发现库存不足
   │  （不写入任何负数据，库存本身不改）
   ▼
生成 INVENTORY_SHORTAGE 异常
   （记录应扣 / 实际可用 / 缺口 / 库位 / 订单行）
   │
   ▼
自动生成 COUNT 类型复盘工单
   （多个主管可见，谁先联网通过 fn_claim_task 认领即由谁处理）
   │
   ▼
对应订单行标记为 EXCEPTION
   （其余订单 / 其他 PDA 操作完全不受影响）
   │
   ▼
主管现场复核
   │
   ▼
通过 fn_resolve_exception 提交确认数量
   │
   ▼
系统自动：
   - 库存修正为确认值（标注为"盘点调整"而非"拣货扣减"，审计上可清楚区分）
   - 订单行解除异常、恢复可继续处理
```

---

## 12. 已知的开放问题

> 本轮设计未强行下结论，以下均为待产品/业务侧决定的事项，不代表已解决。

1. **盘点差异 / 计费异常目前没有自动检测**：`COUNT_DISCREPANCY` 和 `BILLING_DISCREPANCY` 目前只支持人工在 Web 端主动登记，系统本身没有专门的周期盘点子系统或计费稽核逻辑去自动触发它们。这是有意留出的扩展位，不是遗漏。
2. **权限种子数据需要部署时补充**：`exception_type_catalog` 里的 `required_permission_resource`（如 `inventory_exception`、`compliance_exception` 等）需要在部署时往 `permissions`/`role_permissions` 表里补充种子数据并分配给对应角色。这是组织决策，数据库/工程层面不替业务做这个决定。
3. **危险品/冷链的 `requires_online_claim` 默认值需合规负责人确认**（同第 5.2 节）。
4. **撞单是否影响操作员绩效**：已确认的处理原则是**个人劳动记录（PPH 等人效指标）永远从 `wo_action_logs` 原子动作记录计算，不受"工单最终判给谁"这个业务结果影响**；"频繁撞单"应作为运营质量信号（可能反映分工调度本身有问题）单独统计，不直接计入个人绩效扣分项。这一原则已在设计上落实，但具体的 KPI 计算规则仍需 HR/运营侧另行制定。

---

## 13. 部署检查清单

1. 确认底层 V2.1 全量 schema 已在目标环境执行成功。
2. 执行离线同步 + 异常领域扩展迁移脚本。
3. 补充 `permissions`/`role_permissions`/`user_roles` 种子数据，覆盖 `exception_type_catalog` 里列出的各 `required_permission_resource`。
4. 按租户 + 任务类型评审并录入 `sync_policies`（尤其是危险品/冷链相关的 `ONLINE_ONLY` 判定，需合规负责人签字确认）。
5. 把 `fn_expire_task_claims()` 加入定时任务（建议每 1~5 分钟一次）。
6. PDA 客户端按本文档设计实现 Outbox + 只读缓存分离，并接入 `fn_get_sync_policy` 判断当前任务的离线策略。

---

## 14. 版本变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2025-07-11 | 初版：状态同步 + 版本向量 + OT/CRDT 冲突合并、20 场景冲突解决矩阵、`sync_queue` 本地表设计 | 架构组 |
| 2.0.0 | 2026-07-15 | **整体重写，废弃 v1.0.0 的状态同步/版本向量/OT-CRDT 范式**。DBA 团队评审后判定原方案不适用于实际业务需求，改为操作同步范式：预分工优先（库存预占精确到工单）、竞争性在线锁（`task_claims`）、三态离线策略（`sync_policies`）、事件收件箱（`sync_events` + `fn_apply_sync_event`）、统一异常领域（`exception_type_catalog`/`exceptions`/`exception_events`）取代原冲突解决矩阵 | DBA 团队 / 架构组 |

---

*本文档为 PDA 离线同步协议的单一事实来源。任何协议变更需同步更新：`DEVICE_PROTOCOL_SPEC.md`、`SQLITE_LOCAL_SCHEMA.md`、`CONFLICT_RESOLUTION_STRATEGY.md`、`SYNC_API_CONTRACT.md`。*
