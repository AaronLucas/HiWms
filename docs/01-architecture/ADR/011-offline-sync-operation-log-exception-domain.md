# ADR-011: 离线同步改为操作同步 + 预分工 + 统一异常领域

## 状态
✅ Accepted (2026-07-15)

## 背景

项目原有的 PDA 离线同步设计（`PDA_OFFLINE_SYNC_DESIGN.md` v1.0.0 及配套的 `SQLITE_LOCAL_SCHEMA.md`/`CONFLICT_RESOLUTION_STRATEGY.md`/`SYNC_API_CONTRACT.md`/`DEVICE_PROTOCOL_SPEC.md`）采用的是**状态同步**模型：

- PDA 本地记录"完整的新值或增量" + `_version` 乐观锁版本向量
- 服务端通过一张 20 场景的 OT/CRDT/MANUAL/SERVER_WINS/CLIENT_WINS/LWW 矩阵事后合并冲突
- 任务分配冲突仅在设计文档里以一句"服务端分布式锁"带过，未落地为具体机制
- 异常处理分散在各业务表自己的 `status`/`exception_code`/`error_code`/`difference_reason` 等字段里，互不统一

DBA 团队重新评审后指出：这不是一个"客户端-服务端状态同步"问题，而是**多个独立离线写入方并发操作同一批共享可变资源（库存数量、工单归属）**的问题。用状态合并算法解决这类问题，复杂度和不确定性都偏高（合并矩阵要穷举场景、OT/CRDT 实现和测试成本高、异常表现形式不统一导致运维排查困难）。DBA 交付了新的设计（`unWMS_Offline_Sync_Exception_Domain_V1.sql/.md`），本 ADR 记录采纳该设计的决策。

## 决策

用**操作同步 + 预分工 + 统一异常领域**三个机制替代原有的状态同步 + 冲突合并设计：

1. **操作同步优先于状态同步**：PDA 离线时记录"发生了什么动作"（`sync_events` 幂等收件箱），服务器用现成业务函数重放执行（`fn_apply_sync_event`），不做状态合并。
2. **预分工优先于事后冲突处理**：
   - 能提前切分的资源（绝大多数拣货场景）：`inventory_reservations` 增加 `work_order_id`，波次下发工单时即完成库存预占，冲突从"事后合并"变成"数学上不可能发生"。
   - 无法提前切分的资源：`task_claims` 竞争性在线租约锁（局部唯一索引 `uq_task_claims_active` 保证同一工单同时只有一条 ACTIVE 租约，并发保证依赖数据库唯一约束原子性，不依赖应用层加锁）。
   - `sync_policies` 按 tenant+task_type+zone_type 三维配置 `ALLOW`/`LIMITED`/`ONLINE_ONLY`，决定某类任务该用哪种预分工机制。
3. **强约束不因离线而让步**：库存不允许为负、危险品/冷链合规校验，在线实时与离线补传路径必须走同一套触发器（`fn_trg_enforce_product_constraints`），只是离线补传路径下用自定义 SQLSTATE（`WMS01`）让 `fn_apply_sync_event` 能精确捕获分类，而不是笼统报错。
4. **异常处理只有一套机制**：不论异常来自哪个业务域（库存不足、合规违规、任务租约过期、同步执行失败、直通超时、人工登记的盘点/计费差异等），登记（`fn_raise_exception`）、查看、权限校验、处理（`fn_resolve_exception`）、审计（`exception_events`）全部走 `exception_type_catalog`/`exceptions`/`exception_events` 三张表，不再各表自行发明 status/remark 字段。

受影响的既有决策：本 ADR 是 **ADR-008（PDA 离线优先同步）** 的实现方案升级，不推翻"必须支持离线作业"这一结论本身，只替换其冲突处理策略；ADR-008 保持 Accepted 状态，本 ADR 补充其"如何实现"的细节。

## 后果

### 正面
- **冲突处理复杂度大幅下降**：20 场景 OT/CRDT 矩阵被移除，`CONFLICT_RESOLUTION_STRATEGY.md` 从 563 行精简到约 100 行——因为大部分冲突场景在设计上已不可能发生。
- **异常处理心智负担降低**：一套登记/查看/处理/审计流程覆盖所有业务域，不需要为每个新业务场景发明新的错误表达方式。
- **可验证性提升**：`task_claims` 的并发保证是数据库唯一约束（可测试、可推理），比"服务端分布式锁"这种模糊描述更可靠。
- **合规硬约束不因离线路径而弱化**：无论在线/离线补传，同一触发器把关，只是错误分类方式不同。

### 负面 / 风险
- **本次仅完成设计与文档层面的对齐**（Phase 3/4），数据库迁移脚本、仓储层端口/适配器实现（`IExceptionRepository`/`ISyncEventRepository`/`ITaskClaimRepository`/`ISyncPolicyRepository`/`IDeviceSyncStateRepository`）尚未落地，需在后续 Phase 1-2 完成，且需先解决当前工作区里另一个未提交、编译不通过的 RPC→Repository 重构（Phase 0）之后再叠加。
- **多项参数仍是开放的业务/合规决策**，非本 ADR 能替业务拍板：危险品/冷链任务的 `ONLINE_ONLY` 判定、各任务类型的 `max_offline_duration_seconds` 具体数值、`exception_type_catalog` 权限种子数据、撞单是否影响绩效的具体 KPI 规则——本 ADR 只保证机制就绪、提供安全默认值。
- **`fn_apply_sync_event` 目前只完整实现 `PICK` 一种 action_type**，其余动作类型（PUTAWAY/COUNT 等）的服务端重放逻辑需要在 Phase 1.4（见 `ROADMAP.md`）逐步补齐，短期内 offline 覆盖面有限。

## 参考
- `docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md`（v2.0.0）
- `docs/03-database/SQLITE_LOCAL_SCHEMA.md`（v2.0.0）
- `docs/03-database/CONFLICT_RESOLUTION_STRATEGY.md`（v2.0.0）
- `docs/02-api/SYNC_API_CONTRACT.md`（v2.0.0）
- `docs/02-api/DEVICE_PROTOCOL_SPEC.md`（v2.0.0）
- `docs/03-database/DB_SCHEMA.md` §2.10-2.14, §4（v2.2.0）
