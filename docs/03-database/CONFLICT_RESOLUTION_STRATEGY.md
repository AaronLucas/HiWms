# 冲突预防与异常处理策略

> **版本**: v2.0.0
> **状态**: 草案待评审
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`（离线同步整体设计）、`SQLITE_LOCAL_SCHEMA.md`（本地表结构）、`SYNC_API_CONTRACT.md`（同步接口契约）

---

## 0. 范式转变说明

v1.0.0 将本问题当作"多客户端与服务端状态同步，事后合并分歧"来设计，产出了一份 20 场景的 OT/CRDT/MANUAL/SERVER_WINS/CLIENT_WINS/LWW 策略矩阵。DBA 团队复核后判定该模型不成立：这从来不是"客户端-服务端状态同步"问题，而是**多个独立离线的操作者并发操作同一批共享可变资源（库存数量、工单归属）**的问题。真正的解法是在资源分配阶段就让冲突结构性地不可能发生，而不是发生之后再去发明合并算法。v2.0.0 是完全重新设计，不兼容 v1.0.0，请勿混用。

### 核心原则

1. **操作同步优先于状态同步**：PDA 离线时记录"发生了什么动作"，服务器用现成业务函数重放执行，而不是拿 PDA 的最终值覆盖数据库。冲突处理退化为"按顺序执行动作"，不需要合并算法。
2. **预分工优先于事后冲突处理**：能在任务下发那一刻就把资源切成互不重叠的范围，冲突就从概率问题变成不可能发生的问题。事后机制只兜底处理"计划之外"的真实业务意外，不是主防线。
3. **强约束不因离线而让步**：库存不允许为负、危险品/冷链合规校验，任何路径都不能被绕过。业务连续性通过让单个订单/任务进入异常态来保证，而不是放松约束。

### 新旧对照

| 旧设计（v1.0.0，已废弃） | 新设计（v2.0.0） |
|---|---|
| 20 场景 OT/CRDT/MANUAL/SERVER_WINS/CLIENT_WINS/LWW 矩阵 | 预分工（机制 1 + 机制 2）让绝大多数冲突不可能发生；剩余场景统一走异常领域 |
| `_version` 乐观锁 + version_vector 逐字段比较 | 操作重放：服务器按业务函数执行动作，不比较状态版本 |
| `sync_conflicts` 表 + 用户手动合并 UI | `exceptions` 统一台账 + 主管处理，是业务决策（如确认盘点数量）而非"合并" |
| "两台 PDA 抢同一工单 → 服务端分布式锁（未具体实现）" | `task_claims` 表 + 局部唯一索引，具体、可靠、可实测 |
| 网络分区期间"乐观执行"，可能导致负库存，事后再报错 | 预占 + 主动判断，库存永不写入负数，不足直接转异常 |

---

## 1. 机制一：库存预占精确到工单（结构性预防）

覆盖绝大多数拣货场景。`inventory_reservations` 新增 `work_order_id` 列。波次下发工单时（此刻服务器必然在线），服务器在下发前为该工单要用到的具体库存行创建预占记录。

预占完成后，其他工单（哪怕分配给另一台离线设备）在正常业务逻辑下不会再动用这批库存——冲突从数学上不可能发生，而不是概率降低。这与几十年前仓库主管下发纸质拣货单、划定各人负责范围是同一件事，PDA 只是把它数字化。

## 2. 机制二：竞争性在线锁 task_claims（覆盖无法提前切分的任务）

用于大宗库位盘点等无法在下发时就切分范围的任务。

- `task_claims` 表上 `work_order_id` + `status = 'ACTIVE'` 有局部唯一索引（`uq_task_claims_active`），同一工单同一时刻只能有一条 ACTIVE 租约。并发保证完全依赖数据库唯一约束的原子性，不依赖应用层加锁。
- `fn_claim_task(work_order_id, user_id, device_id, lease_seconds)`：尝试插入租约，成功即领用成功；因唯一约束冲突而失败时返回明确的失败原因（不抛异常中断调用方），方便 PDA 端直接展示"该任务已被领用"。这就是 v1.0.0 中提到的"服务端分布式锁，先到者得，后到者返回 TASK_ALREADY_ASSIGNED"，现在有了具体、可靠的实现——一条 SQL 唯一约束，而不是模糊的"分布式锁"。
- `fn_release_task_claim`：任务正常完成后主动释放。
- `fn_expire_task_claims`：定时清扫过期租约。发现租约到期但工单未完成时，自动把工单标记为异常并登记进统一异常领域（`TASK_CLAIM_EXPIRED`），不是简单释放了事。

行业对应：分布式租约锁 / lease-based lock（类似 Chubby、etcd 的租约模式），用 Postgres 唯一约束 + 过期扫描实现，不需要引入 Redis / ZooKeeper。

## 3. 机制三：离线策略分级 sync_policies

决定某类任务应当依赖机制一还是机制二、以及允许离线多久。`offline_mode` 取值 `ALLOW | LIMITED | ONLINE_ONLY`，按 `tenant_id` + `task_type` + `zone_type` 三维配置，维度越具体优先级越高。`fn_get_sync_policy` 找不到匹配策略时返回安全默认值（`ALLOW` + 8 小时）。危险品/冷链相关组合建议默认 `ONLINE_ONLY`，具体判定需合规负责人最终确认，本文档不代为决策。

## 4. 剩余场景：统一异常领域（不是合并，是登记与闭环）

预分工覆盖了绝大多数情况后，仍有三类无法提前消除的"计划之外"场景，统一走异常领域处理，而不是重新发明状态合并算法。

### 4.1 库存不足

尽管已预分工，理论上不应发生，但作为兜底：`fn_apply_pick_action` 主动判断可用库存，不足时完全不写入库存，直接调用 `fn_raise_exception('INVENTORY_SHORTAGE')`，自动生成 COUNT 复盘工单，对应订单行标记 `EXCEPTION`。主管现场复核后通过 `fn_resolve_exception` 提交确认数量，系统自动修正库存（标注"盘点调整"）并解除订单行异常。这是"发现计划外的差异，登记、闭环处理"，不是"合并两个状态"。

### 4.2 合规违规（冷链/危险品）

在线路径由 `fn_trg_enforce_product_constraints` 触发器硬拦截（`RAISE EXCEPTION` with 自定义 SQLSTATE `WMS01`）；离线补传路径下同一触发器仍会触发，`fn_apply_sync_event` 精确捕获该 SQLSTATE 并登记为 `COLD_CHAIN_VIOLATION` / `HAZMAT_CONFLICT` 异常，而不是笼统当成系统错误。合规约束绝不因为离线而放松。

### 4.3 同步执行时的未预期系统错误

`fn_apply_sync_event` 内 `WHEN OTHERS` 兜底捕获，登记为 `SYNC_APPLY_FAILURE`，绝不让一条坏数据中断整批同步。

### 4.4 异常生命周期

不再有 `sync_conflicts` 表和用户手动选择合并策略的 UI 流程。任何"计划之外"的情况统一走 `exceptions` + `exception_events` + `exception_type_catalog`：

登记（`fn_raise_exception`）→ 查看（管理端异常列表）→ 权限校验 + 处理（`fn_resolve_exception`，内部含权限校验 → 领域收尾动作 → 状态流转 → 审计轨迹）

状态流转：`PENDING_REVIEW` → `CONFLICT`（处理中发现更复杂情况时升级）→ `RESOLVED` / `DISMISSED`（误报）

---

## 5. 已知开放问题

如实登记，不下结论：

- 危险品/冷链的 `ONLINE_ONLY` 判定、各任务 `max_offline_duration_seconds` 具体数值，需合规负责人/租户运营侧确认。
- 撞单（`task_claims` 竞争失败）是否影响操作员绩效：已确认 PPH 等人效指标从 `wo_action_logs` 原子动作记录计算，不受工单最终判给谁影响；频繁撞单作为运营质量信号单独统计，不计入个人绩效；具体 KPI 规则仍需 HR/运营侧制定。

---

## 6. 版本变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 2.0.0 | 2026-07-15 | 完全重写，替换 v1.0.0 的 20 场景 OT/CRDT/MANUAL/SERVER_WINS/CLIENT_WINS/LWW 矩阵与严重度分级。改为预防优先模型：机制一（库存预占精确到工单）+ 机制二（task_claims 竞争性在线锁）+ 机制三（sync_policies 离线策略分级），剩余场景统一并入 exceptions 异常领域。v1.0.0 内容不再适用，废弃 `sync_conflicts` 表与冲突解决 UI 设计 | DBA 团队 |
| 1.0.0 | 2025-07-11 | 初版：20 场景矩阵、OT/CRDT/LWW 算法、工作流、UI 规范、监控指标（已废弃） | 架构组 |

---

*本文档为冲突预防与异常处理策略的单一事实来源。任何策略变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（离线同步整体设计）、`SQLITE_LOCAL_SCHEMA.md`（本地表结构、是否需要 sync_conflicts 表已确认不需要）、`SYNC_API_CONTRACT.md`（同步接口契约、异常响应结构）。*
