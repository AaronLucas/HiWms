# 冲突解决策略详细矩阵

> **版本**: v1.0.0  
> **状态**: 草案待评审  
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md` (第 6 节), `DEVICE_PROTOCOL_SPEC.md` (2.5/2.6 节), `SQLITE_LOCAL_SCHEMA.md` (sync_conflicts 表)

---

## 1. 冲突分类体系

### 1.1 冲突类型枚举

```typescript
enum ConflictType {
  // 技术层面冲突
  VERSION_MISMATCH      = 'VERSION_MISMATCH',       // 版本向量不匹配（乐观锁冲突）
  UNIQUE_VIOLATION      = 'UNIQUE_VIOLATION',       // 唯一键冲突（PDA 创建实体服务端已存在）
  FK_VIOLATION          = 'FK_VIOLATION',           // 外键冲突（引用实体服务端不存在/已删）
  
  // 业务层面冲突
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION', // 库存不足、库位冻结、效期过期等
  CONCURRENT_OPERATION    = 'CONCURRENT_OPERATION',    // 同一实体被多设备并发操作
  
  // 语义冲突
  SEMANTIC_DIVERGENCE   = 'SEMANTIC_DIVERGENCE',   // 同一业务动作语义不兼容（如：PDA 取消 vs 服务端已完成）
}
```

### 1.2 冲突严重度分级

| 严重度 | 定义 | 处理时效 | 默认策略 | 示例 |
|--------|------|----------|----------|------|
| **P0 阻断** | 导致数据不一致、财务损失、安全违规 | 立即 | MANUAL | 库存扣减导致负库存、危险品混存 |
| **P1 重要** | 影响业务流程正确性，需人工确认 | 1 小时内 | MANUAL / SERVER_WINS | 工单状态流转冲突、拣选任务重复分配 |
| **P2 一般** | 可自动合并或有明确业务规则 | 同步周期内 | TRANSFORM / CRDT_MERGE / CLIENT_WINS | 库存增减、容器状态更新 |
| **P3 低** | 高频低价值，最后写入胜出即可 | 后台异步 | SERVER_WINS (LWW) | 设备心跳、最后在线时间、GPS 坐标 |

---

## 2. 核心业务场景冲突解决矩阵

> **阅读指南**：每行代表一个典型业务场景。"检测点"说明服务端如何识别冲突。"解决策略"为首选策略，"备选策略"为用户可选。

| # | 业务场景 | 实体/操作 | 冲突类型 | 检测点 | 首选策略 | 备选策略 | 理由 |
|---|----------|-----------|----------|--------|----------|----------|------|
| **1** | **拣选确认扣减库存** | `inventory` UPDATE (qty - n) | VERSION_MISMATCH | inventory._version 不匹配 | **TRANSFORM (OT)** | MANUAL | 加法可交换，OT 转换保证最终一致性，无需人工 |
| **2** | **收货/上架/盘点盈亏增库存** | `inventory` UPDATE (qty + n) | VERSION_MISMATCH | inventory._version 不匹配 | **CRDT_MERGE (PN-Counter)** | CLIENT_WINS | 加法天然可合并，PN-Counter 自动收敛 |
| **3** | **盘点差异调整（设置绝对值）** | `inventory` UPDATE (qty = actual) | VERSION_MISMATCH | inventory._version 不匹配 | **MANUAL** | SERVER_WINS | 绝对值覆盖不可交换，盘点为一手数据需人工核对 |
| **4** | **批次/效期录入** | `inventory` UPDATE (batch_no, exp_date) | VERSION_MISMATCH | inventory._version 不匹配 | **CLIENT_WINS (较新时间戳)** | MANUAL | PDA 扫码为一手录入，优信 PDA 端数据 |
| **5** | **工单状态流转** | `work_order` UPDATE (status) | VERSION_MISMATCH | work_order._version 不匹配 | **SERVER_WINS + 推送通知** | MANUAL | 状态机单向流转，以服务端权威状态为准 |
| **6** | **工单抢单/指派冲突** | `work_order` UPDATE (assignee_id) | CONCURRENT_OPERATION | 同一工单两设备同时抢单 | **MANUAL** | SERVER_WINS | 需调度员裁决，避免重复作业 |
| **7** | **工单动作日志追加** | `wo_action_log` CREATE | UNIQUE_VIOLATION (local_id) | sync_queue.payload_hash 去重 | **CLIENT_WINS (幂等去重)** | - | 本地 ULID 幂等，服务端按 local_id 去重即可 |
| **8** | **容器封箱** | `container` UPDATE (status=SEALED) | VERSION_MISMATCH | container._version 不匹配 | **SERVER_WINS** | MANUAL | 封箱不可逆，首次成功为准 |
| **9** | **库位冻结/解冻** | `location` UPDATE (status) | VERSION_MISMATCH | location._version 不匹配 | **SERVER_WINS** | - | 冻结权限收口服务端，PDA 只读 |
| **10** | **打包任务加箱/改箱** | `packing_task` UPDATE (container_lpn, boxes_count) | VERSION_MISMATCH | packing_task._version 不匹配 | **TRANSFORM** | MANUAL | 箱数增减可转换，但涉及面单打印需谨慎 |
| **11** | **面单打印/重打** | `packing_task` UPDATE (label_url, printed_count) | VERSION_MISMATCH | packing_task._version 不匹配 | **SERVER_WINS** | CLIENT_WINS | 面单幂等，以服务端记录为准 |
| **12** | **分拣滑道分配** | `sorting_task` UPDATE (chute_id) | VERSION_MISMATCH / CONCURRENT_OPERATION | sorting_task._version 不匹配 | **SERVER_WINS** | MANUAL | 滑道资源独占，服务端统一调度 |
| **13** | **质检结果录入** | `quality_inspection` UPDATE (result) | VERSION_MISMATCH | inspection._version 不匹配 | **SERVER_WINS** | MANUAL | 质检结果单一权威源 |
| **14** | **异常上报/照片** | `wo_action_log` CREATE / `pending_uploads` CREATE | UNIQUE_VIOLATION | 幂等键冲突 | **CLIENT_WINS (幂等去重)** | - | 纯追加日志，去重即可 |
| **15** | **设备心跳/状态** | `device_state` UPDATE (last_seen, status) | - | 高频低价值 | **LWW (SERVER_WINS)** | - | 最后写入胜出，无业务影响 |
| **16** | **波次订单增减** | `wave_order_mapping` CREATE/DELETE | FK_VIOLATION / CONCURRENT_OPERATION | wave_id/order_id 引用校验 | **MANUAL** | - | 涉及波次计划变更，需人工确认 |
| **17** | **补货任务创建/取消** | `replenishment_task` CREATE/DELETE | VERSION_MISMATCH | task._version 不匹配 | **SERVER_WINS** | - | 补货由后台调度引擎驱动 |
| **18** | **商品主数据更新** | `products` UPDATE (specs, constraints) | VERSION_MISMATCH | products._version 不匹配 | **SERVER_WINS** | - | 主数据服务端权威，PDA 只读 |
| **19** | **库位主数据更新** | `locations` UPDATE (capacity, zone) | VERSION_MISMATCH | locations._version 不匹配 | **SERVER_WINS** | - | 主数据服务端权威 |
| **20** | **PDA 离线创建新工单/任务** | `work_order`/`tasks` CREATE | UNIQUE_VIOLATION (wo_no/task_no) | 业务单号冲突 | **MANUAL** | CLIENT_WINS (重新分配单号) | 离线创建单号可能重复，需服务端重新分配 |

---

## 3. 解决策略算法规范

### 3.1 OT (Operational Transformation) - 库存增减

**适用场景**：场景 1、2、10（数量加减操作）

```typescript
interface InventoryOp {
  type: 'INCREMENT' | 'DECREMENT' | 'SET';
  delta?: number;      // INCREMENT/DECREMENT
  targetQty?: number;  // SET
  reason: string;      // PICKING, RECEIVING, ADJUSTMENT, COUNT...
  refId: string;       // work_order_id / receipt_id / ...
}

/**
 * OT 转换函数：将基于旧版本的客户端操作转换为基于最新版本的操作
 * @param clientOp 客户端操作
 * @param serverOps 服务端在客户端版本后发生的操作序列
 * @param baseQty 客户端操作基准时的库存量
 * @returns 转换后的操作，或抛出 BusinessRuleConflictError
 */
function transformInventoryOp(
  clientOp: InventoryOp,
  serverOps: InventoryOp[],
  baseQty: number
): InventoryOp {
  // 1. 计算服务端操作的净效果
  let netDelta = 0;
  let currentBase = baseQty;
  
  for (const op of serverOps) {
    if (op.type === 'SET') {
      // SET 重置基线
      currentBase = op.targetQty!;
      netDelta = 0;
    } else if (op.type === 'INCREMENT') {
      netDelta += op.delta!;
    } else if (op.type === 'DECREMENT') {
      netDelta -= op.delta!;
    }
  }
  
  // 2. 转换客户端操作
  if (clientOp.type === 'SET') {
    // 绝对值设置：保持原意，但需业务规则校验
    if (clientOp.targetQty! < 0) {
      throw new BusinessRuleConflictError('库存不能为负');
    }
    return clientOp;
  }
  
  // 3. 增减操作：delta 不变（加法可交换）
  const projectedQty = currentBase + netDelta + 
    (clientOp.type === 'INCREMENT' ? clientOp.delta! : -clientOp.delta!);
  
  // 4. 业务规则校验：防止负库存
  if (projectedQty < 0) {
    throw new BusinessRuleConflictError(
      `库存不足：当前可用 ${currentBase + netDelta}，请求扣减 ${clientOp.delta}`
    );
  }
  
  return clientOp; // delta 保持不变，直接应用于最新版本
}
```

### 3.2 CRDT (PN-Counter) - 纯增量计数

**适用场景**：场景 2（收货入库、盘点盈余）、场景 14（日志追加计数）

```typescript
interface PNCounter {
  P: Map<string, number>;  // device_id -> 正向计数
  N: Map<string, number>;  // device_id -> 负向计数
}

/** 合并两个 PN-Counter */
function mergePNCounter(a: PNCounter, b: PNCounter): PNCounter {
  const devices = new Set([...a.P.keys(), ...b.P.keys(), ...a.N.keys(), ...b.N.keys()]);
  const result: PNCounter = { P: new Map(), N: new Map() };
  
  for (const d of devices) {
    result.P.set(d, Math.max(a.P.get(d) || 0, b.P.get(d) || 0));
    result.N.set(d, Math.max(a.N.get(d) || 0, b.N.get(d) || 0));
  }
  return result;
}

/** 获取当前值 */
function pnCounterValue(c: PNCounter): number {
  let sumP = 0, sumN = 0;
  for (const v of c.P.values()) sumP += v;
  for (const v of c.N.values()) sumN += v;
  return sumP - sumN;
}

/** PDA 端：本地执行入库 +10 */
function localIncrement(deviceId: string, delta: number): PNCounter {
  return { P: new Map([[deviceId, delta]]), N: new Map() };
}

/** 服务端：合并所有设备增量 */
function serverMerge(deviceOps: Map<string, PNCounter>): PNCounter {
  let merged: PNCounter = { P: new Map(), N: new Map() };
  for (const op of deviceOps.values()) {
    merged = mergePNCounter(merged, op);
  }
  return merged;
}
```

### 3.3 LWW (Last Writer Wins) - 设备状态

**适用场景**：场景 15（心跳、GPS、电量、最后在线时间）

```typescript
interface LWWRegister<T> {
  value: T;
  timestamp: number;      // 服务端时间戳（毫秒）
  deviceId: string;
}

/** 合并：取时间戳最大者 */
function mergeLWW<T>(a: LWWRegister<T>, b: LWWRegister<T>): LWWRegister<T> {
  return a.timestamp >= b.timestamp ? a : b;
}
```

### 3.4 语义合并 - 复杂对象字段级合并

**适用场景**：场景 4（批次/效期）、场景 10（打包任务部分字段）

```typescript
interface MergeRule {
  field: string;
  strategy: 'CLIENT_WINS' | 'SERVER_WINS' | 'LATEST_TIMESTAMP' | 'CUSTOM';
  customFn?: (clientVal: any, serverVal: any, context: MergeContext) => any;
}

const inventoryMergeRules: MergeRule[] = [
  { field: 'quantity', strategy: 'OT_TRANSFORM' },
  { field: 'reserved_qty', strategy: 'OT_TRANSFORM' },
  { field: 'locked_qty', strategy: 'OT_TRANSFORM' },
  { field: 'picking_priority', strategy: 'SERVER_WINS' },      // 优先级服务端权威
  { field: 'batch_no', strategy: 'LATEST_TIMESTAMP' },         // 以较新录入为准
  { field: 'exp_date', strategy: 'LATEST_TIMESTAMP' },
  { field: 'mfg_date', strategy: 'LATEST_TIMESTAMP' },
  { field: '_version', strategy: 'SERVER_WINS' },
  { field: '_synced_at', strategy: 'SERVER_WINS' },
];

function semanticMerge(
  clientObj: Record<string, any>,
  serverObj: Record<string, any>,
  rules: MergeRule[],
  context: MergeContext
): Record<string, any> {
  const result = { ...serverObj }; // 基于服务端最新状态
  
  for (const rule of rules) {
    const clientVal = clientObj[rule.field];
    const serverVal = serverObj[rule.field];
    
    if (clientVal === undefined) continue; // 客户端未修改该字段
    
    switch (rule.strategy) {
      case 'CLIENT_WINS':
        result[rule.field] = clientVal;
        break;
      case 'SERVER_WINS':
        result[rule.field] = serverVal;
        break;
      case 'LATEST_TIMESTAMP':
        result[rule.field] = (clientObj._local_updated_at || 0) > (serverObj.updated_at || 0)
          ? clientVal : serverVal;
        break;
      case 'OT_TRANSFORM':
        // 交由 OT 处理，此处保留服务端值，OT 在应用层执行
        break;
      case 'CUSTOM':
        result[rule.field] = rule.customFn!(clientVal, serverVal, context);
        break;
    }
  }
  return result;
}
```

---

## 4. 冲突解决工作流

### 4.1 自动解决流程（无需人工）

```
同步推送
    │
    ▼
┌─────────────────────┐
│ 冲突检测引擎          │
│ - 版本向量比对        │
│ - 业务规则校验        │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
 无冲突       有冲突
    │           │
    ▼           ▼
 写入主库    策略分类
    │           │
    ▼    ┌──────┼──────┐
         ▼      ▼      ▼
      OT转换  CRDT合并  LWW
    (库存增减) (计数器)  (心跳)
         │      │      │
         └──────┼──────┘
                ▼
         写入主库成功
                │
                ▼
         返回 SUCCESS
                │
                ▼
         PDA 标记 COMPLETED
         更新本地版本向量
```

### 4.2 人工介入流程（P0/P1 冲突）

```
同步推送
    │
    ▼
┌─────────────────────┐
│ 冲突检测 → 生成冲突记录 │
│ 写入 sync_conflicts   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 返回 409 SYNC_CONFLICT │
│ conflicts[] 含预览选项  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ PDA 端展示冲突解决 UI   │
│ - 并排对比：本地 vs 服务端 │
│ - 业务上下文提示         │
│ - 策略选项卡             │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
用户选择      自动策略
策略          (OT/CRDT)
    │           │
    ▼           ▼
POST /resolve  自动重试同步
    │
    ▼
┌─────────────────────┐
│ 服务端执行合并         │
│ 更新 sync_conflicts   │
│ 返回 merged_operation  │
└─────────┬───────────┘
          │
          ▼
   PDA 重试同步 → SUCCESS
```

### 4.3 冲突解决 UI 规范（PDA 端）

```typescript
// 冲突详情展示组件 Props
interface ConflictResolutionViewProps {
  conflict: SyncConflict;
  onResolve: (strategy: ConflictResolution, note?: string) => Promise<void>;
}

/* 
 * 界面布局：
 * ┌─────────────────────────────────────┐
 * │ ⚠️ 同步冲突 - 需要您的确认             │
 * ├─────────────────────────────────────┤
 * │ 任务：拣选单 WO-20250711-001         │
 * │ 操作：确认拣选数量 10 件              │
 * │ 时间：2025-07-11 10:28:15            │
 * ├─────────────────────────────────────┤
 * │ 本地操作          服务端当前状态       │
 * │ ┌─────────────┐   ┌─────────────┐    │
 * │ │ 数量: 10      │   │ 数量: 8       │    │
 * │ │ 批次: B-001   │   │ 批次: B-001   │    │
 * │ │ 状态: IN_PROG │   │ 状态: COMPLETED│   │
 * │ └─────────────┘   └─────────────┘    │
 * ├─────────────────────────────────────┤
 * │ 冲突原因：服务端显示工单已完成，可能是 │
 * │ 另一台 PDA 已执行完毕。               │
 * ├─────────────────────────────────────┤
 * │ [使用服务端状态] [强制覆盖] [人工核对]  │
 * │    (推荐)        (谨慎)    (联系调度)   │
 * └─────────────────────────────────────┘
 */
```

**策略选项映射**：

| UI 按钮 | 策略枚举 | 适用场景 | 确认级别 |
|---------|----------|----------|----------|
| "使用服务端状态" | `SERVER_WINS` | 工单状态流转、容器封箱、库位冻结 | 单击确认 |
| "强制覆盖" | `CLIENT_WINS` | 批次/效期录入、盘点差异（确认无误） | 双击/长按确认 + 二次弹窗 |
| "智能合并" | `TRANSFORM` / `CRDT_MERGE` | 库存增减、计数器 | 自动执行，无 UI |
| "人工核对" | `MANUAL` | 抢单冲突、波次变更、负库存风险 | 跳转详情页，需录入备注 |

---

## 5. 版本向量冲突判定规则

### 5.1 比对算法

```typescript
enum VVComparison {
  EQUAL = 'EQUAL',                    // 完全一致
  CLIENT_AHEAD = 'CLIENT_AHEAD',      // 客户端版本更新（本地有服务端未见的操作）
  SERVER_AHEAD = 'SERVER_AHEAD',      // 服务端版本更新（需增量拉取）
  CONCURRENT = 'CONCURRENT',          // 并发修改（版本分叉）
  DIVERGED = 'DIVERGED',              // 历史分叉严重（需全量同步/人工）
}

function compareVersionVectors(
  clientVV: VersionVector,
  serverVV: VersionVector
): Map<string, VVComparison> {
  const result = new Map<string, VVComparison>();
  const allTables = new Set([...Object.keys(clientVV), ...Object.keys(serverVV)]);
  
  for (const table of allTables) {
    const cRows = clientVV[table] || {};
    const sRows = serverVV[table] || {};
    const allRows = new Set([...Object.keys(cRows), ...Object.keys(sRows)]);
    
    let tableResult: VVComparison = VVComparison.EQUAL;
    
    for (const rowPk of allRows) {
      const cv = cRows[rowPk];
      const sv = sRows[rowPk];
      
      if (cv === undefined && sv !== undefined) {
        tableResult = VVComparison.SERVER_AHEAD;
      } else if (cv !== undefined && sv === undefined) {
        tableResult = VVComparison.CLIENT_AHEAD;
      } else if (cv !== sv) {
        tableResult = VVComparison.CONCURRENT;
      }
    }
    result.set(table, tableResult);
  }
  return result;
}
```

### 5.2 判定矩阵 → 策略映射

| 版本向量比对结果 | 业务规则校验 | 最终策略 |
|-----------------|-------------|----------|
| ALL `EQUAL` | 通过 | `SUCCESS` (无冲突) |
| `CLIENT_AHEAD` | 通过 | `CLIENT_WINS` / `OT_TRANSFORM` |
| `SERVER_AHEAD` | 通过 | `SERVER_WINS` (需先拉取合并) |
| `CONCURRENT` | 通过 | 场景矩阵决定 (OT/CRDT/MANUAL) |
| `CONCURRENT` | **失败** | `BUSINESS_RULE_VIOLATION` → `MANUAL` |
| `DIVERGED` | - | `MANUAL` (需全量同步/管理员介入) |

---

## 6. 幂等性与去重保证

### 6.1 客户端幂等键设计

```typescript
// 每个本地操作生成唯一 local_id (ULID)
const localId = ulid(); // 含 48位时间戳 + 80位随机，单调递增

// 同步请求携带 local_id，服务端存储已处理 ID 集合（Redis Set，TTL 7 天）
// 幂等判定：local_id 已存在 → 直接返回原结果，不重复执行
```

### 6.2 载荷哈希去重

```sql
-- sync_queue.payload_hash = SHA256(payload_json)
-- 服务端同步处理前查询：
SELECT 1 FROM processed_payloads WHERE hash = $1 AND created_at > now() - interval '7 days';
-- 存在则视为重复推送，返回原结果
```

### 6.3 幂等性保证矩阵

| 操作类型 | 幂等键 | 服务端去重 | 备注 |
|----------|--------|------------|------|
| CREATE | `local_id` + `payload_hash` | ✅ | 业务单号由服务端分配 |
| UPDATE | `local_id` + `entity_id` + `version` | ✅ | 乐观锁版本防丢更新 |
| DELETE | `local_id` + `entity_id` | ✅ | 删除即幂等 |
| COMPOUND | `local_id` + 子操作哈希数组 | ✅ | 原子事务，全成功或全失败 |

---

## 7. 特殊场景处理

### 7.1 网络分区期间的"乐观执行"

```typescript
// PDA 离线时执行拣选确认
function offlinePickConfirm(taskId, lineId, qty) {
  // 1. 本地库存预扣减（乐观）
  const inv = db.inventory.find({product_id: line.product_id, location_id: line.location_id});
  if (inv.quantity < qty) {
    throw new OfflineBusinessError('本地库存不足，无法离线执行');
  }
  inv.quantity -= qty;
  inv._local_dirty = 1;
  inv._version++;
  
  // 2. 写入操作日志
  db.wo_action_logs.insert({...});
  
  // 3. 入同步队列
  db.sync_queue.insert({operation: 'UPDATE', entity_type: 'inventory', ...});
  
  // 4. 即时反馈 UI 成功
  return {success: true, local_only: true};
}
```

**风险**：离线预扣减可能导致联网后发现库存不足
**缓解**：
- 同步时优先推送高优先级扣减操作
- 服务端执行前再次校验，不足则返回 `BUSINESS_RULE_VIOLATION` 冲突
- PDA 端展示"库存不足，请补货或调整数量"，用户可修改数量重试

### 7.2 多设备协同同一工单

| 场景 | 冲突类型 | 解决方案 |
|------|----------|----------|
| 两台 PDA 同时抢同一工单 | `CONCURRENT_OPERATION` | 服务端分布式锁，先到者得，后到者返回 `TASK_ALREADY_ASSIGNED` |
| 两台 PDA 同时拣选同一库位不同商品 | 无冲突（不同 inventory 行） | 版本向量隔离行级，自动合并 |
| 两台 PDA 同时拣选同一库位同一商品 | `VERSION_MISMATCH` | OT 转换扣减，最终库存正确 |
| PDA A 取消工单，PDB B 正在执行 | `SEMANTIC_DIVERGENCE` | 服务端拒绝取消（状态已流转），推送通知 PDA A |

### 7.3 跨租户 PDA 切换

```typescript
// PDA 切换租户时的同步清理流程
async function switchTenant(newTenantId: string) {
  // 1. 强制同步当前租户未完成操作
  await forceSyncCurrentTenant();
  
  // 2. 清理本地业务数据表（保留设备/配置表）
  await db.clearTenantData(currentTenantId);
  
  // 3. 重置同步游标
  await db.sync_cursors.deleteWhere({tenant_id: currentTenantId});
  
  // 4. 登录新租户，触发全量同步
  await login(newTenantId);
  await fullSync();
}
```

---

## 8. 监控与告警指标

| 指标名 | 类型 | 采集点 | 告警阈值 | 含义 |
|--------|------|--------|----------|------|
| `sync_conflict_total` | Counter | 服务端 | - | 总冲突数 |
| `sync_conflict_by_type` | Counter | 服务端 | `VERSION_MISMATCH` > 100/min | 按类型分布 |
| `sync_conflict_by_strategy` | Counter | 服务端 | `MANUAL` > 10/min | 需人工介入过多 |
| `sync_conflict_resolution_time_sec` | Histogram | 服务端 | P99 > 300s | 人工解决耗时 |
| `sync_manual_conflict_rate` | Gauge | 服务端 | > 5% | 人工冲突占比 |
| `sync_business_rule_violation` | Counter | 服务端 | > 1/min | 业务规则冲突（库存不足等） |
| `pda_offline_duration_sec` | Histogram | 客户端 | P99 > 3600 | 离线时长分布 |
| `sync_retry_rate` | Gauge | 客户端 | > 20% | 重试率过高 |

---

## 9. 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2025-07-11 | 初版：20 场景矩阵、OT/CRDT/LWW 算法、工作流、UI 规范、监控指标 | 架构组 |

---

*本文档为冲突解决策略单一事实来源。任何策略变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（第 6 节矩阵）、`DEVICE_PROTOCOL_SPEC.md`（冲突响应契约）、`SQLITE_LOCAL_SCHEMA.md`（sync_conflicts 表结构）。*