# ADR-008: 统一工作流引擎替代双引擎

## 状态
✅ Accepted (2026-07-09)

## 背景
历史上存在三套工作流相关实现：
1. `WaveOrchestrator` (v1) —— 硬编码波次步骤，无补偿事务
2. `WaveOrchestratorV2` (v2) —— 引入步骤配置，但状态机不完整
3. `WorkflowEngine` (v3 实验性) —— 通用引擎但未集成核心业务

问题：
- 三套并存，维护成本极高
- 无统一状态机：`pending/running/completed/failed` 定义不一
- 无补偿事务：任务失败需人工修复（释放库存、取消工单）
- 无事件驱动：下游依赖轮询或硬编码回调
- 任务不可复用：每个流程内联业务逻辑

## 决策
实现单一 **统一工作流引擎** `WorkflowEngine` 实现 `IWorkflowEngine` 接口：

### 核心特性
1. **状态机驱动**：`pending → running → waiting_human → completed | failed | compensated`
2. **任务注册表**：7 个标准任务（`AllocateInventoryTask`、`CreateWorkOrderTask`、`SendNotificationTask`、`MatchCrossDockTask`、`AllocateChuteTask`、`VerifyWeightTask`、`ReplenishmentTask`、`CalculateBillingTask`）
3. **工作流定义**：声明式步骤编排（`order-process`、`inventory-sync`、`replenishment`）
4. **补偿事务**：每任务实现 `compensate()`，失败自动回滚
5. **事件总线**：`on('taskCompleted' | 'workflowCompleted' | 'workflowFailed', handler)`
6. **持久化**：实例状态存入 `workflow_instances` 表，支持崩溃恢复

### 三大核心工作流
| 工作流 | 触发 | 关键步骤 | 补偿动作 |
|--------|------|----------|----------|
| `order-process` | 创建波次 | 分配库存→创建波次→生成工单→交叉理货→滑道分配→重量校验→预计费 | 释放预留、取消工单、FALLBACK 交叉理货 |
| `inventory-sync` | 黑盒收货/同步 | 解析收货→同步库存→检查补货 | 标记收货异常、回滚库存写入 |
| `replenishment` | 定时/低库存事件 | 计算补货量→创建移库工单 | 标记补货失败、告警运营 |

## 后果

### 正面
- **单一事实来源**：全系统仅一套引擎，零重复
- **可观测性**：工作流实例状态、任务耗时、补偿执行全可追踪
- **运维友好**：失败自动补偿，减少人工介入 90%+
- **扩展性**：新业务流程仅需组合标准任务 + 少量自定义任务
- **测试性**：引擎、任务、工作流定义可独立单测

### 负面
- 迁移现有 `WaveOrchestrator`/`V2` 业务逻辑需一次性投入
- 状态机设计需前期深思熟虑（后期变更影响所有流程）

## 实施路径
1. 实现 `IWorkflowEngine` + `WorkflowEngine` 核心（状态机、存储、事件）
2. 实现 7 个标准任务类（继承 `TaskBase`）
3. 定义 3 个工作流 JSON/TS 定义
4. 编写迁移脚本：现有波次/工单数据 → `workflow_instances`
5. 逐步替换 `WaveOrchestrator` 调用点为 `workflowEngine.start('order-process', ...)`
6. 删除 `WaveOrchestrator`、`WaveOrchestratorV2` 代码

## 相关文档
- `ARCHITECTURE.md` — 工作流架构图、任务注册表
- `WORKFLOWS.md` — 三大工作流详细步骤、补偿动作表
- `src/core/workflows/` — 实现代码

---

*决策者：主工程师 | 评审：架构组 | 生效日期：2026-07-09*