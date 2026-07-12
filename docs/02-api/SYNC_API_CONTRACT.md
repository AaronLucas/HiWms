# 同步接口完整契约规范

> **版本**: v1.0.0  
> **状态**: 草案待评审  
> **基础路径**: `/api/v1/device/sync`  
> **协议**: HTTPS / JSON  
> **认证**: Device JWT + API Key  
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`, `DEVICE_PROTOCOL_SPEC.md` (2.3 节), `SQLITE_LOCAL_SCHEMA.md`, `CONFLICT_RESOLUTION_STRATEGY.md`

---

## 1. 接口概览

| 接口 | 方法 | 路径 | 说明 | 幂等 |
|------|------|------|------|------|
| **同步推送/拉取** | POST | `/sync` | 核心双向同步接口 | ✅ (local_id) |
| **同步状态查询** | GET | `/sync/status` | 查询会话状态 | ✅ |
| **冲突列表** | GET | `/sync/conflicts` | 分页获取未解决冲突 | ✅ |
| **解决冲突** | POST | `/sync/conflicts/{id}/resolve` | 提交冲突解决策略 | ✅ (conflict_id) |
| **获取增量游标** | GET | `/sync/cursors` | 查询当前游标位置 | ✅ |
| **重置游标** | POST | `/sync/cursors/reset` | 触发全量同步 | ⚠️ 非幂等 |

---

## 2. 核心同步接口 - POST /sync

### 2.1 请求规范

```http
POST /api/v1/device/sync HTTP/1.1
Host: api.wms7.com
Authorization: Bearer <device_access_token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
X-Client-Version: 2.1.0
X-Request-Id: <ulid>           # 请求级幂等键
Content-Type: application/json
Content-Encoding: gzip         # >1KB 建议压缩
Accept: application/json
Accept-Encoding: gzip, br
```

#### 2.1.1 请求体 Schema

```typescript
interface SyncRequest {
  // 会话标识
  session_id: string;                    // ULID，首次同步生成，后续复用
  
  // 时间同步
  client_time: string;                   // ISO8601 UTC，PDA 本地时间
  last_synced_server_time?: string;      // 上次同步成功的服务端时间
  
  // 推送操作（分片）
  operations: LocalOperation[];          // 本批次操作，≤ 200 条
  chunk_meta?: ChunkMeta;                // 分片元信息（大批量时）
  
  // 拉取配置
  pull_tables?: EntityType[];            // 需增量拉取的表，默认全量高频表
  pull_cursors?: Record<string, SyncCursor>; // 游标位置
  pull_limit?: number;                   // 单表拉取上限，默认 200，最大 500
  
  // 设备上下文
  device_context: DeviceContext;
}

interface LocalOperation {
  local_id: string;                      // ULID，全局唯一幂等键
  entity_type: EntityType;               // 实体类型枚举
  operation: OperationType;              // CREATE | UPDATE | DELETE | COMPOUND
  entity_id: string;                     // 业务主键
  payload: Record<string, unknown>;      // 完整新值或增量字段
  version_vector: VersionVector;         // 操作时刻的版本向量快照
  business_context?: BusinessContext;    // 可选，冲突解决用
  occurred_at: string;                   // ISO8601，操作发生时间
  sync_meta: SyncMetadata;               // 优先级、重试、分片信息
}

interface VersionVector {
  [table: string]: {
    [row_pk: string]: number | string;   // 数字版本或 ULID
  };
}

interface SyncMetadata {
  retry_count: number;
  max_retries: number;
  priority: 1 | 2 | 3;                   // 1=高(拣选/发货) 2=中(收货/上架) 3=低(盘点/移库)
  chunk_id?: string;
  chunk_index?: number;
  total_chunks?: number;
}

interface ChunkMeta {
  chunk_id: string;                      // 同步会话分片 ID
  chunk_index: number;                   // 0-based
  total_chunks: number;                  // 总分片数
  is_final: boolean;                     // 是否最后一片
}

interface SyncCursor {
  updated_at: string;                    // 最后一条记录的 updated_at
  pk: string;                            // 最后一条记录的主键
  version?: number | string;             // 版本号（如有）
}

interface DeviceContext {
  network_type: 'wifi' | '4g' | '5g' | 'ethernet' | 'offline';
  battery_level: number;                 // 0-100
  storage_free_mb: number;
  gps?: { lat: number; lng: number; accuracy: number };
  app_version: string;
  os_version: string;
}
```

#### 2.1.2 实体类型枚举

```typescript
enum EntityType {
  // 核心业务
  INVENTORY = 'inventory',
  INVENTORY_RESERVATION = 'inventory_reservation',
  INVENTORY_LOCK = 'inventory_lock',
  WORK_ORDER = 'work_order',
  WO_ACTION_LOG = 'wo_action_log',
  ORDER = 'order',
  ORDER_LINE = 'order_line',
  WAVE = 'wave',
  WAVE_ORDER_MAPPING = 'wave_order_mapping',
  
  // 入库
  INBOUND_RECEIPT = 'inbound_receipt',
  INSPECTION_ITEM = 'inspection_item',
  ASN_HEADER = 'asn_header',
  ASN_LINE = 'asn_line',
  
  // 出库作业
  PACKING_TASK = 'packing_task',
  SORTING_TASK = 'sorting_task',
  SORTING_CHUTE = 'sorting_chute',
  LOADING_TASK = 'loading_task',
  
  // 质检/VAS
  QUALITY_INSPECTION = 'quality_inspection',
  VAS_BOM = 'vas_bom',
  VAS_BOM_ITEM = 'vas_bom_item',
  
  // 发货/运输
  SHIPPING_DOCUMENT = 'shipping_document',
  VEHICLE = 'vehicle',
  
  // 跨库/直通
  CROSS_DOCK_JOB = 'cross_dock_job',
  
  // 主数据（只读镜像）
  PRODUCT = 'product',
  PRODUCT_CONSTRAINT = 'product_constraint',
  LOCATION = 'location',
  CONTAINER = 'container',
  PACKAGE_SPEC = 'package_spec',
  LABEL_TEMPLATE = 'label_template',
  VERIFICATION_RULE = 'verification_rule',
  
  // 设备/用户
  DEVICE = 'device',
  USER = 'user',
  ROLE = 'role',
  
  // 计费
  BILLING_RULE = 'billing_rule',
  BILLING_TRANSACTION = 'billing_transaction',
  
  // 系统
  DEVICE_STATE = 'device_state',
  SYNC_QUEUE = 'sync_queue',           // 内部用
  SYNC_CONFLICT = 'sync_conflict',     // 内部用
}
```

#### 2.1.3 操作类型枚举

```typescript
enum OperationType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  COMPOUND = 'COMPOUND',               // 复合操作：多表原子事务
}
```

---

### 2.2 响应规范

#### 2.2.1 成功响应 (200 OK)

```typescript
interface SyncResponse {
  session_id: string;
  server_time: string;                 // ISO8601 UTC，PDA 校准本地时钟用
  
  // 推送结果
  push_results: PushResult[];
  conflicts: SyncConflict[];           // 空数组表示无冲突
  
  // 拉取数据
  pull_data?: PullData;
  
  // 统计
  stats: SyncStats;
  
  // 下次同步建议
  next_sync_interval_sec: number;      // 建议间隔，动态调整
  rate_limit?: RateLimitInfo;
}

interface PushResult {
  local_id: string;
  status: 'SUCCESS' | 'CONFLICT' | 'ERROR';
  
  // SUCCESS 时
  server_entity_id?: string;           // CREATE 时服务端生成的 ID
  server_version?: number | string;    // 服务端版本
  
  // ERROR 时
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  
  // CONFLICT 时
  conflict_id?: string;
}

interface SyncConflict {
  conflict_id: string;                 // 服务端生成
  local_id: string;                    // 关联的操作 local_id
  
  conflict_type: ConflictType;         // 见 CONFLICT_RESOLUTION_STRATEGY.md
  
  // 冲突详情
  local_operation: LocalOperation;     // 完整的本地操作
  server_state: Record<string, unknown>; // 服务端当前完整状态
  server_version_vector: VersionVector;
  
  // 解决建议
  suggested_resolution: ConflictResolution;
  resolution_options: ConflictResolutionOption[];
  
  created_at: string;
}

interface ConflictResolutionOption {
  strategy: ConflictResolution;
  description: string;
  preview_result?: Record<string, unknown>;
  requires_confirmation: boolean;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface PullData {
  [entityType: string]: {
    records: Record<string, unknown>[]; // 实体数组
    cursor: SyncCursor;                 // 下次拉取起点
    has_more: boolean;                  // 是否还有更多数据
  };
}

interface SyncStats {
  pushed: number;
  succeeded: number;
  conflicts: number;
  errors: number;
  pulled_records: number;
  duration_ms: number;
  chunks_received?: number;
  chunks_total?: number;
}
```

#### 2.2.2 分片同步响应

```typescript
// 非最后一片：仅确认收到，不返回 pull_data
interface ChunkAckResponse {
  session_id: string;
  chunk_id: string;
  chunk_index: number;
  received_count: number;
  status: 'CHUNK_RECEIVED';
  next_chunk_expected: number;
}

// 最后一片：返回完整 SyncResponse
```

#### 2.2.3 错误响应

| HTTP | 错误码 | 含义 | 客户端处理 |
|------|--------|------|------------|
| 400 | `INVALID_SYNC_REQUEST` | 请求体 Schema 校验失败 | 记录日志，不重试，上报开发 |
| 401 | `UNAUTHORIZED` | Token 过期/无效 | 刷新 Token 重试 |
| 403 | `DEVICE_SUSPENDED` | 设备被禁用 | 停止同步，提示联系管理员 |
| 403 | `TENANT_MISMATCH` | 租户不匹配 | 清理本地数据，重新登录 |
| 409 | `SYNC_CONFLICT` | 存在冲突 | `conflicts` 非空，按策略解决后重试 |
| 413 | `PAYLOAD_TOO_LARGE` | 单次请求 > 2MB | 分片重试 |
| 429 | `SYNC_RATE_LIMITED` | 同步过于频繁 | 读取 `Retry-After`，指数退避 |
| 500 | `INTERNAL_ERROR` | 服务端异常 | 指数退避重试，上报日志 |
| 503 | `SERVICE_UNAVAILABLE` | 同步服务维护中 | 延长轮询间隔至 5 分钟 |

---

## 3. 同步状态查询 - GET /sync/status

### 3.1 请求

```http
GET /api/v1/device/sync/status?session_id=sync-ulid-001 HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
```

### 3.2 响应

```json
{
  "success": true,
  "data": {
    "session_id": "sync-ulid-001",
    "status": "COMPLETED",
    "started_at": "2025-07-11T10:30:00.123Z",
    "completed_at": "2025-07-11T10:30:00.357Z",
    "stats": {
      "pushed": 10,
      "succeeded": 9,
      "conflicts": 1,
      "errors": 0,
      "pulled_records": 45
    },
    "chunks": {
      "total": 1,
      "completed": 1
    }
  },
  "meta": {
    "request_id": "req-ulid",
    "timestamp": "2025-07-11T10:30:00.400Z"
  }
}
```

**状态值**：
- `PENDING` - 会话创建，未开始处理
- `PROCESSING` - 正在处理分片
- `COMPLETED` - 全部分片处理完毕
- `PARTIAL` - 部分成功，有未解决冲突
- `FAILED` - 处理失败
- `EXPIRED` - 会话超时（24 小时）

---

## 4. 冲突列表 - GET /sync/conflicts

### 4.1 请求参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `status` | string | `UNRESOLVED` | `UNRESOLVED`, `RESOLVED`, `IGNORED`, `ALL` |
| `entity_type` | string | - | 按实体类型筛选 |
| `conflict_type` | string | - | 按冲突类型筛选 |
| `limit` | integer | 50 | 最大 200 |
| `offset` | integer | 0 | 分页偏移 |
| `sort` | string | `-created_at` | 排序字段，`-` 前缀降序 |

### 4.2 响应

```json
{
  "success": true,
  "data": {
    "conflicts": [
      {
        "conflict_id": "conflict-ulid",
        "local_id": "op-ulid",
        "entity_type": "work_order",
        "entity_id": "wo-uuid",
        "conflict_type": "VERSION_MISMATCH",
        "local_operation": { ... },
        "server_state": { "status": "COMPLETED", "_version": 7 },
        "server_version_vector": { "work_orders": { "wo-uuid": 7 } },
        "suggested_resolution": "SERVER_WINS",
        "resolution_options": [
          { "strategy": "SERVER_WINS", "description": "使用服务端状态（工单已完成）", "requires_confirmation": false, "risk_level": "LOW" },
          { "strategy": "CLIENT_WINS", "description": "强制覆盖为进行中", "requires_confirmation": true, "risk_level": "HIGH", "preview_result": { "status": "IN_PROGRESS" } }
        ],
        "created_at": "2025-07-11T10:30:00.000Z"
      }
    ],
    "total": 1,
    "has_more": false
  },
  "meta": { ... }
}
```

---

## 5. 解决冲突 - POST /sync/conflicts/{conflict_id}/resolve

### 5.1 请求

```http
POST /api/v1/device/sync/conflicts/conflict-ulid/resolve HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
Content-Type: application/json

{
  "strategy": "CLIENT_WINS",
  "resolved_by": "user-uuid",
  "note": "确认拣选数量正确，服务端状态滞后",
  "force": false              // true=跳过二次确认（仅 CLIENT_WINS/MANUAL 高风险策略需 false）
}
```

### 5.2 响应

```json
{
  "success": true,
  "data": {
    "conflict_id": "conflict-ulid",
    "resolution": "CLIENT_WINS",
    "merged_operation": {
      "local_id": "op-ulid",
      "server_version": 8
    },
    "retry_sync": true,
    "retry_after_sec": 0
  },
  "meta": { ... }
}
```

**策略枚举**：`SERVER_WINS`, `CLIENT_WINS`, `MERGE`, `MANUAL`, `TRANSFORM`, `CRDT_MERGE`

---

## 6. 游标管理

### 6.1 获取游标 - GET /sync/cursors

```http
GET /api/v1/device/sync/cursors?tables=inventory,work_orders,products HTTP/1.1
```

**响应**：
```json
{
  "success": true,
  "data": {
    "cursors": {
      "inventory": { "updated_at": "2025-07-11T10:25:00.000Z", "pk": "inv-last-pk", "version": 15 },
      "work_orders": { "updated_at": "2025-07-11T10:28:00.000Z", "pk": "wo-last-pk" },
      "products": { "updated_at": "2025-07-11T08:00:00.000Z", "pk": "prod-last-pk" }
    }
  },
  "meta": { ... }
}
```

### 6.2 重置游标 - POST /sync/cursors/reset

```http
POST /api/v1/device/sync/cursors/reset HTTP/1.1
Content-Type: application/json

{
  "tables": ["inventory", "work_orders"],  // 不传 = 全部表
  "confirm": true                          // 必须显式确认
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "reset_tables": ["inventory", "work_orders", "products", "locations", "containers"],
    "message": "游标已重置，下次同步将触发全量拉取"
  },
  "meta": { ... }
}
```

---

## 7. 版本控制与兼容性

### 7.1 版本协商

```http
# 请求头
X-Client-Version: 2.1.0
X-Sync-Protocol-Version: 1              # 同步协议主版本

# 响应头
X-Server-Version: 2.1.3
X-Sync-Protocol-Version: 1
X-Sync-Protocol-Min-Version: 1          # 最低兼容版本
```

### 7.2 兼容性矩阵

| 协议版本 | 发布日期 | 状态 | 兼容客户端版本 | 关键变更 |
|----------|----------|------|----------------|----------|
| 1 | 2025-07-11 | Current | ≥ 2.1.0 | 初版：双向同步、分片、冲突解决、游标 |

### 7.3 废弃策略

- **主版本不兼容**：发布 v2 时，v1 维护 6 个月，响应头增加 `Sunset: Sat, 01 Jan 2026 00:00:00 GMT`
- **次版本兼容**：仅新增字段/可选参数，不破坏现有客户端

---

## 8. 限流与配额

### 8.1 限流规则

| 维度 | 限制 | 超限响应 |
|------|------|----------|
| 设备级同步频率 | 10 次/分钟 | `429 SYNC_RATE_LIMITED` |
| 设备级 API 总频率 | 200 次/分钟 | `429 RATE_LIMITED` |
| 租户级同步并发 | 50 设备并发 | 队列等待，最长 30s |
| 单次同步载荷 | 2 MB (压缩前) | `413 PAYLOAD_TOO_LARGE` |
| 单次同步操作数 | 200 条 | 自动分片 |
| 单次拉取记录数 | 500 条/表 | 服务端截断并返回 `has_more=true` |

### 8.2 响应头

```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 8
X-RateLimit-Reset: 1720695600
Retry-After: 30          # 仅 429 时返回
```

---

## 9. 安全规范

### 9.1 请求签名（可选增强）

```
# 客户端计算签名
signature = HMAC-SHA256(
  key=device_api_key,
  message=METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + SHA256(body)
)

# 请求头
X-Timestamp: 1720695000
X-Signature: <base64_signature>
```

服务端验证：
- Timestamp 与服务端时间差 ≤ 300 秒
- Signature 验签通过
- 防重放：Timestamp + DeviceId 组合在 Redis 存储 5 分钟

### 9.2 数据加密

| 层面 | 方案 |
|------|------|
| 传输层 | TLS 1.3 强制，证书锁定 |
| 应用层 | 敏感字段（如批次号、序列号）可选字段级加密 |
| 存储层 | 服务端 PostgreSQL TDE，PDA 端 SQLCipher |

### 9.3 审计日志

同步接口必须记录：
- `device_id`, `tenant_id`, `session_id`
- `push_count`, `pull_count`, `conflict_count`
- `duration_ms`, `network_type`
- 冲突解决详情：`conflict_id`, `strategy`, `resolved_by`

---

## 10. 客户端实现指南

### 10.1 同步状态机

```typescript
enum SyncState {
  IDLE = 'IDLE',
  PREPARING = 'PREPARING',      // 收集操作、计算版本向量
  PUSHING = 'PUSHING',          // 发送操作
  PULLING = 'PULLING',          // 接收拉取数据
  RESOLVING_CONFLICTS = 'RESOLVING_CONFLICTS', // 处理冲突
  APPLYING = 'APPLYING',        // 本地合并拉取数据
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

class SyncEngine {
  private state = SyncState.IDLE;
  private sessionId: string;
  private chunkQueue: LocalOperation[][] = [];
  
  async sync(): Promise<SyncResult> {
    if (this.state !== SyncState.IDLE) throw new Error('Sync in progress');
    
    this.state = SyncState.PREPARING;
    const operations = await this.collectPendingOperations();
    
    // 分片
    this.chunkQueue = this.chunkOperations(operations, 200);
    this.sessionId = ulid();
    
    for (let i = 0; i < this.chunkQueue.length; i++) {
      this.state = SyncState.PUSHING;
      const response = await this.pushChunk(this.chunkQueue[i], i);
      
      if (response.conflicts.length > 0) {
        this.state = SyncState.RESOLVING_CONFLICTS;
        await this.resolveConflicts(response.conflicts);
        // 冲突解决后重试同一分片
        i--;
        continue;
      }
      
      if (i === this.chunkQueue.length - 1) {
        this.state = SyncState.PULLING;
        await this.applyPullData(response.pull_data);
      }
    }
    
    this.state = SyncState.COMPLETED;
    await this.cleanupCompletedOperations();
    return { success: true };
  }
}
```

### 10.2 退避重试策略

```typescript
const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000]; // 最大 60s
const MAX_RETRIES = 5;

async function withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === MAX_RETRIES) throw e;
      if (e.code === 'SYNC_RATE_LIMITED' || e.code === 'SERVICE_UNAVAILABLE') {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        await sleep(delay);
        continue;
      }
      throw e; // 非重试错误直接抛出
    }
  }
}
```

### 10.3 网络感知同步调度

```typescript
interface SyncSchedulerConfig {
  wifi: { interval_sec: 30, batch_size: 200 };
  '4g': { interval_sec: 120, batch_size: 50 };
  '5g': { interval_sec: 60, batch_size: 100 };
  offline: { interval_sec: 0, batch_size: 0 }; // 不主动同步
  low_battery: { threshold: 20, multiplier: 3 }; // 电量<20% 时间隔×3
}

function getNextSyncDelay(config: SyncSchedulerConfig): number {
  const net = getNetworkType();
  const battery = getBatteryLevel();
  let delay = config[net]?.interval_sec || 60;
  
  if (battery < config.low_battery.threshold) {
    delay *= config.low_battery.multiplier;
  }
  
  // 抖动 ±10% 避免惊群
  return delay * (0.9 + Math.random() * 0.2);
}
```

---

## 11. 测试契约

### 11.1 契约测试用例

| 用例 ID | 场景 | 预期结果 |
|---------|------|----------|
| SYNC-001 | 首次全量同步（空本地） | 拉取所有高频表，游标建立，`push_results=[]` |
| SYNC-002 | 增量同步（本地 5 条 UPDATE） | 推送成功，返回 `server_version`，本地版本向量更新 |
| SYNC-003 | 版本冲突（库存并发扣减） | 返回 `409 CONFLICT`，`conflicts[0].suggested_resolution=TRANSFORM` |
| SYNC-004 | 幂等重试（网络超时重发） | 服务端识别 `local_id` 已处理，返回原结果 |
| SYNC-005 | 分片同步（300 条操作） | 2 个分片，最后分片返回完整 `pull_data` |
| SYNC-006 | 冲突解决后重试 | `POST /resolve` 后再次 `/sync` 成功 |
| SYNC-007 | 游标重置触发全量 | `POST /cursors/reset` 后下次同步 `pull_cursors` 为空 |
| SYNC-008 | 限流触发退避 | 连续 11 次同步触发 `429`，客户端指数退避 |
| SYNC-009 | Token 过期自动刷新 | `401` → 刷新 Token → 重试同步成功 |
| SYNC-010 | 离线 7 天后上线 | 全量同步（游标过期），数据完整无丢失 |

### 11.2 性能基线

| 指标 | 目标 | 测试条件 |
|------|------|----------|
| 单次同步延迟 (P99) | < 3000ms | 200 推送 + 500 拉取，WiFi |
| 增量同步延迟 (P99) | < 500ms | 10 推送 + 50 拉取，WiFi |
| 冲突解决端到端 | < 5000ms | 包括用户交互 3 秒 |
| 同步成功率 | > 99.9% | 日均 1000 设备 |
| 离线数据零丢失 | 100% | 杀进程/断电/卸载重装测试 |

---

## 12. 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2025-07-11 | 初版：完整契约、分片、冲突、游标、限流、安全、客户端指南、测试用例 | 架构组 |

---

*本文档为同步接口契约单一事实来源。任何接口变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（第 4 节流程）、`DEVICE_PROTOCOL_SPEC.md`（2.3 节）、`SQLITE_LOCAL_SCHEMA.md`（sync_queue 字段）、`CONFLICT_RESOLUTION_STRATEGY.md`（冲突响应结构）。*