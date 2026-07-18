# AGENTS.md

## Agents、Skills、MCP 工具体系设计

本文档描述系统的智能代理架构、技能体系、MCP 工具集成及自动化规则。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator (编排器)                      │
│  - 任务分解  - 路由决策  - 上下文管理  - 结果聚合             │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Agent Pool   │ │  Skill Registry │ │  MCP Gateway  │
│ (业务代理)     │ │ (原子技能)      │ │ (外部工具)    │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

## 2. Agent 体系

### 2.1 基础抽象
```typescript
abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly capabilities: string[];  // 能力标签
  
  async execute(task: TaskContext): Promise<AgentResult>;
  async validate(task: TaskContext): Promise<boolean>;
  async compensate(task: TaskContext): Promise<void>;  // 补偿/回滚
}
```

### 2.2 核心 Agent 定义

| Agent | 职责 | 核心能力 | 触发场景 |
|-------|------|----------|----------|
| **TenantAgent** | 租户生命周期管理 | 租户创建/配置/计费/禁用 | 租户注册、配置变更、到期处理 |
| **InventoryAgent** | 库存全域管理 | 查询/调整/调拨/预留/盘点 | 库存操作、补货决策、异常处理 |
| **OrderAgent** | 订单全流程 | 创建/分配/波次/发货/退货 | 订单下单、取消、异常介入 |
| **WarehouseAgent** | 仓储作业调度 | 入库/出库/移库/盘点工单派发 | 作业计划、资源调度、异常分发 |
| **BillingAgent** | 计费与财务 | 策略计费/账单生成/对账/催收 | 周期计费、订单结算、发票开具 |
| **ReportAgent** | 报表与分析 | 数据聚合/缓存刷新/导出/订阅 | 定时报表、临时查询、数据订阅 |
| **DeviceAgent** | 设备管理 | PDA/秤/传送带注册/心跳/固件升级 | 设备上线、异常监控、OTA 分发 |
| **AuditAgent** | 审计与合规 | 日志聚合/敏感操作检测/报告生成 | 定期审计、敏感操作实时告警 |

### 2.3 Agent 协作模式

| 模式 | 适用场景 | 示例 |
|------|----------|------|
| **顺序编排** | 步骤强依赖 | 入库：收货→质检→上架 |
| **并行聚合** | 独立子任务 | 报表生成：并行查询多维度数据 |
| **事件驱动** | 解耦异步 | 库存变更→发布事件→BillingAgent 捕获计费 |
| **人工介入** | 异常/低置信度 | 补货决策置信度 < 0.7 → 推送给人工审批 |

---

## 3. Skill 体系

### 3.1 技能分类

| 分类 | 技能示例 | 说明 |
|------|----------|------|
| **数据访问** | `query_inventory`, `query_orders`, `upsert_inventory` | 统一的数据库/缓存访问封装 |
| **业务计算** | `calc_replenishment_qty`, `calc_storage_fee`, `allocate_stock` | 纯业务逻辑，无副作用 |
| **外部集成** | `call_cf_worker`, `call_supabase_rpc`, `send_webhook` | 标准化外部调用，含重试/熔断 |
| **通知通讯** | `send_dingtalk`, `send_email`, `push_websocket` | 多渠道统一发送接口 |
| **数据转换** | `transform_to_edi`, `parse_barcode`, `generate_qrcode` | 格式转换、编解码 |
| **工具调用** | `exec_sql`, `run_shell`, `call_http_api` | 受控的底层操作 |
| **决策支持** | `eval_replenishment_rule`, `score_replenishment_priority` | 规则引擎/评分模型 |

### 3.2 技能注册与发现
```typescript
interface SkillManifest {
  name: string;           // 唯一标识：inventory.query_stock
  version: string;        // 语义化版本
  category: SkillCategory;
  inputSchema: JSONSchema;    // 输入参数校验
  outputSchema: JSONSchema;   // 输出结构定义
  sideEffects: boolean;       // 是否有副作用
  idempotent: boolean;        // 是否幂等
  timeoutMs: number;          // 执行超时
  retryPolicy: RetryPolicy;   // 重试策略
  permissions: string[];      // 所需权限标签
}
```

### 3.3 核心技能清单 (示例)

| 技能名 | 分类 | 输入 | 输出 | 副作用 | 幂等 |
|--------|------|------|------|--------|------|
| `inventory.query` | 数据访问 | `{tenant_id, filters, pagination}` | `{items[], total}` | 否 | 是 |
| `inventory.adjust` | 数据访问 | `{inv_id, delta_qty, reason}` | `{new_qty, version}` | 是 | 否 |
| `inventory.reserve` | 业务计算 | `{inv_id, order_id, qty}` | `{resv_id, expires_at}` | 是 | 否 |
| `order.allocate_stock` | 业务计算 | `{order_id, strategy}` | `{allocations[], unallocated}` | 是 | 否 |
| `billing.calc_fee` | 业务计算 | `{tenant_id, period, usage}` | `{items[], total}` | 否 | 是 |
| `cf_worker.invoke` | 外部集成 | `{script_name, payload}` | `{result, cache_hit}` | 视脚本 | 视脚本 |
| `notify.dingtalk` | 通知通讯 | `{webhook, markdown, at_users}` | `{sent: boolean}` | 是 | 是 |
| `barcode.parse` | 数据转换 | `{raw_code, rule_set}` | `{type, target_id, meta}` | 否 | 是 |

---

## 4. MCP (Model Context Protocol) 工具集成

### 4.1 架构定位
MCP 作为 **标准化的外部工具总线**，统一管理：
- 数据库操作
- 文件/对象存储操作
- 第三方 API (物流、支付、ERP)
- 本地工具

### 4.2 MCP 服务端能力
| 能力 | 实现方式 |
|------|----------|
| **资源订阅** | 监听数据库变更/文件变更/配置变更，推送至客户端 |
| **工具调用** | 标准化的 `tools/call` 接口，支持流式/同步/异步 |
| **提示模板** | 预置 Prompt 模板，支持变量插槽 |
| **采样/补全** | 集成 LLM 完成代码生成/文本总结/决策建议 |

### 4.3 已接入 MCP 工具清单

| 工具名 | 类型 | 说明 | 认证方式 |
|--------|------|------|----------|
| `supabase-db` | Database | 只读查询/受限写入/RPC 调用 | Service Role Key |
| `supabase-storage` | Storage | 文件上传/下载/签名 URL/生命周期 | Service Role Key |
| `cloudflare-kv` | KV Store | 读/写/列出/批量操作 | CF API Token |
| `cloudflare-r2` | Object Storage | S3 兼容接口 | R2 API Token |
| `logistics-edie` | External API | EDI 850/856/997 报文收发 | API Key + 签名 |
| `... |
| `payment-gateway` | External API | 支付/退款/查询/对账 | AppID + 私钥 |
| `erp-connector` | External API | 主数据同步/单据回传 | OAuth2 Client Credentials |
| `local-shell` | Local Tool | 受控的只读命令 (如 `df`, `free`, `ls`) | 本地沙箱 |

### 4.4 MCP 客户端调用示例
```typescript
// Agent 内部调用 MCP 工具
const result = await mcpClient.callTool('supabase-db', 'execute_sql', {
  sql: 'SELECT * FROM inventory WHERE tenant_id = $1 AND qty < $2',
  params: [tenantId, threshold]
});

// 流式处理大结果集
for await (const chunk of mcpClient.streamTool('supabase-db', 'export_csv', {...})) {
  processChunk(chunk);
}
```

---

## 5. 自动化规则引擎

### 5.1 规则定义 DSL
```yaml
# 补货触发规则示例
rule: replenishment_trigger
when:
  - event: inventory.updated
    condition: |
      (new.qty / location.max_qty) < 0.2
      AND new.last_replenished_at < now() - interval '24 hours'
then:
  - action: create_replenishment_task
    params:
      priority: high
      suggested_qty: "{{ location.max_qty - new.qty }}"
  - action: notify
    params:
      channel: dingtalk
      template: replenishment_alert
      targets: ["warehouse_manager"]
```

### 5.2 规则分类与执行策略

| 类别 | 触发方式 | 执行模式 | 典型规则数 |
|------|----------|----------|------------|
| **库存补货** | 事件/定时 | 异步/批量 | 50+ |
| **异常告警** | 事件/阈值 | 实时/去抖 | 30+ |
| **计费触发** | 定时/事件 | 批量/幂等 | 20+ |
| **数据质量** | 定时/事件 | 异步/补偿 | 15+ |
| **合规审计** | 事件/定时 | 实时/审计 | 10+ |

### 5.3 规则版本管理与灰度
- **版本控制**：Git 管理规则 YAML，PR 审核 + 自动测试
- **灰度发布**：按租户/仓库百分比逐步放量
- **回滚机制**：一键回滚至上一版本，支持规则级回滚

---

## 6. 上下文管理与记忆

| 记忆类型 | 存储介质 | TTL | 用途 |
|----------|----------|-----|------|
| **短期上下文** | 内存/Redis | 任务周期 | 任务链参数传递、中间结果缓存 |
| **租户画像** | PostgreSQL + Redis | 长期 | 租户偏好、计费策略、历史行为 |
| **Agent 经验库** | Vector DB (pgvector) | 长期 | 相似任务检索、决策参考 |
| **知识库** | Wiki/向量库 | 长期 | 运维手册、FAQ、最佳实践检索 |

---

## 7. 可观测性与治理

| 指标 | 采集方式 | 告警阈值 |
|------|----------|----------|
| Agent 成功率 | Counter/Rate | < 99% |
| Skill 平均耗时 | Histogram | > P99 5s |
| MCP 调用失败率 | Counter/Rate | > 1% |
| 规则触发频次 | Counter | 异常突变 |
| 任务队列积压 | Gauge | > 1000 |

### 治理规则
- **技能变更**：破坏性变更需发布 Major 版本，提供兼容层 3 个月
- **Agent 部署**：蓝绿发布，健康检查通过后切流
- **规则变更**：GitOps 管理，PR 审核 + 仿真测试通过后自动部署

---

## 8. ECC（Everything Claude Code）治理集成方案（设计记录，第 1/2 项已执行，2026-07-18）

> **状态**：§8.2 导入、§8.4 并发测试试点已认领执行并通过验证，证据见 `docs/00-project/ROADMAP.md`"第 2 项验证记录"。§8.3 冲突映射及以后仍为设计记录，供开发团队认领执行。

### 8.1 现状核实（已确认，非假设）
- 插件已安装：`.claude/settings.json` 含 `"enabledPlugins": {"ecc@ecc": true}`，插件缓存位于 `~/.claude/plugins/cache/ecc/ecc/2.0.0/`
- **规则层已导入（2026-07-18）**：按 §8.2 步骤将 `rules/common` + `rules/typescript` 拷贝至项目本地 `.claude/rules/ecc/`，共 15 个文件（`common/` 10 个 + `typescript/` 5 个），`git status` 显示为 `??` 未追踪，符合"不提交"设计。`~/.claude/rules/ecc/`（全局路径）仍不存在——按设计本轮只导入项目本地路径。

### 8.2 导入步骤（执行人操作，项目本地路径，不提交）
```bash
mkdir -p .claude/rules/ecc
cp -r ~/.claude/plugins/cache/ecc/ecc/2.0.0/rules/common .claude/rules/ecc/
cp -r ~/.claude/plugins/cache/ecc/ecc/2.0.0/rules/typescript .claude/rules/ecc/
```
- 选项目本地（非 `~/.claude/` 全局）：影响范围仅限本仓库 session，出问题清理不牵连其他项目；且保留"验证通过后正式提交入库、变成全队共享标准"的选项。
- **导入后不要 `git add`**——此时是未追踪的本地文件（`git status` 显示 `??`），是否提交是 §8.5"转正"阶段的独立决定，不在导入这一步发生。
- 验证：`ls .claude/rules/ecc/common .claude/rules/ecc/typescript` 应能看到 `testing.md`/`coding-style.md`/`code-review.md`/`git-workflow.md`/`patterns.md`/`security.md`/`performance.md`/`hooks.md`/`agents.md` 等文件。

### 8.3 冲突映射方法论（"转正"的核心工作，不是可选项）
> 原则：ECC 规则与项目现有文档（`CONVENTIONS.md`/`CLAUDE.md`/`WORKFLOWS.md`）产生交集是**预期且必要**的，不是回退信号。执行人需对 `rules/common/*.md` 与 `rules/typescript/*.md` 逐份文件，与现有文档做一次精确映射，每一条交集必须落到以下三种处理方式之一，不允许留白：

| 处理方式 | 含义 | 触发条件 |
|---------|------|---------|
| **保留** | 现有文档内容是项目特有约定，ECC 规则未覆盖或不冲突 | 项目专属业务规则（如多租户隔离、RLS 约定） |
| **替换** | 现有做法与 ECC 标准冲突，且 ECC 标准更严格/更正确 | 例：`.github/workflows/ci.yml` 的 lint job 带 `continue-on-error: true`，与 ECC `common/testing.md` 的强制门禁原则冲突，应被替换为硬门禁 |
| **引用** | 内容重复，现有文档改为指向 ECC 规则，不重复维护 | 例：若 `CONVENTIONS.md` 现有测试章节与 `rules/common/testing.md` 内容重复，改为一句引用 |

- **已知的具体映射线索**（供执行人起步用，不是穷举）：
  - `rules/common/testing.md`（80% 覆盖率 + 强制 TDD）↔ `CONVENTIONS.md` §8 代码审查清单、`.github/workflows/ci.yml` test job
  - `rules/common/code-review.md` ↔ `CONVENTIONS.md` §8 代码审查清单、`.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md`（后者是 DBA 专属清单，二者是并列关系，非替换关系）
  - `rules/common/git-workflow.md` ↔ `WORKFLOWS.md` §1/§4 Git 分支与部署策略
  - `rules/typescript/testing.md`（E2E 用 Playwright）↔ 当前项目零 E2E 测试现状，需登记为新增待办
- **若某条交集找不到映射方式**：不构成回退理由，按"needs input"原则向项目负责人提出具体卡点，而不是自行搁置或跳过。

### 8.4 试点任务设计（原子库存并发写入测试缺口）
- **范围**：`fn_adjust_inventory_at_location`（Layer 3，`supabase/migrations/003_extend_sync_event_actions.sql`）的并发正确性，对应仓储 `SupabaseInventoryRepository`/相关调用方
- **背景**：DBA 自查清单第 3 条明确要求"读改写模式必须用 3-5 个并发请求验证"，这正是本项目上一轮返工的根源 bug 类型（原开发团队 PR 的 `adjust_inventory` 并发丢单），目前部署到生产的修正版**从未被自动化测试验证过**
- **执行环境**：`supabase start`（本地一次性 Docker Postgres），依次应用 `001`→`004` 四个迁移脚本，全程不连接生产库 `pkthcaqsdktlhqkowhkt`、不需要 DBA 参与
- **测试设计**：并发发起 3-5 个请求对同一 `(location_id, product_id, batch)` 做加减库存操作，断言最终数量等于串行执行的预期值，且无更新丢失；遵循 `rules/common/testing.md` 的 AAA 结构与描述式命名
- **执行工具**：`tdd-guide` agent（ECC 规则文档指定的测试强制工具），或 `ecc:orch-fix-defect` 编排"复现→修复到绿→review→gated commit"全链路
- **成功标准**（客观、非自证）：
  1. 测试真实发起 3-5 并发请求，非串行伪并发
  2. 断言最终库存值正确，且能在人为改回旧的非原子实现时可靠失败（证明测试有效，不是摆设）
  3. 全程在本地/CI 沙盒完成，`git diff` 不触碰 `supabase/migrations/`、`.readonly/`
- **✅ 已完成（2026-07-18）**：新增 `src/__tests__/integration/inventory/fn_adjust_inventory_at_location.concurrency.test.ts`，5 个并发请求（`Promise.all`）作用于同一 `(location_id, product_id, batch_no)` 已存在库存行，断言最终值等于串行预期。三项成功标准逐条核对结果、命令与产出证据详见 `docs/00-project/ROADMAP.md`"第 2 项验证记录"，不在此重复。测试默认由 `describe.skipIf(!RUN_DB_CONCURRENCY_TESTS)` 跳过，不影响无本地 Postgres 环境下的常规 `npm run test`/CI。

### 8.5 转正（Formalization）步骤
1. §8.4 试点验证通过（成功标准三项全部满足）
2. 按 §8.3 方法论完成 `rules/common/*` 与 `rules/typescript/*` 全部文件的映射表，写入本节作为附录
3. 依映射表结果修改 `CONVENTIONS.md`/`CLAUDE.md`/`WORKFLOWS.md`/`.github/workflows/ci.yml`/`.github/pull_request_template.md`
4. `git add .claude/rules/ecc/ <联动修改的文档>`，提交、推送，进入正常 PR 审核流程——此时才正式进入版本库，成为全队 Claude Code session 自动读取的规则
5. 更新 `docs/03-database/REPOSITORY_ROADMAP.md` 的状态语义为三档（⏳待开始 / 🔨已实现未验证 / ✅已完成，✅ 档须附测试证据路径），并回溯修正 Phase 5/6/7 当前"✅ 已完成"标记——按新标准，这些条目在补齐测试前应降级为"🔨 已实现未验证"

### 8.6 失败/迭代处理原则
- **环境/工具层面的失败**（本地 Postgres 起不来、agent 产出不可用）与"是否保留 `.claude/rules/ecc/` 导入"是两条独立的轴，前者只需修环境/换执行方式重试，与后者无关，不得混为一谈
- **设计/映射做不出来**：视为方法论本身的 bug，应继续深挖或向项目负责人提出具体卡点（needs input），不构成执行人自行终止或回退的理由
- **真正合理的回退触发条件，仅剩两类客观外部因素**：①项目负责人基于业务判断明确决定不采用；②ECC 承诺的机制被证实不存在/不工作（事实性硬阻塞，非设计难度问题）

---

## 9. 版本记录
| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-07-01 | 初始版本：Agent 体系、Skill 体系、MCP 集成、规则引擎、上下文管理 |
| 1.1.0 | 2026-07-18 | 新增 §8 ECC 治理集成方案（设计记录，试点方案：规则导入、冲突映射方法论、原子库存并发测试试点、转正步骤、失败处理原则），供开发团队认领执行 |
| 1.2.0 | 2026-07-18 | 认领并执行 §8.2（规则导入）+ §8.4（原子库存并发测试试点），验证通过；§8.3 冲突映射及以后仍待认领 |