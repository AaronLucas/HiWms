# WMS V2.1 Schema 迁移执行计划

> **版本**: v1.0  
> **创建日期**: 2026-07-08  
> **依据**: `.readonly/unWMS_Full_Init_Schema_V2.1.sql` + `.readonly/unWMS_Setup_Cron_Jobs_V2.1.sql` + `.readonly/unWMS_Full_Init_Schema_V2.1.md`  
> **目标**: 将当前分散的 3 个历史迁移文件替换为单一、生产就绪的 V2.1 全量初始化脚本，并同步文档、类型定义、CI 验证流程  
> **前提**: 项目处于开发阶段，**无线上历史数据迁移问题**，仅需保证本地/CI 环境可复现、可验证、可回滚

---

## 🎯 总体策略

| 原则 | 说明 |
|------|------|
| **全量初始化** | V2.1 是 `CREATE TABLE IF NOT EXISTS` 全量脚本，配合 `supabase db reset` 使用，非增量迁移 |
| **分阶段验证** | 4 个阶段，每阶段有明确验收标准，**你确认"继续"才进入下一阶段** |
| **随时可回滚** | 每阶段失败均有 < 1 分钟回滚路径（git checkout / supabase db reset） |
| **零生产风险** | 仅操作本地开发库（`--local`）与 CI Preview Branch |
| **单一事实来源** | 迁移脚本、TypeScript 类型、DB_SCHEMA.md、API_SPEC.md 全部从 V2.1 SQL 导出/同步 |

---

## 📦 交付物清单

| # | 交付物 | 位置 | 产生阶段 |
|---|--------|------|----------|
| 1 | 统一初始化迁移脚本 | `supabase/migrations/001_initial_schema.sql` | 阶段 1 |
| 2 | 本地数据库验证报告 | 控制台输出 + 此文件 `验证记录` 章节 | 阶段 2 |
| 3 | 核心 RPC 冒烟测试通过记录 | 控制台输出 | 阶段 3 |
| 4 | TypeScript 数据库类型 | `src/types/database.ts` | 阶段 4 |
| 5 | 同步后的 DB_SCHEMA.md | `docs/03-database/DB_SCHEMA.md` | 阶段 4 |
| 6 | 种子数据脚本 | `supabase/seed.sql` | P1 任务 |
| 7 | 更新后的 ROADMAP.md | `docs/00-project/ROADMAP.md` | P1 任务 |
| 8 | 同步后的 API_SPEC.md | `docs/02-api/API_SPEC.md` | P1 任务 |
| 9 | ADR 记录 | `docs/01-architecture/ADR/` | P1 任务 |

---

## 🚀 执行阶段详细步骤

### 阶段 0：快照与基线（预计 30 秒）

**目的**: 建立可回滚基线，记录当前状态

| 步骤 | 命令 | 预期结果 | 验收标准 |
|------|------|----------|----------|
| 0.1 | `cp -r supabase/migrations supabase/migrations.backup.$(date +%s)` | 备份目录创建 | `ls supabase/migrations.backup.*` 存在 |
| 0.2 | `supabase db dump --schema-only --local > /tmp/schema_before.sql 2>/dev/null \|\| true` | 当前 schema 导出 | 文件非空 |
| 0.3 | `psql -h localhost -p 54322 -U postgres -d postgres -c "\dt" 2>/dev/null \| head -50` | 当前表列表 | 显示现有表 |

**回滚**: 无需回滚，仅只读操作

---

### 阶段 1：替换迁移脚本（预计 10 秒）

**目的**: 用 V2.1 全量脚本替换 3 个历史碎片文件

| 步骤 | 命令 | 预期结果 | 验收标准 |
|------|------|----------|----------|
| 1.1 | `rm supabase/migrations/*.sql` | 旧文件删除 | 目录为空 |
| 1.2 | `cp .readonly/unWMS_Full_Init_Schema_V2.1.sql supabase/migrations/001_initial_schema.sql` | 新脚本就位 | 文件存在、大小 ~93KB |
| 1.3 | `supabase migration list` | CLI 识别迁移 | 输出包含 `001_initial_schema.sql` |

**验收标准**: ✅ 文件替换完成，CLI 识别通过

**回滚**: `git checkout supabase/migrations/` （< 5 秒）

---

### 阶段 2：本地重建与结构验证（预计 2-3 分钟）

**目的**: 完全重建本地数据库，验证所有表、约束、触发器、RLS、函数、视图

| 步骤 | 命令/操作 | 预期结果 | 验收标准 |
|------|-----------|----------|----------|
| 2.1 | `supabase db reset --local` | 数据库重建完成 | 无报错，输出 "Database reset completed" |
| 2.2 | **表数量检查** | 38 个业务表 | `ACTUAL >= 38` |
| 2.3 | **关键表结构抽检** (inventory, orders, work_orders, cross_dock_jobs) | 字段与 V2.1 SQL 一致 | 核心字段、索引、约束存在 |
| 2.4 | **RLS 启用检查** | 29 表启用 RLS | `rowsecurity=true` 记录数 >= 29 |
| 2.5 | **CHECK 约束检查** | 20+ 个 `chk_*` 约束 | 覆盖所有状态字段表 |
| 2.6 | **updated_at 触发器检查** | 38 表挂载 `trg_*_updated_at` | 触发器数量 >= 38 |
| 2.7 | **核心 RPC 存在性** | 10 个关键函数存在 | 全部在 `pg_proc` 中找到 |
| 2.8 | **视图检查** | 10 个 `v_*` 视图存在 | 全部在 `information_schema.views` 中 |

**详细验证 SQL 见附录 A**

**验收标准**: ✅ 所有 8 项检查全部通过

**回滚**: 
```bash
git checkout supabase/migrations/
supabase db reset --local
```
（~ 1 分钟恢复到旧迁移状态）

---

### 阶段 3：功能冒烟测试（预计 1 分钟）

**目的**: 验证核心业务函数可正常调用、不报错

| 步骤 | 操作 | 预期结果 | 验收标准 |
|------|------|----------|----------|
| 3.1 | 运行种子数据（需先创建 `supabase/seed.sql`） | 测试数据就绪 | 无报错 |
| 3.2 | `SELECT fn_current_tenant_id();` | 返回 NULL（本地环境） | 执行无异常 |
| 3.3 | `SELECT fn_get_active_billing_rule('00000000-0000-0000-0000-000000000000');` | 返回 JSONB_FALLBACK 行 | 执行无异常 |
| 3.4 | 验证 `fn_trg_enforce_product_constraints` 触发器生效 | 插入违规库存报错 | 抛出预期异常 |

**验收标准**: ✅ 核心 RPC 可调用、触发器生效、无意外报错

**回滚**: 无数据库变更，仅文件回滚

---

### 阶段 4：同步文档与类型（预计 5 分钟，人工为主）

**目的**: 让代码层、文档层与数据库层保持单一事实来源

| 步骤 | 操作 | 产出 | 验收标准 |
|------|------|------|----------|
| 4.1 | `supabase gen types typescript --local > src/types/database.ts` | TS 类型文件 | 文件生成、含 38 表类型 |
| 4.2 | 重写 `docs/03-database/DB_SCHEMA.md` | 同步后的 schema 文档 | 表结构、索引、RLS、触发器、视图、约束全对齐 V2.1 |
| 4.3 | 更新 `docs/00-project/ROADMAP.md` | 阶段 1.1 ✅、新增子任务 | 反映真实进度 |
| 4.4 | 提交变更 | `git add ... && git commit` | 提交历史可追溯 |

**验收标准**: ✅ 类型文件可编译通过、文档与数据库一致、已提交

---

## 📋 P1 任务（本迭代完成，阶段 4 后并行）

| 任务 | 说明 | 依赖 |
|------|------|------|
| 创建 `supabase/seed.sql` | 系统角色、基础权限、演示租户、默认库位类型、承运商面单模板 | 阶段 2 通过 |
| 同步 `API_SPEC.md` | 新增 V2.1 RPC/REST 端点（`fn_get_active_billing_rule`、`fn_match_cross_dock` 等） | 阶段 4 完成 |
| 新增 ADR 记录 | `ADR-001-multi-tenant-rls.md`、`ADR-002-billing-normalization.md`、`ADR-003-fulfillment-chain-design.md` | 阶段 4 完成 |
| 更新 `CONVENTIONS.md` | 补充数据库命名约定、迁移规范 | 随时 |

---

## 📋 P2 任务（下一迭代，应用层适配）

| 任务 | 说明 |
|------|------|
| RPC 客户端封装 | `src/client/` 或 `workflow-engine/` 统一封装 `supabase.rpc()` 调用 |
| RLS 兼容中间件 | Cloudflare Worker / Express 注入 `x-tenant-id` Header |
| 核心 RPC 单元/集成测试 | Vitest + Supabase Local 覆盖 `fn_logic_stock_allocation` 等 |

---

## 📋 P3 任务（运维与演进）

| 任务 | 说明 |
|------|------|
| Grafana 监控大盘补充 | Cron 任务执行情况、RLS 拦截计数、日志清理行数 |
| 备份恢复演练文档化 | `supabase db dump` / `pg_restore` 流程 |
| 计费规则迁移工具 | JSONB → `billing_rules` 一次性导入脚本 |

---

## 🔄 回滚路径总览

| 当前阶段 | 回滚命令 | 预计时间 | 恢复到状态 |
|----------|----------|----------|------------|
| 阶段 0 | 无需回滚 | - | 原状态 |
| 阶段 1 | `git checkout supabase/migrations/` | < 5 秒 | 3 个历史迁移文件 |
| 阶段 2 | `git checkout supabase/migrations/ && supabase db reset --local` | ~ 1 分钟 | 旧迁移重建的数据库 |
| 阶段 3 | 无数据库变更 | - | 阶段 2 状态 |
| 阶段 4 | `git checkout src/types/database.ts docs/03-database/DB_SCHEMA.md docs/00-project/ROADMAP.md` | < 5 秒 | 文档/类型回滚 |

---

## 📝 验证记录（执行时实时填写）

### 阶段 0 记录
- [ ] 备份目录: `supabase/migrations.backup.XXXXXX`
- [ ] schema_before.sql 大小: ______ bytes
- [ ] 当前表数量: ______

### 阶段 1 记录
- [ ] 旧文件已删除
- [ ] `001_initial_schema.sql` 大小: ______ bytes
- [ ] `supabase migration list` 输出确认

### 阶段 2 记录
| 检查项 | 预期 | 实际 | 通过? |
|--------|------|------|-------|
| 业务表数量 | >= 38 | ______ | [ ] |
| RLS 启用表数 | >= 29 | ______ | [ ] |
| CHECK 约束数 | >= 20 | ______ | [ ] |
| updated_at 触发器数 | >= 38 | ______ | [ ] |
| 核心 RPC 数 | 10 | ______ | [ ] |
| 视图数 | 10 | ______ | [ ] |
| inventory 结构抽检 | - | 见日志 | [ ] |
| orders 结构抽检 | - | 见日志 | [ ] |

### 阶段 3 记录
- [ ] seed.sql 执行无报错
- [ ] `fn_current_tenant_id()` 返回 NULL
- [ ] `fn_get_active_billing_rule()` 返回 fallback
- [ ] 合规触发器拦截违规插入

### 阶段 4 记录
- [ ] `src/types/database.ts` 生成、编译通过
- [ ] `DB_SCHEMA.md` 重写完成、与数据库对齐
- [ ] `ROADMAP.md` 更新完成
- [ ] `git commit` 完成，哈希: ______

---

## 📎 附录 A：阶段 2 详细验证 SQL

```sql
-- 2.2 表数量
SELECT count(*) FROM information_schema.tables 
WHERE table_schema='public' AND table_type='BASE TABLE'
AND table_name NOT LIKE 'pg_%' AND table_name NOT LIKE 'sql_%';

-- 2.3 关键表结构（以 inventory 为例）
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name='inventory' ORDER BY ordinal_position;

-- 2.4 RLS 启用
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname='public' AND rowsecurity=true
ORDER BY tablename;

-- 2.5 CHECK 约束
SELECT conname, conrelid::regclass, pg_get_constraintdef(oid)
FROM pg_constraint WHERE contype='c' AND conname LIKE 'chk_%'
ORDER BY conrelid::regclass, conname;

-- 2.6 updated_at 触发器
SELECT tgname, tgrelid::regclass 
FROM pg_trigger WHERE tgname LIKE 'trg_%updated_at%'
ORDER BY tgrelid::regclass;

-- 2.7 核心 RPC
SELECT proname, prosrc FROM pg_proc 
WHERE proname IN (
  'fn_logic_stock_allocation','fn_match_cross_dock',
  'fn_allocate_chute','fn_verify_weight',
  'check_user_permission','fn_current_tenant_id',
  'fn_cross_dock_timeout_sweep','fn_purge_old_action_logs',
  'fn_get_active_billing_rule','fn_trg_enforce_product_constraints'
)
ORDER BY proname;

-- 2.8 视图
SELECT table_name FROM information_schema.views 
WHERE table_schema='public' AND table_name LIKE 'v_%'
ORDER BY table_name;
```

---

## 📎 附录 B：关键差异对照表（V2.1 vs 旧迁移）

| 特性 | 旧迁移 (3 文件) | V2.1 (单文件) | 影响 |
|------|----------------|---------------|------|
| 权限表 | 缺失 | ✅ 完整 | `check_user_permission` 可运行 |
| order_lines | 缺失 | ✅ 完整 | 直通匹配、订单行状态可用 |
| inbound_receipts | 缺失 | ✅ 完整 | 直通入库单据可用 |
| RLS | 仅注释 | ✅ 全量启用 | 多租户隔离生效 |
| CHECK 约束 | 无 | ✅ 20+ 约束 | 状态值大写强制、脏数据拦截 |
| updated_at | 仅履约链路表 | ✅ 38 表全覆盖 | 核心主数据可审计修改时间 |
| 计费规则 | 仅 JSONB | ✅ 规范化表 + 回退 | 费率可追溯、可版本化 |
| 验货规则 | 单版本 | ✅ 版本化 + 局部唯一索引 | 历史订单可按当时规则复核 |
| 存储合规 | 仅字段 | ✅ 触发器强校验 | 危险品/冷链违规入库直接报错 |
| 直通超时 | 仅字段 | ✅ 定时任务自动降级 | 货物不再无限期滞留 |
| 日志清理 | 无 | ✅ 180 天定时清理 | 免费版 500MB 配额可持续 |
| pg_cron | 注释掉 | ✅ 显式启用 + 异常捕获 | 部署不再遗漏扩展启用 |

---

## ✅ 执行确认流程

```
阶段 0 完成 → 你确认"继续" → 阶段 1
阶段 1 完成 → 你确认"继续" → 阶段 2
阶段 2 完成 → 你确认"继续" → 阶段 3
阶段 3 完成 → 你确认"继续" → 阶段 4
阶段 4 完成 → 标记本计划 "DONE" → 进入 P1 任务
```

**任何阶段失败/中断 → 执行对应回滚 → 记录原因 → 重新评估**

---

*本计划文件随执行进度实时更新，作为唯一执行记录。*