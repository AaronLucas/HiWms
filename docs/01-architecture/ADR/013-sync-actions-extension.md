# ADR-013: 同步动作扩展（PUTAWAY/COUNT/PACK）改为修正版重新实现

## 状态
✅ Accepted (2026-07-16) —— **仅为设计决策记录，本地迁移脚本尚未据此修正**

## 背景

Layer 2（离线同步骨架，见 ADR-011）落地后，开发团队提交了一版扩展 `fn_apply_sync_event` 动作路由的 PR，本地文件名为 `supabase/migrations/003_extend_sync_event_actions.sql`（该目录已 `.gitignore`，未进入 git 历史），意图补齐 PUTAWAY（上架）、COUNT（盘点）、PACK（打包）三种动作类型。

DBA 团队评审该 PR 时，直接在本地核对了这份文件，发现**真实存在、已复现的缺陷**，而非潜在风险：
1. `fn_apply_pack_action` 函数体内多处语句结尾的分号被误写成句号（`END IF.`、`RETURN 'EXCEPTION_RAISED'.` 等），**语法层面就无法通过编译**。
2. 引用了 `locations.status`，但该表实际列名是 `is_active`（布尔）。
3. 把 `packing_tasks`（任务级汇总表）当成明细行表使用，引用了该表实际不存在的 `order_line_id`/`container_id`/`sku`/`qty`/`weight` 等列。
4. 盘点容差硬编码 `0.01`，无法按租户/SKU 配置。
5. 把"SKU 不存在"/"库位不存在"误分类为 `INVENTORY_SHORTAGE`/`COLD_CHAIN_VIOLATION`，污染这两个类型本该反映的统计口径。
6. 排查过程中还发现一个更严重、影响面更大的**既有 bug**：`adjust_inventory`（PICK 动作从 Layer 2 起就在用）是"先 SELECT 当前值、应用层算好新值、再 UPDATE"，中间没有加锁；用真实并发测试复现——库存 100，两个并发请求各扣 10 和 15，正确应得 75，实测得到 85，其中一笔被静默覆盖丢失。这个函数马上要被 PUTAWAY/COUNT/PACK 三种新动作共同调用，风险从"影响面小"变成"影响面大"，必须先修。

## 决策

**不是在原 PR 基础上打补丁修复，而是重新实现**，理由：
- 语法错误本身就无法通过评审（无法编译），没有"在此基础上小修"的余地。
- 并发安全问题是地基级别的，必须先重写 `adjust_inventory` 的内部实现（签名不变，保持向后兼容）并新增两个更精确的原子写入原语（`fn_adjust_inventory_at_location`、`fn_reconcile_location_count`），三个动作函数都要基于这套新地基重写，不是逐处小改。
- 借这次重写的机会，把原 PR 里三个动作函数各自重复一份的异常捕获逻辑（`WHEN SQLSTATE 'WMS01' / WHEN OTHERS`）收拢回外层 `fn_apply_sync_event` 统一处理，避免"改一处忘三处"。

具体设计内容见 `docs/02-api/SYNC_ACTIONS_EXTENSION.md`，本 ADR 只记录决策与理由，不重复表结构细节。

## 后果

### 正面
- 库存并发写入从"实测会丢单"变成"5 路并发实测精确无误"，这是本次修正里唯一的正确性硬指标，比其余修正都重要。
- 新增 `inventory_count_policies`（可配置容差）、`packing_task_items`（明细行追踪，含可空 `container_id` 的双局部唯一索引去重模式）、`REFERENCE_NOT_FOUND` 异常类型，修复了原 PR 遗漏的 `order_lines`/`packing_tasks` 状态联动。
- 统一了异常捕获入口，降低后续维护成本。

### 负面 / 风险
- **本次仅是设计决策记录**：本地 `003_extend_sync_event_actions.sql` 现状仍是含 bug 的原始版本，尚未被替换；修正脚本的起草与执行需要用户先与 DBA 团队完成协调确认（详见 `docs/00-project/ROADMAP.md` Phase 1.4.1 的阻塞提示），本 ADR 不代表可以直接动手改脚本。
- `packing_task_items` 是否需要启用取决于业务是否需要"箱级追溯"，这是一个未决的业务问题，本 ADR 不替业务做这个决定。
- **部署顺序约束**：本层必须先于 Layer 4（`ADR-014`）部署——Layer 4 会用 `CREATE OR REPLACE` 重新定义本层的 `fn_apply_putaway_action`，顺序颠倒会导致 Layer 4 的追踪策略判断被静默覆盖且无任何报错。

## 参考
- `docs/02-api/SYNC_ACTIONS_EXTENSION.md`（v1.0.0）
- `docs/03-database/DB_SCHEMA.md` §2.15-2.16、§4（v2.3.0）
- `docs/00-project/ROADMAP.md` §1.4.1
- ADR-011（Layer 2 决策，本 ADR 的前置依赖）
