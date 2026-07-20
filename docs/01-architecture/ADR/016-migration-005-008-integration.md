# ADR-016: 迁移 005-008 应用层集成设计（并发加固/跨租户修复/库区序列号追踪/分层存储管理）

## 状态
✅ Accepted（已实施：仓储层集成随本 PR 落地）

## 背景

DBA 团队于 2026-07-20 交付 4 组新迁移（Layer 5-8）。经 `ecc:database-reviewer` /
`ecc:architect` / `ecc:planner` 三轮分析确认：Layer 5（并发加固）与 Layer 6（跨租户
归属修复）只重写了既有 RPC 函数的内部实现，**不改变任何函数签名或返回值契约**；
Layer 7（库区/库位/序列号追踪）与 Layer 8（分层存储管理）引入了真正的新表/新查询
需求。本 ADR 记录后两者的应用层集成方式，以及为什么前两者不需要任何应用层改动。

## 决策 1：Layer 5/6 不需要任何应用层改动

**依据**：全仓库唯一调用 `fn_apply_pick_action`/`fn_apply_putaway_action`/
`fn_apply_count_action`/`fn_apply_pack_action`/`fn_resolve_exception` 的路径是
`SupabaseSyncEventRepository.applyEvent()`，且它只经过 dispatcher
`fn_apply_sync_event`，从不直接调用四个子函数；`applyEvent()` 已经把任何非
`APPLIED` 的终态（含 Layer 6 新引入的 `REFERENCE_NOT_FOUND` 路径）当异常处理，
`PROCESSING`（Layer 5 新增的中间状态）也已经在 TS 侧 `SyncEventStatus` 联合类型里。
`src/core/usecases` 里没有任何 usecase 直接调用这些 RPC。**结论：这两层迁移对
TypeScript 完全透明，唯一需要的动作是重新生成/手工同步 `src/types/database.ts`**
（用于类型层面识别新增的 `PROCESSING` 值，即使运行时逻辑不需要改）。

## 决策 2：序列化商品追踪走独立只读仓储，不新建 usecase、不改写现有写路径

**依据**：`fn_putaway_serialized_unit`/`fn_pick_serialized_unit` 在 SQL 层内部按
`products.is_serial_required` 分流，对外仍然通过既有的
`fn_apply_putaway_action`/`fn_apply_pick_action` 统一入口暴露，返回契约与非序列化
路径完全一致。这意味着 TS 侧的写路径（`applyEvent()`）**不需要感知**这条分支的
存在——继续按现有方式处理即可。

新增的 `IInventoryUnitRepository`（+ `SupabaseInventoryUnitRepository`）定位是**只读
查询仓储**，服务于保修/召回等需要"这个序列号现在在哪、什么状态"的场景（对应
`v_serial_lookup` 视图），不承担任何写职责——写操作留在 SQL 函数内部原子完成，
双向同步会引入不必要的一致性维护成本（这也是 DBA 设计文档里对 `inventory` 与
`inventory_units` 不做双向同步的同一条理由，应用层选择与之对齐，不引入额外抽象）。

**唯一必须的写路径改动**：`device-api/validation.ts` 的 putaway/pick 请求校验此前
没有 `serial_number` 字段——这不是"要不要新建抽象"的架构问题，而是一个纯粹的
端到端连通性缺口：不补这个字段，序列化 SKU 的 `serial_number` 根本无法从设备端
传到 SQL 层，Layer 7 交付的功能会在应用层被悄悄挡住。

## 决策 3：存储管理策略的平台管理员写权限边界，复用现有 RBAC，不新建权限模型

**依据**：`fn_is_platform_admin()` 在 SQL 层就是
`check_user_permission(u, 'platform_storage_policy', 'manage')` 的包装——复用的是
项目已有的 `roles`/`role_permissions`/`user_roles`/`check_user_permission` 体系
（`roles.tenant_id` 本来就允许为空，用于表达"平台级角色"）。应用层对应地：

- `IStorageManagementPolicyRepository` 的写方法（`create`/`update`）**只允许从
  admin-api 调用**——不是因为 TS 层做了权限拦截（真正的边界是 RLS 策略
  `platform_admin_manage_storage_policy`），而是保持"设备端应用不应该知道平台级
  配置存在"这个既有的六边形架构分层原则，device-api 不注册这个仓储的写方法。
- `ITenantResolver` 端口补充声明 `isPlatformAdmin`（此前只有具体实现类有这个方法，
  违反 ADR-007 的端口契约完整性要求，属于顺带修复的技术债，不是本次新增能力）。

## 决策 4：数据库层遗留问题走「Addendum 请求」文档流程，不由应用团队代为决定 SQL 写法

`ecc:database-reviewer` 发现的 4 项问题（RPC 权限收口、`zone_type` 级联触发器、
`daily_summary` 表 `updated_at`、`PROCESSING` 超时清扫）全部是纯 SQL 层问题，
按项目既有的"`.sql` 归 DBA 所有"边界，不由应用团队直接编写 DDL 修复。落地为
`docs/03-database/DBA_ADDENDUM_REQUEST_2026-07-20.md`——给出问题证据、复现步骤、
方向性修复建议，但具体实现与提交仍由 DBA 团队按 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md`
流程完成。这与本项目此前处理"Layer 3/4 部署顺序约束""跨租户归属修复"等历次 DBA
交付问题时的分工模式一致，不是本次新引入的流程。

## 后果

### 正面
- Layer 5/6 零风险接入——不改现有代码即可受益于并发/租户安全修复。
- 序列号追踪功能的应用层改动面被压到最小（一个只读仓储 + 一个校验字段），没有
  引入与现有 `inventory` 聚合模型平行的第二套写路径抽象。
- 平台管理员写权限边界复用现有 RBAC，没有新增独立的权限判断逻辑分支。

### 负面/风险
- `IInventoryUnitRepository`/`IStorageManagementPolicyRepository` 目前只有仓储层，
  还没有对应的 admin-api 路由/usecase 暴露出来（超出本轮范围）——意味着 Layer 8
  的存储用量检查/维护触发目前只能通过直接调用仓储方法测试，没有可操作的管理界面
  入口，需在后续排期中补齐。
- 数据库层 4 项遗留问题在 DBA 处理完成前持续存在（尤其 CRITICAL 的 RPC 权限收口），
  应用团队除了发起请求外无法直接缩短这个窗口。

## 关联文档
- `docs/03-database/DBA_ADDENDUM_REQUEST_2026-07-20.md` —— 决策 4 对应的请求文档
- `docs/03-database/DB_SCHEMA.md` §2.18-2.22、§4 —— Layer 7/8 表/函数文档
- `docs/03-database/REPOSITORY_ROADMAP.md` Phase 8 —— 仓储层实施记录
- `docs/00-project/ROADMAP.md` §1.4.3 —— 任务落地记录
- `docs/01-architecture/ADR/007-hexagonal-ports-adapters.md` —— 决策 3 引用的端口契约原则
- `docs/01-architecture/ADR/014-tracking-policy-missing-label.md` —— Layer 4 同类"应用层零改动"先例

---

*决策者：主工程师 | 状态：已实施 | 记录日期：2026-07-20*
