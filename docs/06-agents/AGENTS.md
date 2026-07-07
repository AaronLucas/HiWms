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

## 8. 版本记录
| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-07-01 | 初始版本：Agent 体系、Skill 体系、MCP 集成、规则引擎、上下文管理 |