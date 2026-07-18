# Bug 报告：`sync_events` apply 系函数（`003_extend_sync_event_actions.sql`）

> **状态：已修复并验证（2026-07-19）**——DBA 团队交付 `supabase/migrations/005_concurrency_hardening_V1.sql`
> （`.readonly/unWMS_Concurrency_Hardening_V1.sql`/`.md`）。本地应用该迁移后，本文件下方 Bug A/Bug B
> 对应的两个 `test.fails(...)` 回归探针连续 5 轮整套重跑全部稳定"意外通过"，已改回普通 `test(...)`
> 并入 PR #23，作为长期回归防护。DBA 顺着同一模式（"判断状态"与"转移状态"不在同一条原子语句里）
> 额外排查全部 `.sql` 文件，一并修复了本报告未提及的 `fn_resolve_exception`（更严重——会导致库存
> 复盘收尾动作被执行两次）、`fn_expire_task_claims`、`fn_cross_dock_timeout_sweep` 三处同类问题，
> 详见 `unWMS_Concurrency_Hardening_V1.md`。以下内容保留作为问题原始记录。
>
> **提交给**：DBA 团队
> **发现方式**：给 `SupabaseSyncEventRepository`（Phase 5 P0 第 2 项）补测试覆盖时，用本地一次性 Postgres 沙盒 + 真实并发/边界场景发现，均已复现验证，非推测。
> **对应本次代码改动**：PR #23（`test(sync-events): backfill concurrency coverage for SyncEventRepository`），测试文件 `src/__tests__/integration/sync/fn_apply_sync_event.concurrency.test.ts` 里的两个 `test.fails(...)` 用例分别对应下面两个 bug，作为回归探针——一旦修好，这两个用例会从"预期失败"变成"意外通过"，让 CI 报错提醒把 `test.fails` 改回普通 `test`。
> **本次未直接改动任何 `.sql` 文件**：这两个问题都在 `fn_apply_pick_action`/`fn_apply_putaway_action`/`fn_apply_count_action`/`fn_apply_pack_action`/`fn_apply_sync_event` 函数体内，按项目现行流程（`CLAUDE.md` 暂停节点 14）由 DBA 团队修正、走 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 自查后部署。

---

## Bug A：apply 系函数缺少并发保护，同一事件可被重复应用（对应自查清单第 3 条）

### 问题

`fn_apply_pick_action`/`fn_apply_putaway_action`/`fn_apply_count_action`/`fn_apply_pack_action`（`supabase/migrations/003_extend_sync_event_actions.sql`）判断事件是否可处理时用的是：

```sql
SELECT * INTO v_event FROM sync_events WHERE id = p_event_id AND status = 'PENDING';
IF NOT FOUND THEN
    RETURN 'SKIPPED_NOT_PENDING';
END IF;
```

这是普通 `SELECT`，没有 `FOR UPDATE` 行锁。对同一个 `sync_events` 行发起的两个真实并发请求，都可能在对方提交状态更新之前读到 `status='PENDING'`，双双继续往下执行库存调整，最终各自把事件标成 `APPLIED`——库存被静默重复扣减/调整。

`fn_adjust_inventory_at_location` 内部虽然对 **inventory 行本身**有 `FOR UPDATE`（第 106 行），但这只保证两次调整不会互相覆盖，并不能阻止"同一个逻辑动作被执行两次"——两次调整都会各自成功落地，只是排队执行而不是丢失更新。

### 复现步骤（本地一次性 Docker Postgres，未连生产库）

```sql
-- 1. 建库存 100
INSERT INTO inventory (tenant_id, product_id, location_id, container_id, quantity)
VALUES ('<tenant>', '<product>', '<location>', '<container>', 100);

-- 2. 建一个 PENDING 的 PICK 事件，qty=10
INSERT INTO sync_events (id, tenant_id, device_seq, action_type, payload, captured_at, status)
VALUES ('<event_id>', '<tenant>', 1, 'PICK',
        jsonb_build_object('sku','...','qty',10,'location_id','<location>','container_id','<container>'),
        NOW(), 'PENDING');

-- 3. 两个真并发会话同时执行（用两个 psql 进程 & + wait，不是同一会话里连续两条语句）
SELECT fn_apply_pick_action('<event_id>');  -- 会话 A
SELECT fn_apply_pick_action('<event_id>');  -- 会话 B（几乎同时发起）
```

**实测结果**：两个会话都返回 `APPLIED`；`sync_events.status` 最终是 `APPLIED`（正常，问题不在这个字段）；`inventory.quantity` 最终是 **80**，应为 90。

### 影响面

所有 PDA 离线动作（拣货/上架/盘点/打包）都走这一批函数，是全系统并发最密集的入口。

**已核实的具体触发路径（不是理论推测）**：`POST /sync/events`（`src/apps/device-api/routes.ts` 第 61-114 行）里，`insertBatch` 正确识别出重复提交（第 87 行，靠 `device_id`+`device_seq` 幂等键），但紧接着的 `Promise.all`（第 90-107 行）不区分"刚插入的新事件"和"已存在的重复事件"，对本次请求 `events` 数组里的**每一个** id 都调用了 `applyEvent`——`insertBatch` 的返回值只有 `{inserted, duplicates}` 两个计数，没有告诉调用方具体哪些 id 是重复的，这里也就没法过滤。

设计文档（`unWMS_Offline_Sync_Exception_Domain_V1.md` 背景说明）明确写了"仓库现场网络不稳定，PDA 需要离线操作并本地暂存...联网后与服务端同步"——这正是本系统要专门应对的核心场景。一次再正常不过的"客户端超时后重传同一批事件"（第一次请求服务端其实还在处理，只是客户端等不到响应就重试）就会精确触发：第一次请求里对某个事件的 `applyEvent` 还没跑完，第二次重传对同一个已存在的事件 id 又发起了一次 `applyEvent` 调用，两者形成竞态。这不需要两个独立 worker 进程凑巧撞车，单台设备自己的正常重试行为就够了。

### 建议修复方向（是否采纳、具体写法由 DBA 定）

按自查清单第 3 条的既定原则处理即可（`adjust_inventory` 当年就是这类问题）：
- 把 `SELECT ... WHERE status = 'PENDING'` 改成 `SELECT ... FOR UPDATE`，在同一事务内锁住这一行再判断/更新状态；或
- 直接把状态判断和转移做成原子 `UPDATE sync_events SET status = 'APPLIED' WHERE id = p_event_id AND status = 'PENDING' RETURNING *`，用返回行数判断是否真的抢到了处理权，抢不到直接按 `SKIPPED_NOT_PENDING` 处理，不再往下执行业务逻辑。

### 验证建议

复现步骤已经是现成的并发验证脚本，按清单第 3 条"至少 3-5 个并发请求"的要求，建议在验证时把并发数提到 5，跟 `fn_adjust_inventory_at_location`/`fn_claim_task` 当年的验证方式保持一致。

---

## Bug B：未知 `action_type` 场景没有登记进统一异常领域（对应自查清单第 5 条）

### 问题

`fn_apply_sync_event` 的分发逻辑（同一文件）：

```sql
ELSE
    UPDATE sync_events SET status = 'REJECTED', applied_at = NOW() WHERE id = p_event_id;
    v_result := 'REJECTED_UNKNOWN_ACTION';
END IF;
```

只改了 `sync_events.status`，没有像同一函数里紧挨着的 `WHEN SQLSTATE 'WMS01'`/`WHEN OTHERS` 两个异常分支那样调用 `fn_raise_exception`。`exception_type_catalog` 里已经有语义匹配的现成分类 `SYNC_APPLY_FAILURE`（`WHEN OTHERS` 分支就在用），不需要新增分类，只是这一处分支忘了调用。

### 影响面

设备如果上传了一个系统不认识的 `action_type`（协议不匹配、固件版本问题等，理论上不该发生但值得工程师关注），当前会被静默拒绝——`sync_events.status` 变成 `REJECTED`，但 `exceptions` 表里完全没有记录，`GET /exceptions` 和 `findExceptions()` 都查不到。这类"设备端出了问题"的信号目前完全没有可观测性。

### 复现步骤

同 Bug A 的沙盒环境，插入一条 `action_type = 'MOVE'`（`SyncActionType` 里存在但没有专属 apply 函数）的 `PENDING` 事件，调用 `fn_apply_sync_event`，查 `exceptions` 表按 `source_table='sync_events' AND source_id='<event_id>'` 过滤：查不到任何行。

### 建议修复方向

在 `ELSE` 分支里补一行，与旁边两个异常分支写法保持一致：

```sql
PERFORM fn_raise_exception(
    v_event.tenant_id, 'SYNC_APPLY_FAILURE', 'sync_events', v_event.id,
    format('未知的同步动作类型：%s', v_event.action_type),
    jsonb_build_object('action_type', v_event.action_type, 'payload', v_event.payload)
);
```

---

## 未纳入本报告的相关发现（仅供参考，不需要 DBA 处理）

测试过程中还发现 `SupabaseSyncEventRepository`（TS 应用代码）有 3 处缺陷，均已在 PR #23 里直接修复，不涉及任何 `.sql` 文件，特此说明以免与上面两条混淆：
1. `applyEvent`/`markAsDuplicate`/`retryEvent` 曾用类型断言写入 `sync_events` 表实际不存在的 `error_message`/`result_data` 列，PostgREST 报错被静默吞掉——已删除这些无效写入。
2. `applyEvent` 曾绕开 `fn_apply_sync_event` 统一分发入口、直接调用各专用函数，导致合规/系统异常处理被跳过——已改为统一走 `fn_apply_sync_event`（这本身证明 003 迁移在 SQL 层的设计和实现是对的，是 TS 代码没跟上，不是数据库侧的问题）。
3. `ISyncEventRepository.ts` 的 `SyncEventStatus` 类型定义了 `sync_events.status` CHECK 约束里不存在的 `DUPLICATE`/`IGNORED`——已改为与真实约束一致的 `PENDING/APPLIED/EXCEPTION/REJECTED`。
