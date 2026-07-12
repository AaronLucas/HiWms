# PDA 离线同步协议详细设计

> **版本**: v1.0.0  
> **状态**: 草案待评审  
> **关联文档**: `ARCHITECTURE.md` (3.4节/ADR-008), `API_SPEC.md` (4.1节), `DEVICE_PROTOCOL_SPEC.md`, `SQLITE_LOCAL_SCHEMA.md`, `CONFLICT_RESOLUTION_STRATEGY.md`

---

## 1. 设计目标与原则

### 1.1 核心目标
| 目标 | 指标 |
|------|------|
| **离线可用性** | 仓库全区域网络覆盖率 < 95% 时，PDA 仍能完成 100% 核心作业（收货/上架/拣选/打包/发货/盘点） |
| **数据一致性** | 同步后主库数据与 PDA 本地操作语义等价，零数据丢失、零脏写 |
| **冲突可控** | 冲突率 < 0.1%，且 100% 冲突可自动解决或有明确人工介入路径 |
| **性能达标** | 单次同步（含 500 条操作记录）< 3 秒，增量同步 < 500ms |

### 1.2 设计原则
| 原则 | 体现 |
|------|------|
| **本地优先** | 所有写操作先落本地 SQLite，再异步推送主库 |
| **幂等同步** | 同步接口幂等，重复推送不产生副作用 |
| **版本向量** | 每条记录携带版本向量，精准检测并发冲突 |
| **业务语义感知** | 冲突解决基于业务场景，非通用 LWW |
| **断点续传** | 大批量同步支持分片、暂停、恢复 |
| **可观测** | 同步全链路埋点，支持追踪单条记录从 PDA 到主库全生命周期 |

---

## 2. 同步架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PDA 端 (离线优先)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────┐   │
│  │ 业务操作层    │──►│ 本地事务层    │──►│ 同步队列      │──►│ 同步引擎    │   │
│  │ (扫码/确认)   │   │ (SQLite +    │   │ (持久化、    │   │ (分片、重试、│   │
│  │              │   │  版本向量)    │   │  优先级、去重)│   │  冲突预检)  │   │
│  └──────────────┘   └──────────────┘   └──────────────┘   └─────┬──────┘   │
└──────────────────────────────────────────────────────────────────│──────────┘
                                                                   │ HTTPS/WS
                                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Device API /sync 端点                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────┐   │
│  │ 认证/限流     │──►│ 请求解析/校验 │──►│ 冲突检测引擎  │──►│ 合并/写入    │   │
│  │ (Device JWT)  │   │ (Schema/签名) │   │ (版本向量比对)│   │ (事务/补偿)  │   │
│  └──────────────┘   └──────────────┘   └──────────────┘   └─────┬──────┘   │
└──────────────────────────────────────────────────────────────────│──────────┘
                                                                   │
                                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              主库 + 事件总线                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL (RLS) ◄── 领域事件发布 ──► EventBus ◄──► 下游消费者              │
│  (inventory, orders, work_orders, wo_action_logs, sync_queue...)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心数据结构

### 3.1 PDA 本地操作记录

```typescript
// src/types/offline-sync.ts

/** 同步队列项状态 */
export enum SyncQueueStatus {
  PENDING = 'PENDING',       // 待同步
  SYNCING = 'SYNCING',       // 同步中
  CONFLICT = 'CONFLICT',     // 冲突待解决
  RESOLVED = 'RESOLVED',     // 冲突已解决，待重试
  COMPLETED = 'COMPLETED',   // 同步成功
  FAILED = 'FAILED',         // 同步失败（超过最大重试）
}

/** 本地操作记录（写入 SQLite 的 sync_queue 表） */
export interface LocalOperation {
  /** 本地唯一 ID (ULID，含时间戳，便于排序) */
  local_id: string;
  
  /** 业务实体类型 */
  entity_type: EntityType;
  
  /** 操作类型 */
  operation: OperationType;
  
  /** 业务主键（如 inventory_id, work_order_id） */
  entity_id: string;
  
  /** 租户 ID（冗余，便于多租户 PDA 离线切换） */
  tenant_id: string;
  
  /** 设备 ID */
  device_id: string;
  
  /** 操作负载（完整的新值或增量） */
  payload: Record<string, unknown>;
  
  /** 版本向量：{ table_name: { row_pk: version } } */
  version_vector: VersionVector;
  
  /** 操作发生的本地时间（ISO8601，含时区） */
  occurred_at: string;
  
  /** 关联的业务上下文（如工单ID、波次ID，用于冲突解决上下文） */
  business_context?: BusinessContext;
  
  /** 同步元数据 */
  sync_meta: SyncMetadata;
}

/** 版本向量：记录操作时刻各相关表行的版本 */
export interface VersionVector {
  /** 目标表行版本 */
  [table: string]: {
    [row_pk: string]: number | string;  // 数字版本或 UUID
  };
}

/** 业务上下文：用于冲突解决时的语义判断 */
export interface BusinessContext {
  /** 所属工单 ID */
  work_order_id?: string;
  /** 所属波次 ID */
  wave_id?: string;
  /** 所属任务 ID */
  task_id?: string;
  /** 操作员 ID */
  operator_id?: string;
  /** 位置信息（GPS/库位） */
  location?: { lat: number; lng: number; loc_code?: string };
  /** 批次/效期信息 */
  batch_info?: { batch_no: string; exp_date: string };
}

/** 同步元数据 */
export interface SyncMetadata {
  /** 重试次数 */
  retry_count: number;
  /** 最大重试次数 */
  max_retries: number;
  /** 最后同步尝试时间 */
  last_sync_attempt?: string;
  /** 最后同步错误 */
  last_error?: string;
  /** 同步优先级：1=高(拣选/发货), 2=中(收货/上架), 3=低(盘点/移库) */
  priority: 1 | 2 | 3;
  /** 分片标识（大批量同步时） */
  chunk_id?: string;
  /** 分片序号 */
  chunk_index?: number;
  /** 总分片数 */
  total_chunks?: number;
}

/** 实体类型枚举 */
export enum EntityType {
  INVENTORY = 'inventory',
  INVENTORY_RESERVATION = 'inventory_reservation',
  INVENTORY_LOCK = 'inventory_lock',
  WORK_ORDER = 'work_order',
  WO_ACTION_LOG = 'wo_action_log',
  ORDER = 'order',
  ORDER_LINE = 'order_line',
  WAVE = 'wave',
  INBOUND_RECEIPT = 'inbound_receipt',
  PACKING_TASK = 'packing_task',
  SORTING_TASK = 'sorting_task',
  LOADING_TASK = 'loading_task',
  QUALITY_INSPECTION = 'quality_inspection',
  DEVICE_STATE = 'device_state',
  CONTAINER = 'container',
  LOCATION = 'location',
}

/** 操作类型枚举 */
export enum OperationType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  /** 复合操作：如拣选确认 = UPDATE inventory + CREATE wo_action_log */
  COMPOUND = 'COMPOUND',
}
```

### 3.2 同步请求/响应契约

```typescript
/** 同步请求（PDA → Server） */
export interface SyncRequest {
  /** 设备标识 */
  device_id: string;
  /** 租户标识 */
  tenant_id: string;
  /** PDA 客户端版本 */
  client_version: string;
  /** 同步会话 ID（用于断点续传） */
  session_id: string;
  /** 本地最后同步成功的服务端时间戳（用于增量拉取） */
  last_synced_server_time?: string;
  /** 待推送的操作记录（分批） */
  operations: LocalOperation[];
  /** 请求增量拉取的表列表 */
  pull_tables?: EntityType[];
  /** 每表拉取限制 */
  pull_limit?: number;
}

/** 同步响应 */
export interface SyncResponse {
  /** 本次同步会话 ID */
  session_id: string;
  /** 服务端当前时间（PDA 校准本地时钟用） */
  server_time: string;
  /** 推送结果 */
  push_results: PushResult[];
  /** 冲突列表（需 PDA 端解决或展示给用户） */
  conflicts: SyncConflict[];
  /** 增量拉取数据 */
  pull_data?: PullData;
  /** 同步统计 */
  stats: SyncStats;
  /** 下次同步建议间隔（秒） */
  next_sync_interval_sec: number;
}

/** 单条操作推送结果 */
export interface PushResult {
  local_id: string;
  status: 'SUCCESS' | 'CONFLICT' | 'ERROR';
  /** 服务端生成的实体 ID（CREATE 操作） */
  server_entity_id?: string;
  /** 服务端版本（UPDATE 操作） */
  server_version?: number | string;
  /** 错误详情 */
  error?: { code: string; message: string; details?: unknown };
  /** 冲突 ID（如 status=CONFLICT） */
  conflict_id?: string;
}

/** 同步冲突详情 */
export interface SyncConflict {
  conflict_id: string;
  local_operation: LocalOperation;
  /** 服务端当前状态 */
  server_state: Record<string, unknown>;
  /** 服务端版本向量 */
  server_version_vector: VersionVector;
  /** 冲突类型 */
  conflict_type: ConflictType;
  /** 建议解决策略 */
  suggested_resolution: ConflictResolution;
  /** 可选解决方案列表（供用户选择） */
  resolution_options: ConflictResolutionOption[];
}

/** 冲突类型 */
export enum ConflictType {
  /** 版本冲突：同一行被双方修改 */
  VERSION_MISMATCH = 'VERSION_MISMATCH',
  /** 唯一键冲突：PDA 创建的实体在服务端已存在 */
  UNIQUE_VIOLATION = 'UNIQUE_VIOLATION',
  /** 外键冲突：引用的实体在服务端不存在/已删除 */
  FK_VIOLATION = 'FK_VIOLATION',
  /** 业务规则冲突：如库存不足、库位冻结、效期过期 */
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  /** 并发操作冲突：如同一工单被两台 PDA 同时执行 */
  CONCURRENT_OPERATION = 'CONCURRENT_OPERATION',
}

/** 冲突解决策略 */
export enum ConflictResolution {
  /** 服务端胜出（LWW - Last Writer Wins，基于服务端时间） */
  SERVER_WINS = 'SERVER_WINS',
  /** PDA 胜出（强制覆盖） */
  CLIENT_WINS = 'CLIENT_WINS',
  /** 合并（字段级合并，需业务语义支持） */
  MERGE = 'MERGE',
  /** 人工介入 */
  MANUAL = 'MANUAL',
  /** 基于操作语义转换（OT - Operational Transformation） */
  TRANSFORM = 'TRANSFORM',
  /** CRDT 合并（适用于计数器、集合类型） */
  CRDT_MERGE = 'CRDT_MERGE',
}

/** 冲突解决选项 */
export interface ConflictResolutionOption {
  strategy: ConflictResolution;
  description: string;
  /** 预览合并后结果 */
  preview_result?: Record<string, unknown>;
  /** 是否需用户确认 */
  requires_confirmation: boolean;
}

/** 增量拉取数据 */
export interface PullData {
  [entityType: string]: {
    /** 实体记录数组 */
    records: Record<string, unknown>[];
    /** 游标：下次拉取起点 */
    cursor: string;
    /** 是否还有更多数据 */
    has_more: boolean;
  };
}

/** 同步统计 */
export interface SyncStats {
  pushed: number;
  succeeded: number;
  conflicts: number;
  errors: number;
  pulled_records: number;
  duration_ms: number;
}
```

---

## 4. 同步协议流程

### 4.1 完整同步流程图

```
PDA 端                                    Server 端
  │                                          │
  ├─ 1. 网络恢复检测                         │
  │                                          │
  ├─ 2. 构建 SyncRequest                     │
  │   - 从 SQLite 取 PENDING 操作            │
  │   - 按 priority 排序                     │
  │   - 分片（>200 条分批）                  │
  │   - 计算版本向量                         │
  │                                          │
  ├─ 3. POST /api/v1/device/sync ──────────►│
  │                                          ├─ 4. 认证校验
  │                                          ├─ 5. 请求体 Schema 校验
  │                                          ├─ 6. 幂等性检查（local_id 去重）
  │                                          ├─ 7. 逐条冲突检测
  │                                          │   - 读取服务端当前版本向量
  │                                          │   - 比对客户端版本向量
  │                                          │   - 业务规则校验
  │                                          ├─ 8. 分类处理
  │                                          │   ✓ 无冲突 → 事务写入主库
  │                                          │   ✗ 冲突 → 生成 Conflict 对象
  │                                          ├─ 9. 增量拉取（按 pull_tables + 游标）
  │                                          ├─ 10. 构建 SyncResponse
  │                                          │
  ├─ 11. 处理响应 ◄──────────────────────────┤
  │   - 更新本地 SQLite：                     │
  │     ✓ SUCCESS → 标记 COMPLETED，更新版本 │
  │     ✗ CONFLICT → 存入 conflict 表，标记  │
  │       CONFLICT，弹 UI 让用户选择         │
  │     ✗ ERROR → retry_count++，退避重试    │
  │   - 合并拉取数据到本地表                 │
  │   - 更新 last_synced_server_time         │
  │   - 清理已完成同步项                     │
  │                                          │
  ├─ 12. 有冲突？ ──是──► 用户交互解决 ──────►│
  │   │              (POST /sync/conflicts/{id}/resolve)  │
  │   │                                          │
  │   └─否──► 同步完成，等待下次触发            │
```

### 4.2 同步触发策略

| 触发条件 | 策略 | 说明 |
|----------|------|------|
| **网络恢复** | 立即同步 | 监听网络变化事件，WiFi/4G 连通即触发 |
| **操作积累** | 阈值触发 | 待同步队列 ≥ 50 条 或 高优先级操作 ≥ 5 条 |
| **定时轮询** | 后台轮询 | 前台 30 秒/次，后台 5 分钟/次（可配置） |
| **用户手动** | 即时触发 | PDA 界面"同步"按钮 |
| **关键操作** | 即时推送 | 发货确认、盘点提交等高优先级操作完成后立即尝试同步 |
| **电量/流量** | 智能延迟 | 电量 < 20% 或 4G 流量模式下，合并推送、降低频率 |

### 4.3 分片与断点续传

```
大批量同步（> 200 条操作）：
┌─────────────────────────────────────────────────────┐
│ 客户端分片算法                                       │
├─────────────────────────────────────────────────────┤
│ 1. 按 priority 分组：P1(高) → P2(中) → P3(低)       │
│ 2. 每组内按 occurred_at 升序                        │
│ 3. 每片最多 200 条，生成 chunk_id = ULID()          │
│ 4. 首片发送时带 total_chunks，后续片只发 operations │
│ 5. 服务端按 chunk_id 聚合，全片到齐才统一响应       │
│ 6. 任意片失败 → 仅重试失败片，不重传成功片          │
└─────────────────────────────────────────────────────┘

断点续传：
- session_id 标识同步会话
- 客户端记录已成功片的 chunk_index
- 重连时仅发送未成功片
- 服务端 24 小时内保留会话上下文
```

---

## 5. 版本向量与冲突检测算法

### 5.1 版本向量设计

```typescript
// 版本向量示例
const versionVector: VersionVector = {
  // 目标表：库存表
  inventory: {
    "inv-uuid-001": 5,      // 数字版本（乐观锁 version 字段）
    "inv-uuid-002": 3,
  },
  // 关联表：工单动作日志
  wo_action_logs: {
    "log-uuid-001": "ulid-01H...",  // ULID 作为版本（纯追加表）
  },
  // 关联表：库存预留
  inventory_reservations: {
    "resv-uuid-001": 2,
  },
};

/** 版本向量比对结果 */
export enum VersionVectorComparison {
  EQUAL = 'EQUAL',                    // 完全一致，无冲突
  CLIENT_AHEAD = 'CLIENT_AHEAD',      // 客户端版本更新，可直接覆盖
  SERVER_AHEAD = 'SERVER_AHEAD',      // 服务端版本更新，需拉取合并
  CONCURRENT = 'CONCURRENT',          // 并发修改，需冲突解决
  DIVERGED = 'DIVERGED',              // 历史分叉，需人工介入
}
```

### 5.2 冲突检测算法

```typescript
function detectConflict(
  clientVV: VersionVector,
  serverVV: VersionVector,
  operation: LocalOperation
): { type: ConflictType; comparison: VersionVectorComparison } {
  
  // 1. 计算相关表的版本比对
  const tables = new Set([...Object.keys(clientVV), ...Object.keys(serverVV)]);
  let hasConcurrent = false;
  let hasServerAhead = false;
  let hasClientAhead = false;
  
  for (const table of tables) {
    const clientRows = clientVV[table] || {};
    const serverRows = serverVV[table] || {};
    const allRows = new Set([...Object.keys(clientRows), ...Object.keys(serverRows)]);
    
    for (const rowPk of allRows) {
      const cv = clientRows[rowPk];
      const sv = serverRows[rowPk];
      
      if (cv === undefined) {
        // 客户端未读取该行，服务端有更新
        hasServerAhead = true;
      } else if (sv === undefined) {
        // 服务端无该行（客户端 CREATE）
        hasClientAhead = true;
      } else if (cv !== sv) {
        // 版本不等 → 并发修改
        hasConcurrent = true;
      }
    }
  }
  
  // 2. 业务规则二次校验（版本向量无法覆盖的语义冲突）
  const businessConflict = checkBusinessRules(operation, serverVV);
  
  // 3. 综合判定
  if (businessConflict) return { type: businessConflict.type, comparison: VersionVectorComparison.CONCURRENT };
  if (hasConcurrent) return { type: ConflictType.VERSION_MISMATCH, comparison: VersionVectorComparison.CONCURRENT };
  if (hasServerAhead && hasClientAhead) return { type: ConflictType.VERSION_MISMATCH, comparison: VersionVectorComparison.DIVERGED };
  if (hasServerAhead) return { type: ConflictType.VERSION_MISMATCH, comparison: VersionVectorComparison.SERVER_AHEAD };
  if (hasClientAhead) return { type: ConflictType.UNIQUE_VIOLATION, comparison: VersionVectorComparison.CLIENT_AHEAD };
  
  return { type: ConflictType.VERSION_MISMATCH, comparison: VersionVectorComparison.EQUAL };
}
```

---

## 6. 冲突解决策略详细矩阵

> **核心原则**：**按业务场景差异化策略**，拒绝通用 LWW

| 业务场景 | 实体类型 | 操作类型 | 冲突类型 | 解决策略 | 理由 |
|----------|----------|----------|----------|----------|------|
| **库存扣减（拣选确认）** | inventory | UPDATE (qty - n) | VERSION_MISMATCH | **TRANSFORM (OT)** | 扣减操作可换序：`qty - a - b = qty - b - a`，转换为基于最新版本的扣减 |
| **库存新增（收货/上架）** | inventory | CREATE/UPDATE (qty + n) | VERSION_MISMATCH | **CRDT_MERGE (PN-Counter)** | 加法可交换，PN-Counter 自动合并 |
| **库存调整（盘点差异）** | inventory | UPDATE (qty = actual) | VERSION_MISMATCH | **MANUAL** | 盘点为绝对值，不可自动合并，需人工核对 |
| **工单状态流转** | work_order | UPDATE (status) | VERSION_MISMATCH | **SERVER_WINS + 通知** | 状态机单向流转，以服务端最新状态为准，推送通知 PDA 刷新 |
| **工单动作日志** | wo_action_log | CREATE | UNIQUE_VIOLATION (同一步骤重复) | **CLIENT_WINS (幂等去重)** | 本地 ID 幂等，服务端按 local_id 去重 |
| **拣选任务分配** | work_order | UPDATE (assignee) | CONCURRENT_OPERATION | **MANUAL** | 同一工单被两人抢单，需调度员裁决 |
| **容器封箱** | container | UPDATE (status=SEALED) | VERSION_MISMATCH | **SERVER_WINS** | 封箱不可逆，以首次成功为准 |
| **库位冻结/解冻** | location | UPDATE (status) | VERSION_MISMATCH | **SERVER_WINS** | 冻结权限收口，服务端权威 |
| **批次/效期录入** | inventory | UPDATE (batch_no, exp_date) | VERSION_MISMATCH | **CLIENT_WINS (较新时间戳)** | PDA 扫码录入为一手数据，优信 PDA |
| **质检结果录入** | quality_inspection | UPDATE (result) | VERSION_MISMATCH | **SERVER_WINS** | 质检结果单一权威源 |
| **设备心跳/状态** | device_state | UPDATE (last_seen, status) | - | **LWW (服务端时间)** | 高频低价值，最后写入胜出 |
| **波次订单增减** | wave_order_mapping | CREATE/DELETE | FK_VIOLATION | **MANUAL** | 涉及波次计划变更，需人工确认 |

---

## 7. OT (Operational Transformation) 算法规范

### 7.1 适用操作：库存数量增减

```typescript
/** 库存操作语义 */
interface InventoryOperation {
  type: 'INCREMENT' | 'DECREMENT' | 'SET';
  delta: number;        // INCREMENT/DECREMENT 用
  target_qty?: number;  // SET 用
  reason: string;       // PICKING, RECEIVING, ADJUSTMENT, COUNT...
  reference_id: string; // work_order_id / receipt_id / ...
}

/** OT 转换函数：将基于旧版本的操作转换为基于新版本的操作 */
function transformInventoryOp(
  clientOp: InventoryOperation,
  serverOps: InventoryOperation[],  // 服务端在客户端版本后发生的操作
  baseQty: number
): InventoryOperation {
  
  // 计算服务端操作的净效果
  let netDelta = 0;
  for (const op of serverOps) {
    if (op.type === 'INCREMENT') netDelta += op.delta;
    else if (op.type === 'DECREMENT') netDelta -= op.delta;
    else if (op.type === 'SET') {
      // SET 操作重置基线，后续增减基于新基线
      baseQty = op.target_qty!;
      netDelta = 0;
    }
  }
  
  // 转换客户端操作
  if (clientOp.type === 'SET') {
    // 绝对值设置：保持原意，但需检查业务规则
    return clientOp;
  }
  
  // 增减操作：直接保持 delta 不变（加法可交换）
  // 但需检查：转换后是否会导致负库存
  const projectedQty = baseQty + netDelta + (clientOp.type === 'INCREMENT' ? clientOp.delta : -clientOp.delta);
  
  if (projectedQty < 0) {
    // 抛出业务规则冲突，转为 MANUAL
    throw new BusinessRuleConflictError('库存不足，无法自动合并扣减操作');
  }
  
  return clientOp;  // delta 不变，直接应用于最新版本
}
```

### 7.2 CRDT (PN-Counter) 合并规范

```typescript
/** PN-Counter 状态（每设备一组 P/N 计数器） */
interface PNCounterState {
  /** 正向计数：{ device_id: count } */
  P: Record<string, number>;
  /** 负向计数：{ device_id: count } */
  N: Record<string, number>;
}

/** 合并两个 PN-Counter */
function mergePNCounter(a: PNCounterState, b: PNCounterState): PNCounterState {
  const allDevices = new Set([...Object.keys(a.P), ...Object.keys(b.P), 
                              ...Object.keys(a.N), ...Object.keys(b.N)]);
  const result: PNCounterState = { P: {}, N: {} };
  
  for (const device of allDevices) {
    result.P[device] = Math.max(a.P[device] || 0, b.P[device] || 0);
    result.N[device] = Math.max(a.N[device] || 0, b.N[device] || 0);
  }
  return result;
}

/** 获取当前值 */
function pnCounterValue(state: PNCounterState): number {
  const sumP = Object.values(state.P).reduce((a, b) => a + b, 0);
  const sumN = Object.values(state.N).reduce((a, b) => a + b, 0);
  return sumP - sumN;
}
```

---

## 8. 本地 SQLite Schema 设计

> 详见 `SQLITE_LOCAL_SCHEMA.md`，此处仅列关键表

```sql
-- 同步队列主表
CREATE TABLE sync_queue (
  local_id TEXT PRIMARY KEY,           -- ULID
  entity_type TEXT NOT NULL,           -- EntityType enum
  operation TEXT NOT NULL,             -- OperationType enum
  entity_id TEXT NOT NULL,             -- 业务主键
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,          -- JSON 完整载荷
  version_vector_json TEXT NOT NULL,   -- JSON 版本向量
  business_context_json TEXT,          -- JSON 业务上下文
  occurred_at TEXT NOT NULL,           -- ISO8601
  status TEXT NOT NULL DEFAULT 'PENDING', -- SyncQueueStatus
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 5,
  last_sync_attempt TEXT,
  last_error TEXT,
  priority INTEGER DEFAULT 2,          -- 1=高, 2=中, 3=低
  chunk_id TEXT,                       -- 分片 ID
  chunk_index INTEGER,
  total_chunks INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sync_queue_status_priority ON sync_queue(status, priority, occurred_at);
CREATE INDEX idx_sync_queue_chunk ON sync_queue(chunk_id, chunk_index);

-- 冲突记录表
CREATE TABLE sync_conflicts (
  conflict_id TEXT PRIMARY KEY,        -- UUID
  local_id TEXT NOT NULL REFERENCES sync_queue(local_id),
  conflict_type TEXT NOT NULL,         -- ConflictType enum
  server_state_json TEXT NOT NULL,     -- 服务端当前状态 JSON
  server_version_vector_json TEXT NOT NULL,
  suggested_resolution TEXT NOT NULL,  -- ConflictResolution enum
  resolution_options_json TEXT NOT NULL, -- ConflictResolutionOption[]
  chosen_resolution TEXT,              -- 用户选择的策略
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 同步会话表（断点续传）
CREATE TABLE sync_sessions (
  session_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  last_synced_server_time TEXT,        -- 服务端时间戳
  pull_cursors_json TEXT,              -- { table: cursor }
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, EXPIRED
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- 本地业务数据表（部分缓存，支持离线查询）
-- 结构与主库对应表一致，额外增加：
--   _local_version INTEGER,           -- 本地版本号
--   _sync_status TEXT,                -- SYNCED, PENDING, CONFLICT
--   _server_version INTEGER,          -- 最后同步的服务端版本
--   _last_synced_at TEXT
```

---

## 9. 增量同步游标设计

### 9.1 游标结构

```typescript
/** 增量同步游标（基于服务端 updated_at + 主键） */
export interface SyncCursor {
  /** 表名 */
  table: EntityType;
  /** 最后同步记录的 updated_at */
  last_updated_at: string;
  /** 最后同步记录的主键（用于去重，同一秒内多条记录） */
  last_pk: string;
  /** 版本号（如有） */
  version?: number | string;
}

/** 客户端维护的游标集合 */
export interface ClientCursors {
  [table: string]: SyncCursor;
}
```

### 9.2 增量拉取查询（服务端）

```sql
-- 服务端增量拉取 SQL 模板
-- 参数：$1=table, $2=last_updated_at, $3=last_pk, $4=limit, $5=tenant_id
SELECT * FROM {table}
WHERE tenant_id = $5
  AND (
    updated_at > $2
    OR (updated_at = $2 AND id > $3)
  )
ORDER BY updated_at ASC, id ASC
LIMIT $4;
```

### 9.3 游标更新规则

| 场景 | 游标更新策略 |
|------|--------------|
| **全量首次同步** | 全表扫描，游标置为最后一条记录 |
| **增量同步成功** | 更新为本批次最后一条记录的 (updated_at, pk) |
| **增量同步部分失败** | 不更新游标，下次重试同一范围 |
| **冲突解决后重试** | 冲突涉及的表游标回退到冲突记录之前 |
| **PDA 切换租户** | 清空所有游标，触发全量同步 |

---

## 10. 同步性能优化

| 优化点 | 方案 | 预期收益 |
|--------|------|----------|
| **请求压缩** | gzip/br 压缩请求体（>1KB 自动压缩） | 带宽 -70% |
| **响应压缩** | Server 端 gzip 响应 | 带宽 -80% |
| **增量拉取** | 游标分页，单次 ≤ 200 条 | 内存/带宽可控 |
| **批量写入** | 服务端事务批量 UPSERT | 写入延迟 -60% |
| **本地索引** | SQLite 关键字段建索引 | 查询/去重 < 10ms |
| **后台预拉取** | WiFi 下后台预拉取高频表（商品、库位） | 离线查询零等待 |
| **差量载荷** | UPDATE 操作仅发送变更字段 + 版本 | 载荷 -50% |
| **并行同步** | 多表并行拉取，操作推送串行 | 总耗时 -40% |

---

## 11. 监控与埋点

### 11.1 关键指标

| 指标名 | 类型 | 采集点 | 告警阈值 |
|--------|------|--------|----------|
| `pda_sync_duration_ms` | Histogram | 客户端/服务端 | P99 > 5000ms |
| `pda_sync_push_success_rate` | Counter/Rate | 服务端 | < 99% |
| `pda_sync_conflict_rate` | Counter/Rate | 服务端 | > 1% |
| `pda_sync_pull_records` | Counter | 服务端 | 突变告警 |
| `pda_sync_queue_depth` | Gauge | 客户端 | > 500 条 |
| `pda_sync_retry_rate` | Counter/Rate | 客户端 | > 10% |
| `pda_offline_duration_sec` | Histogram | 客户端 | > 3600s |
| `pda_clock_drift_ms` | Gauge | 客户端/服务端 | > 5000ms |

### 11.2 结构化日志字段

```json
{
  "timestamp": "2025-07-11T10:30:00.123Z",
  "level": "info",
  "trace_id": "sync-abc123",
  "span_id": "push-001",
  "tenant_id": "tenant-uuid",
  "device_id": "pda-001",
  "service": "device-sync",
  "message": "Sync completed",
  "context": {
    "session_id": "sess-xyz",
    "push_count": 150,
    "pull_count": 320,
    "conflicts": 2,
    "duration_ms": 1250,
    "network_type": "wifi",
    "client_version": "2.1.0"
  }
}
```

---

## 12. 错误码规范

| HTTP | 代码 | 含义 | 客户端处理 |
|------|------|------|------------|
| 200 | `SYNC_PARTIAL_SUCCESS` | 部分成功，有冲突/错误 | 处理冲突，重试错误项 |
| 400 | `INVALID_SYNC_REQUEST` | 请求体校验失败 | 修正请求重试 |
| 401 | `DEVICE_UNAUTHORIZED` | 设备 Token 过期/无效 | 重新登录获取 Token |
| 403 | `TENANT_MISMATCH` | 设备绑定租户不匹配 | 清理本地数据，重新绑定 |
| 409 | `SYNC_CONFLICT` | 存在冲突 | 读取 conflicts 字段，交互解决 |
| 413 | `PAYLOAD_TOO_LARGE` | 单次同步数据过大 | 分片重试 |
| 429 | `SYNC_RATE_LIMITED` | 同步频率超限 | 指数退避重试 |
| 500 | `SYNC_SERVER_ERROR` | 服务端内部错误 | 指数退避重试，上报日志 |
| 503 | `SYNC_SERVICE_UNAVAILABLE` | 同步服务暂不可用 | 延长轮询间隔 |

---

## 13. 安全考量

| 威胁 | 防护措施 |
|------|----------|
| **数据篡改** | 请求体签名（HMAC-SHA256，Device API Key 签名），服务端验签 |
| **重放攻击** | `local_id` 幂等去重（服务端存储已处理 ID，TTL 7 天） |
| **越权同步** | RLS 策略 + `tenant_id` 双重校验，设备绑定租户强校验 |
| **中间人攻击** | 强制 HTTPS，证书锁定 |
| **本地数据泄露** | SQLite 加密（SQLCipher），设备锁屏自动锁库 |
| **版本回滚** | 版本向量单调递增，拒绝版本倒退的同步请求 |

---

## 14. 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2025-07-11 | 初版：协议、数据结构、冲突解决矩阵、OT/CRDT、SQLite Schema、增量游标、监控 | 架构组 |

---

## 15. 待确认决策点（评审时讨论）

| # | 决策点 | 选项 | 建议 | 影响 |
|---|--------|------|------|------|
| 1 | **版本向量粒度** | 行级 vs 表级 | 行级（精准冲突检测） | 存储/计算开销略大 |
| 2 | **冲突解决默认策略** | SERVER_WINS vs MANUAL | 分场景（见矩阵），无全局默认 | 用户体验/数据正确性权衡 |
| 3 | **离线最大存储** | 50MB / 100MB / 无限制 | 100MB（约 50万操作记录） | PDA 存储容量限制 |
| 4 | **同步加密** | 全量加密 / 敏感字段加密 / 仅传输加密 | 传输层 TLS + 本地 SQLCipher | 性能/安全平衡 |
| 5 | **多设备同步冲突** | 乐观合并 / 设备优先级 / 最后写入胜出 | 乐观合并 + 版本向量 | 多 PDA 协同场景 |
| 6 | **后台同步频率** | 固定间隔 / 自适应 / 事件驱动 | 自适应（电量/网络/队列深度） | 电量/实时性平衡 |

---

*本文档为 PDA 离线同步协议的单一事实来源。任何协议变更需同步更新：`DEVICE_PROTOCOL_SPEC.md`、`SQLITE_LOCAL_SCHEMA.md`、`CONFLICT_RESOLUTION_STRATEGY.md`、`SYNC_API_CONTRACT.md`。*