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

## 8. ECC（Everything Claude Code）治理集成方案（设计记录，第 1-5 项全部已执行，2026-07-18）

> **状态**：§8.2-§8.5 全部 5 项均已认领执行并通过验证——§8.3 映射结果见 §8.3.1/§8.3.2，§8.4 证据见 `docs/00-project/ROADMAP.md`"第 2 项验证记录"，§8.5 转正 + 分支保护 + 第 5 步状态下调执行记录见 §8.5.1/§8.5.2/§8.5.3。本方案设计记录到此全部落地；后续对已有代码真正补齐测试覆盖属于独立的补齐工程，见 §8.5.3 末尾说明。

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

#### 8.3.1 逐份映射表（第 3 项，2026-07-18 完成）

> 比对范围：`.claude/rules/ecc/{common,typescript}/*.md`（15 个文件）↔ `docs/00-project/CONVENTIONS.md`、根目录 `CLAUDE.md`、`docs/04-workflows/WORKFLOWS.md`、`.github/workflows/ci.yml`、PR 模板。**处理方式**严格限定在"保留/替换/引用"三选一；对于现有文档完全空白（不构成"冲突"，但也不是"重复"）的条目，归入**替换**（视为"用 ECC 标准替换掉空白现状"），并在说明中标注"现状空白"，不新增第四种分类。

| ECC 规则文件 | 关键内容 | 现有文档对应 | 处理方式 | 说明 |
|---|---|---|---|---|
| `common/development-workflow.md` | 编码前强制调研复用（gh search/Context7/Exa/包注册表）→ 计划→TDD→评审→提交 | 根 `CLAUDE.md`"自动规划与拆解"；无调研步骤 | **替换**（现状空白） | 项目现状完全没有"编码前搜索是否有现成实现"这一步，直接采纳 ECC 版本，作为 `CONVENTIONS.md` 新增一节 |
| `common/performance.md` | 模型选型（Haiku/Sonnet/Opus）、上下文预算、扩展思考 | 无对应 | **保留**（不适用） | 这是 Claude Code 协作层配置，非项目代码规范，不写入项目文档 |
| `common/hooks.md` | Hook 类型、TodoWrite 最佳实践 | 无对应 | **保留**（不适用） | 同上，工具层配置，不写入项目文档 |
| `common/security.md` | 提交前安全清单、密钥管理、安全响应流程 | `CONVENTIONS.md` 无独立安全清单章节 | **替换**（现状空白） | `CONVENTIONS.md` 应新增"安全检查清单"一节直接采纳；`.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md`（DBA 专属，聚焦 SQL/迁移）**保留**，并列关系不冲突 |
| `common/agents.md` | ECC 通用 Agent 清单与调用规则 | `docs/06-agents/AGENTS.md` 全篇 | **引用** | 项目 `AGENTS.md` 是"本项目实际配置了哪些 Agent/Skill/MCP"的记录，与 ECC 通用清单范围不同，加一句"通用 Agent 调用总则见 ECC `common/agents.md`"即可，不复制表格 |
| `common/coding-style.md` | 不可变性(强制)、KISS/DRY/YAGNI、文件行数上限(200-400/800)、代码坏味道清单 | `CONVENTIONS.md` §2/§3 有命名与 SRP/DI/租户隔离，**没有**不可变性/行数上限/坏味道清单 | **保留**+**替换**（分项） | §2 命名、§3.1-3.3(SRP/DI/租户隔离) **保留**（项目专属，ECC 未覆盖）；不可变性、文件行数上限、坏味道清单是现状空白，**替换**补入 |
| `common/testing.md` | 80% 覆盖率+强制 TDD+AAA 结构+描述式命名 | `CONVENTIONS.md` §6 有覆盖率数字/工具/位置；`ci.yml` lint job 带 `continue-on-error`，只在 `dev` 触发 | **保留**+**替换**（分项） | §6 覆盖率目标与工具选型 **保留**（数值已定义，不冲突）；`ci.yml` 的 `continue-on-error` 与分支范围**替换**为硬门禁——这是本次治理试点最初动因；AAA 结构/描述式命名**替换**（现状空白）补入 §6 |
| `common/patterns.md` | 骨架项目复用策略、Repository 模式、API 响应格式 | `CONVENTIONS.md` §1（六边形架构+Ports&Adapters，`I{Entity}Repository`命名对应）、§4.4（响应格式） | **保留** | 项目版本比 ECC 通用版本更具体（六边形架构落地细节、`data/meta/error.code` 响应结构），无需替换；骨架复用策略**引用** development-workflow.md 条目 |
| `common/code-review.md` | 评审时机/清单/CRITICAL-HIGH-MEDIUM-LOW 分级/Agent 分工 | `CONVENTIONS.md` §8（8 条自检+DBA 清单引用） | **引用** | §8 保留项目自己的自检清单，末尾加一句"严重级别分级见 ECC `common/code-review.md`"，不重复定义分级标准 |
| `common/git-workflow.md` | Conventional Commits 格式、PR 流程（`git diff base...HEAD`、测试计划、`push -u`） | `CONVENTIONS.md` §7（含项目专属 scope 表：`sync`/`exception` 等） | **保留**+**替换**（分项） | §7 类型表+scope 表**保留**（信息量更大，项目专属 scope 不应丢失）；PR 流程实操细则（完整提交历史分析、diff base 对比、测试计划 TODO）现状空白，**替换**补进 `WORKFLOWS.md` §3.1 |
| `typescript/coding-style.md` | interface/type 选择、避免 any、React props 类型化、Zod 校验、禁 console.log | `CONVENTIONS.md` §3.5（禁用 any、类型安全）；§9（禁用 console.log） | **保留**+**替换**（分项） | §3.5/§9 已有的条目**保留**；interface/type 选择准则、Zod 强制校验规范现状空白，**替换**补入；React props 类型化**保留**（暂不适用——项目前端阶段尚未启动，ROADMAP 阶段 2 全部未完成，留待前端阶段引入时再评估） |
| `typescript/hooks.md` | Prettier/tsc PostToolUse、console.log Stop 审计 | 无对应 | **保留**（不适用） | 工具层配置，不写入项目文档 |
| `typescript/patterns.md` | API 响应泛型、自定义 Hook、Repository 接口 | 同 `common/patterns.md` 判断 | **保留** | 项目 Repository/响应格式设计已更具体；自定义 Hook 模式当前无 React 场景，**保留**（暂不适用） |
| `typescript/security.md` | 密钥用环境变量+启动时校验存在性 | `.env.example` 存在，但无"启动校验必需密钥"强制模式 | **替换**（现状空白） | `CONVENTIONS.md` 新增条款，要求关键密钥启动时显式校验并抛错 |
| `typescript/testing.md` | E2E 用 Playwright | `CONVENTIONS.md` §6 已写"E2E 测试 \| Playwright" | **保留** | 规则已一致，无需修改；但项目当前 E2E 用例数为 0（ROADMAP 阶段 3 未完成），这是执行落地缺口而非规则冲突，登记为阶段 3 待办，不在本次治理试点范围内处理 |

#### 8.3.2 映射过程中顺带发现的问题（非 ECC 规则本身，供"转正"阶段一并处理）
1. **`WORKFLOWS.md` §3.2 与 `ci.yml` 实际内容脱节**：文档描述的 CI 流水线含 `lint`(ESLint+Prettier+TypeScript)/`test`/`build`/`security`(npm audit+Trivy)/`docs`(Markdown 链接检查) 5 个阶段；实际 `ci.yml` 只有 `lint`(仅 `tsc --noEmit`，无 ESLint/Prettier)/`test`/`build` 3 个 job，没有 security/docs 阶段。这是项目自身文档与代码的历史脱节，不属于 ECC 规则映射对象，但建议第 4 项"转正"改 `ci.yml` 时一并同步修正 `WORKFLOWS.md` §3.2 描述，避免文档继续失真。
2. **PR 模板实际不存在**：`AGENTS.md` §8.5 第 3 步原文写"修改 ... PR 模板"，但 `find .github -type f` 核实项目目前没有 `.github/pull_request_template.md` 文件。第 4 项"转正"阶段这一步实际是**新建**而非**修改**，执行人应据此调整理解，不必去找一个不存在的文件。

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

#### 8.5.1 执行记录（2026-07-18，经人工确认后执行第 1-4 步；第 5 步不在本轮范围）
- **第 1-2 步**：已满足（§8.4 试点通过；§8.3.1 映射表已产出）
- **第 3 步**：已按映射表修改 `CONVENTIONS.md`（新增 §10 不可变性/文件组织/代码坏味道、§11 安全检查清单、§12 TS 类型设计补充、§13 开发前调研复用，§6/§7/§8 追加对 ECC 规则的引用）、`WORKFLOWS.md`（新增 §3.1.1 PR 提交流程细则；§3.2 改为如实描述 `ci.yml` 实际 3 个 job，修正与 ECC 冲突映射时发现的文档/CI 脱节）、`.github/workflows/ci.yml`（`main`/`dev` 双触发，移除 lint job 的 `continue-on-error`，`ci-success` 门禁逻辑同步简化）、新建 `.github/pull_request_template.md`；根 `CLAUDE.md` 新增一条 ECC 规则索引指向本次落地位置
- **第 4 步（原有意偏离设计原文，2026-07-18 已收尾）**：原文写"`git add .claude/rules/ecc/` <联动修改的文档>"，即设计意图是转正时把规则目录本身一并提交入库、成为全队共享标准。本轮最初**只提交了联动修改的文档/CI/PR 模板，未把 `.claude/rules/ecc/` 本身加入提交**——因为这是一个独立于"文档措辞"的决定，执行人认为当时的授权范围不够明确清晰，留给项目负责人单独拍板。**项目负责人已在同日确认提交**，`.claude/rules/ecc/` 15 个文件已正式入库
- **第 5 步**：本轮明确不做，见 `docs/00-project/ROADMAP.md` 第 5 项状态

#### 8.5.2 后续补充：`main` 分支保护实际生效（2026-07-18，PR #15 review 遗留 HIGH 的收尾）
第 3 步把 `ci.yml` 的 lint 门禁改为硬拦截时，review 阶段发现一个 HIGH 级缺口：GitHub 上 `main` 分支当时完全没有配置分支保护规则，`ci.yml` 失败并不会真正阻止合并。经确认后已用 GitHub Rulesets API（`gh api --method POST repos/{owner}/{repo}/rulesets`，参考文件 `.github/rulesets/main-branch-protection.json`）实际创建并启用规则——非仅写文档。过程中还额外发现并修复了一个独立的、更紧急的阻塞项：`pnpm-lock.yaml` 与 `package.json` 早已脱节（缺 `zod`/`@cloudflare/workers-types` 等），此前被 `continue-on-error: true` 掩盖，第 3 步去掉这个开关后 `main` 上的 CI 第一次真实失败，已单独提交修复（详见 `docs/04-workflows/WORKFLOWS.md` §3.1 说明与 git 历史）。

#### 8.5.3 第 5 步执行记录（2026-07-18，经人工确认后执行）
`docs/03-database/REPOSITORY_ROADMAP.md` 已新增三档状态语义说明（⏳/🔨/✅，✅ 须附测试证据路径），并回溯核查 Phase 5/6/7 共 20 个仓储文件（10 端口 + 10 实现）——核实 `src/__tests__/` 下没有任何测试覆盖这些文件，全部由"✅ 已完成"下调为"🔨 已实现未验证"。**明确不是代码倒退**：`npx tsc --noEmit` 仍零错误，Device API 路由的调用关系不受影响，只是判定"完成"的标准现在要求测试证据，之前没有这项要求。

**团队通知**：核实本仓库当前唯一 GitHub 协作者就是项目负责人本人（`gh api repos/{owner}/{repo}/collaborators`），没有发现其他仓库内协作者需要通知。若项目负责人在仓库之外（如 Slack/邮件）还有其他团队成员需要知晓这次状态调整，通知内容与是否发送由项目负责人自行决定，执行人不代为起草或发送。

**后续补齐工程（不在本次 5 项任务范围内）**：把 Phase 5/6/7 这 20 个"🔨已实现未验证"的文件真正补齐测试覆盖，是独立的大工程，不应该一次性平推，建议按风险优先级排期（参照 §8.4 试点思路：优先覆盖并发敏感/资金结算/历史上真实出过 bug 的仓储），具体排期留待项目负责人后续决定后再展开。

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
| 1.3.0 | 2026-07-18 | 认领并完成 §8.3 冲突映射（新增 §8.3.1 逐份映射表 + §8.3.2 顺带发现问题）；§8.5 转正因 `WORKFLOWS.md` §7.4 暂停节点待人工确认后再执行 |
| 1.4.0 | 2026-07-18 | 经人工确认后完成 §8.5 转正第 1-4 步（新增 §8.5.1 执行记录）；`.claude/rules/ecc/` 本身是否提交入库留待项目负责人单独确认；第 5 步（回溯下调 Phase 5/6/7 状态）本轮明确不做 |
| 1.7.0 | 2026-07-18 | 项目负责人确认后，`.claude/rules/ecc/` 15 个规则文件正式提交入库，成为全队 Claude Code session 自动读取的规则（§8.5.1 第 4 步遗留决定的收尾） |
| 1.5.0 | 2026-07-18 | 新增 §8.5.2：`main` 分支保护经人工确认后实际生效（GitHub Rulesets API），并记录顺带修复的 `pnpm-lock.yaml` 脱节问题 |
| 1.6.0 | 2026-07-18 | 新增 §8.5.3：完成 ECC 治理试点第 5 步——`REPOSITORY_ROADMAP.md` 状态语义三档化，回溯下调 Phase 5/6/7 共 20 个"✅已完成"标记；ECC 治理试点第 1-5 项全部完成 |