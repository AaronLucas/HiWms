# 设备端 API 协议详细规范

> **版本**: v2.0.0
> **状态**: 草案待评审
> **基础路径**: `/api/v1/device`
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`, `SYNC_API_CONTRACT.md`, `API_SPEC.md` (第 4 节), `SQLITE_LOCAL_SCHEMA.md`, `CONFLICT_RESOLUTION_STRATEGY.md`

---

## 1. 协议概览

### 1.1 通信模式
| 模式 | 用途 | 协议 | 认证 |
|------|------|------|------|
| **REST** | 同步、任务拉取、操作上报、查询 | HTTPS/JSON | Device JWT + API Key |
| **WebSocket** | 实时任务下发、进度推送、指令下达 | WSS/JSON | Device JWT (握手时) + 心跳 |

### 1.2 基础约定
```typescript
// 所有请求头
headers: {
  'Authorization': 'Bearer <device_jwt>',
  'X-API-Key': 'wms7_dk_<deviceId>_<random>',
  'X-Device-Id': '<device_id>',
  'X-Client-Version': '2.1.0',
  'X-Request-Id': '<ulid>',           // 幂等键，客户端生成
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Accept-Language': 'zh-CN',
}

// 统一响应格式
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta: ResponseMeta;
}

interface ApiError {
  code: string;              // 错误码（见第 12 节）
  message: string;           // 人类可读
  details?: Record<string, unknown>;
  request_id: string;
}

interface ResponseMeta {
  request_id: string;
  timestamp: string;         // ISO8601 UTC
  server_version: string;
  rate_limit?: RateLimitInfo;
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset_at: string;
}
```

### 1.3 设备认证流程
```
1. PDA 启动 → 读取本地存储的 device_id + api_key
2. POST /auth/login { device_id, api_key, fcm_token? }
   → 返回 { access_token, refresh_token, expires_in, server_time }
3. 后续请求携带 Authorization: Bearer <access_token>
4. Token 过期前调用 POST /auth/refresh { refresh_token }
5. 设备解绑/注销 → POST /auth/logout → 清理本地 Token
```

### 1.4 任务执行三大关键机制（v2.0.0 起）
本规范中所有任务/作业类接口都受以下三个跨切面机制约束，详见第 3 节：

1. **任务领用（Claim）**：多设备可能争抢同一任务时，通过 `fn_claim_task` 领用，不再依赖笼统的"服务端分布式锁"描述。
2. **离线策略查询（Sync Policy）**：任务是否允许离线、允许多久，由 `fn_get_sync_policy(tenant_id, task_type, zone_type)` 显式返回，设备不得凭任务类型名称自行假设。
3. **统一异常上报**：所有作业接口遇到无法自行解决的业务问题，一律通过统一异常机制（`fn_raise_exception`）登记，不再各自发明 `exception_code`/`difference_reason` 等专属字段。

---

## 2. 认证与同步接口

### 2.1 设备登录
```http
POST /api/v1/device/auth/login
Content-Type: application/json

{
  "device_id": "pda-wh-001",
  "api_key": "wms7_dk_pda-wh-001_abc123...",
  "fcm_token": "firebase_push_token",  // 可选，用于推送通知
  "app_version": "2.1.0",
  "os_version": "Android 13",
  "device_model": "Zebra TC58"
}
```

**响应 (200)**:
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 900,                    // 15 分钟
    "refresh_expires_in": 604800,         // 7 天
    "token_type": "Bearer",
    "server_time": "2025-07-11T10:30:00.000Z",
    "tenant_id": "tenant-uuid",
    "device_config": {
      "sync_interval_sec": 30,
      "auto_sync_on_wifi": true,
      "max_offline_days": 7,
      "features": ["picking", "packing", "receiving", "inventory", "shipping"]
    },
    "permissions": ["inventory:read", "work_order:execute", "task:complete"]
  },
  "meta": { "request_id": "req-ulid", "timestamp": "2025-07-11T10:30:00.000Z" }
}
```

**错误**:
- `401 DEVICE_INVALID_CREDENTIALS` - 设备 ID/Key 不匹配
- `403 DEVICE_NOT_PROVISIONED` - 设备未在后台注册
- `403 DEVICE_SUSPENDED` - 设备被禁用
- `403 TENANT_MISMATCH` - 设备绑定租户与请求不符

### 2.2 刷新 Token
```http
POST /api/v1/device/auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**响应**: 同登录响应，不返回 `device_config`

### 2.3 离线数据同步（核心接口）
```http
POST /api/v1/device/sync
Content-Type: application/json

{
  "session_id": "sync-ulid-001",
  "client_time": "2025-07-11T10:30:00.123Z",
  "last_synced_server_time": "2025-07-11T10:25:00.000Z",
  "operations": [
    {
      "local_id": "op-ulid-001",
      "entity_type": "work_order",
      "operation": "UPDATE",
      "entity_id": "wo-uuid-001",
      "payload": {
        "status": "IN_PROGRESS",
        "started_at": "2025-07-11T10:28:00.000Z",
        "assignee_id": "user-uuid"
      },
      "version_vector": {
        "work_orders": { "wo-uuid-001": 5 }
      },
      "occurred_at": "2025-07-11T10:28:00.123Z",
      "business_context": {
        "work_order_id": "wo-uuid-001",
        "operator_id": "user-uuid",
        "location": { "lat": 31.2304, "lng": 121.4737 }
      },
      "sync_meta": {
        "retry_count": 0,
        "max_retries": 3,
        "priority": 1,
        "chunk_id": "sync-ulid-001",
        "chunk_index": 0,
        "total_chunks": 1
      }
    }
  ],
  "pull_tables": ["products", "locations", "work_orders", "tasks"],
  "pull_cursors": {
    "products": { "updated_at": "2025-07-11T08:00:00.000Z", "id": "prod-last-pk" },
    "locations": { "updated_at": "2025-07-11T08:00:00.000Z", "id": "loc-last-pk" }
  },
  "pull_limit": 200
}
```

**响应 (200)**:
```json
{
  "success": true,
  "data": {
    "session_id": "sync-ulid-001",
    "server_time": "2025-07-11T10:30:00.456Z",
    "push_results": [
      {
        "local_id": "op-ulid-001",
        "status": "SUCCESS",
        "server_entity_id": "wo-uuid-001",
        "server_version": 6
      }
    ],
    "conflicts": [],
    "pull_data": {
      "products": {
        "records": [
          { "id": "prod-new", "sku": "NEW-SKU", "name": "新商品", "updated_at": "2025-07-11T09:00:00.000Z", "version": 1 }
        ],
        "cursor": { "updated_at": "2025-07-11T09:00:00.000Z", "id": "prod-new" },
        "has_more": false
      },
      "work_orders": {
        "records": [],
        "cursor": { "updated_at": "2025-07-11T10:30:00.000Z", "id": "wo-last" },
        "has_more": false
      }
    },
    "stats": {
      "pushed": 1,
      "succeeded": 1,
      "conflicts": 0,
      "errors": 0,
      "pulled_records": 1,
      "duration_ms": 234
    },
    "next_sync_interval_sec": 30
  },
  "meta": { "request_id": "req-ulid", "timestamp": "2025-07-11T10:30:00.456Z" }
}
```

**错误**:
- `409 SYNC_CONFLICT` - 存在冲突，`data.conflicts` 非空，需按 `CONFLICT_RESOLUTION_STRATEGY.md` 处理
- `413 PAYLOAD_TOO_LARGE` - 单次同步 > 2MB，需分片
- `429 SYNC_RATE_LIMITED` - 同步过于频繁，`meta.rate_limit.reset_at` 指示重试时间

> 同步接口完整字段定义、Outbox 队列语义、分片规则见 `SYNC_API_CONTRACT.md`。

### 2.4 同步状态查询
```http
GET /api/v1/device/sync/status?session_id=sync-ulid-001
```

**响应**:
```json
{
  "success": true,
  "data": {
    "session_id": "sync-ulid-001",
    "status": "COMPLETED",  // PENDING, SYNCING, COMPLETED, FAILED
    "started_at": "2025-07-11T10:30:00.123Z",
    "completed_at": "2025-07-11T10:30:00.357Z",
    "stats": { "pushed": 10, "succeeded": 9, "conflicts": 1, "errors": 0 }
  },
  "meta": { ... }
}
```

### 2.5 获取冲突列表
```http
GET /api/v1/device/sync/conflicts?status=UNRESOLVED&limit=50
```

**响应**:
```json
{
  "success": true,
  "data": {
    "conflicts": [
      {
        "conflict_id": "conflict-ulid",
        "local_operation": { ... },
        "server_state": { "status": "COMPLETED", "version": 7 },
        "server_version_vector": { "work_orders": { "wo-uuid": 7 } },
        "conflict_type": "VERSION_MISMATCH",
        "suggested_resolution": "SERVER_WINS",
        "resolution_options": [
          { "strategy": "SERVER_WINS", "description": "使用服务端状态", "requires_confirmation": false },
          { "strategy": "CLIENT_WINS", "description": "强制覆盖", "requires_confirmation": true, "preview_result": { "status": "IN_PROGRESS" } }
        ],
        "created_at": "2025-07-11T10:30:00.000Z"
      }
    ],
    "total": 1
  },
  "meta": { ... }
}
```

### 2.6 解决冲突
```http
POST /api/v1/device/sync/conflicts/conflict-ulid/resolve
Content-Type: application/json

{
  "strategy": "CLIENT_WINS",
  "resolved_by": "user-uuid",
  "note": "确认拣选数量正确，服务端状态滞后"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "conflict_id": "conflict-ulid",
    "resolution": "CLIENT_WINS",
    "merged_operation": { "local_id": "op-ulid", "server_version": 8 },
    "retry_sync": true  // 建议立即重试同步
  },
  "meta": { ... }
}
```

---

## 3. 任务执行接口

本节接口围绕三个跨切面机制展开：**离线策略查询**（本节 3.1）→ **任务领用**（本节 3.2-3.3，仅 `ONLINE_ONLY` 任务需要）→ 正常的任务拉取/执行流程（3.4-3.8）→ **统一异常上报**（3.9-3.10）。设备必须先查策略、再按策略决定是否领用，而不是根据任务类型名称自行猜测。

### 3.1 查询任务的离线同步策略
在开始任意任务前，PDA 应先查询该任务的同步策略，而不是假设"这个类型的任务一定能离线做"。
```http
GET /api/v1/device/sync/policy?task_type=PICKING&zone_type=COLD_STORAGE
```

**响应**:
```json
{
  "success": true,
  "data": {
    "policy": "LIMITED",           // ALLOW | LIMITED | ONLINE_ONLY
    "max_offline_duration_seconds": 1800,  // 仅 LIMITED 返回；超过需强制联网同步
    "requires_claim": false        // ONLINE_ONLY 时恒为 true
  },
  "meta": { ... }
}
```

策略含义：

| policy | 行为 | 是否需要领用（3.2） |
|---|---|---|
| `ALLOW` | 可自由离线执行，操作写入本地 Outbox 队列，无需领用 | 否 —— 该任务对应的库存已在派工时通过 `inventory_reservations.work_order_id` 预占，天然无争抢对象 |
| `LIMITED` | 可离线执行，但 PDA 必须自行计时该任务的离线时长，超过 `max_offline_duration_seconds` 前必须强制联网同步 | 否 |
| `ONLINE_ONLY` | 必须先成功调用 3.2 领用接口才能开始；领用未成功前，本地不得为该任务排队任何离线操作 | 是 |

> 具体哪些 `task_type`/`zone_type` 组合默认为 `ONLINE_ONLY`（例如冷链、危化品相关合规敏感场景）由租户合规配置决定，本规范不做硬编码；设备侧永远以此接口的实时返回值为准。完整策略字段与决策表见 `SYNC_API_CONTRACT.md`。

### 3.2 领用任务（Claim）
当 3.1 返回 `policy=ONLINE_ONLY`，或任务本身可能被多台设备同时争抢时，设备必须先领用任务。底层调用 `fn_claim_task(work_order_id, user_id, device_id, lease_seconds=300)`。
```http
POST /api/v1/device/tasks/task-uuid/claim
Content-Type: application/json

{
  "work_order_id": "wo-uuid",
  "lease_seconds": 300,           // 可选，默认 300
  "device_info": { "gps": {...}, "network": "wifi", "battery": 85 }
}
```

**响应 (200，领用成功)**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "claim_id": "claim-uuid",
    "message": "领用成功",
    "expires_at": "2025-07-11T10:35:00.000Z"
  },
  "meta": { ... }
}
```

**响应 (200，领用失败——非 HTTP 错误状态)**:
```json
{
  "success": true,
  "data": {
    "success": false,
    "claim_id": null,
    "message": "该任务已被其他设备领用，请稍后重试或联系主管"
  },
  "meta": { ... }
}
```
领用失败是**正常的 HTTP 200 业务响应**，不是错误状态码——同一 `work_order_id` 上是否已存在 ACTIVE 状态的领用记录，由数据库唯一索引强制保证，不依赖应用层判断，因此不存在竞态窗口。设备侧只需读取 `data.success` 决定是否可以继续。

### 3.3 释放任务领用
任务正常完成（3.7）后，设备应主动释放领用，底层调用 `fn_release_task_claim`。
```http
POST /api/v1/device/tasks/task-uuid/release-claim
Content-Type: application/json

{ "claim_id": "claim-uuid" }
```

**响应**:
```json
{ "success": true, "data": { "released": true }, "meta": { ... } }
```

> 若设备在持有领用期间离线/崩溃且未释放，租约会在 `lease_seconds` 后由服务端 `fn_expire_task_claims`（周期性任务）自动过期；若此时工单仍未完成，工单会被自动标记为 `EXCEPTION` 并登记一条 `TASK_CLAIM_EXPIRED` 异常（见 3.9 异常目录）。这是系统自动行为，设备无需专门处理——下次同步时会发现任务已不可领用，或已被重新分配/标记异常。

### 3.4 获取待执行任务列表
```http
GET /api/v1/device/tasks?status=PENDING,ASSIGNED&type=PICKING,PACKING&limit=20&offset=0
```

**响应**:
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "task-uuid",
        "type": "PICKING",
        "status": "ASSIGNED",
        "priority": 1,
        "wave_id": "wave-uuid",
        "work_order_id": "wo-uuid",
        "assignee_id": "user-uuid",
        "sync_policy": "ALLOW",          // ALLOW | LIMITED | ONLINE_ONLY，见 3.1
        "claim_status": null,             // null | ACTIVE | EXPIRED，仅 ONLINE_ONLY 任务有意义
        "summary": {
          "total_lines": 5,
          "completed_lines": 0,
          "total_qty": 50,
          "picked_qty": 0
        },
        "location_hint": "A区-01-02货位",
        "created_at": "2025-07-11T08:00:00.000Z",
        "due_at": "2025-07-11T12:00:00.000Z"
      }
    ],
    "total": 1,
    "has_more": false
  },
  "meta": { ... }
}
```

### 3.5 获取任务详情
```http
GET /api/v1/device/tasks/task-uuid
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "task-uuid",
    "type": "PICKING",
    "status": "ASSIGNED",
    "work_order_id": "wo-uuid",
    "wave_id": "wave-uuid",
    "sync_policy": "ALLOW",
    "claim_status": null,
    "steps": [
      {
        "id": "step-1",
        "type": "SCAN_LOCATION",
        "instruction": "扫描货位 A-01-02-03",
        "sequence": 1,
        "required": true,
        "validation": { "type": "location_code", "expected_zone": "PICK" }
      },
      {
        "id": "step-2",
        "type": "SCAN_PRODUCT",
        "instruction": "扫描商品 SKU-001",
        "sequence": 2,
        "required": true,
        "validation": { "type": "product_sku", "expected_sku": "SKU-001" }
      },
      {
        "id": "step-3",
        "type": "CONFIRM_QTY",
        "instruction": "确认拣选数量 10",
        "sequence": 3,
        "required": true,
        "validation": { "type": "quantity", "min": 1, "max": 100 }
      }
    ],
    "lines": [
      {
        "line_id": "line-uuid",
        "product_id": "prod-uuid",
        "sku": "SKU-001",
        "name": "商品名称",
        "required_qty": 10,
        "picked_qty": 0,
        "uom": "PCS",
        "location_code": "A-01-02-03",
        "batch_no": "BATCH-001",
        "exp_date": "2026-01-01"
      }
    ]
  },
  "meta": { ... }
}
```

### 3.6 开始任务
```http
POST /api/v1/device/tasks/task-uuid/start
Content-Type: application/json

{
  "claim_id": "claim-uuid",   // policy=ONLINE_ONLY 时必填，且必须是 3.2 返回的有效领用；ALLOW/LIMITED 任务留空
  "device_info": {
    "gps": { "lat": 31.2304, "lng": 121.4737, "accuracy": 10 },
    "network": "wifi",
    "battery": 85
  }
}
```
若任务的 `sync_policy=ONLINE_ONLY` 且请求未携带有效 `claim_id`，服务端拒绝开始任务（`403 CLAIM_REQUIRED`，见第 12 节）。

**响应**:
```json
{
  "success": true,
  "data": {
    "task_id": "task-uuid",
    "status": "IN_PROGRESS",
    "started_at": "2025-07-11T10:30:00.000Z",
    "current_step": { "id": "step-1", "type": "SCAN_LOCATION", "instruction": "扫描货位 A-01-02-03" }
  },
  "meta": { ... }
}
```

### 3.7 完成任务步骤
```http
POST /api/v1/device/tasks/task-uuid/steps/step-1/complete
Content-Type: application/json

{
  "scanned_data": {
    "location_code": "A-01-02-03",
    "product_sku": "SKU-001",
    "quantity": 10,
    "batch_no": "BATCH-001",
    "container_lpn": "LPN-001",
    "serial_numbers": ["SN001", "SN002"]  // 序列号强扫商品
  },
  "device_info": {
    "gps": { "lat": 31.2304, "lng": 121.4737 },
    "network": "wifi",
    "battery": 84
  },
  "duration_ms": 15000  // 步骤耗时
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "step_completed": true,
    "next_step": {
      "id": "step-2",
      "type": "SCAN_PRODUCT",
      "instruction": "扫描商品 SKU-001"
    },
    "task_progress": { "completed": 1, "total": 3 },
    "line_progress": { "line-uuid": { "picked_qty": 10, "required_qty": 10 } }
  },
  "meta": { ... }
}
```

若某一步骤扫描/校验过程中触发了业务级问题（例如目标库位不合规），本接口不再使用专属字段描述问题，而是走 3.9 统一异常上报后，在响应中附带 `exception` 摘要（见 3.9）。

### 3.8 完成任务
```http
POST /api/v1/device/tasks/task-uuid/complete
Content-Type: application/json

{
  "claim_id": "claim-uuid",   // 若任务是通过 3.2 领用开始的，需带上以便服务端联动释放；ALLOW/LIMITED 任务留空
  "device_info": { "gps": {...}, "network": "wifi", "battery": 80 }
}
```
任务正常完成不再有内联的 `exception` 字段——如果任务执行中出现了需要登记的问题，应在发生时立即调用 3.9 的统一异常接口，而不是在完成时才附带描述。任务完成后，若持有领用，服务端会自动释放（也可显式调用 3.3）。

**响应**:
```json
{
  "success": true,
  "data": {
    "task_id": "task-uuid",
    "status": "COMPLETED",
    "completed_at": "2025-07-11T10:40:00.000Z",
    "claim_released": true
  },
  "meta": { ... }
}
```

### 3.9 统一异常上报
> **替代旧版**：本接口取代了旧版 `POST /tasks/{id}/exception` 的专属异常形状，以及旧版 `.../complete` 内联 `exception:{code,description,photos}` 对象、盘点接口的 `difference_reason` 自由文本字段。所有设备侧"遇到无法自行解决的业务问题"场景，统一走这一个接口，底层调用 `fn_raise_exception(tenant_id, exception_type, source_table, source_id, title, details, raised_by)`。

```http
POST /api/v1/device/exceptions
Content-Type: application/json

{
  "exception_type": "INVENTORY_SHORTAGE",
  "source_table": "work_orders",
  "source_id": "wo-uuid",
  "title": "货位 A-01-02-03 库存不足，无法完成拣选",
  "details": {
    "task_id": "task-uuid",
    "product_sku": "SKU-001",
    "location_code": "A-01-02-03",
    "expected_qty": 10,
    "available_qty": 3,
    "photos": ["r2://exception/photo1.jpg"]
  },
  "device_info": { "gps": {...}, "network": "wifi", "battery": 82 }
}
```

**异常类型目录**（`exception_type` 取值必须来自此表，不得自造新码）：

| exception_type | 所属域 | 默认严重程度 | 设备侧触发场景 |
|---|---|---|---|
| `INVENTORY_SHORTAGE` | INVENTORY | HIGH | 拣选时发现可用库存不足——设备永远不会写入负库存，拣选会被明确拒绝，同时登记异常并自动生成后续 COUNT 盘点工单 |
| `COLD_CHAIN_VIOLATION` / `HAZMAT_CONFLICT` | COMPLIANCE | CRITICAL | 上架/分配库位等操作命中非合规库位——**实时硬阻断**（设备收到明确拒绝，而非软警告），无论在线实时写入还是离线队列回放触发，规则一致（见第 4 节合规执行说明） |
| `TASK_CLAIM_EXPIRED` | TASK | MEDIUM | 系统自动触发（领用租约过期且工单未完成），设备不会主动上报此类型 |
| `COUNT_DISCREPANCY` | INVENTORY | MEDIUM | 盘点/库存核查时操作员手工上报差异——替代旧版 `difference_reason` 自由文本字段；容差来自 `fn_get_count_tolerance` 可配置值，不再硬编码 |
| `REFERENCE_NOT_FOUND` | SYNC | MEDIUM | PUTAWAY/COUNT/PACK 引用了不存在的 SKU/库位/订单行（Layer 3 新增，见 `SYNC_ACTIONS_EXTENSION.md`）——**不与** `INVENTORY_SHORTAGE`/`COLD_CHAIN_VIOLATION` 混用 |
| `MISSING_LABEL` | INVENTORY | MEDIUM | 上架时策略要求唯一追踪但现场无箱码（Layer 4 新增，见 `TRACKING_POLICY_MISSING_LABEL.md`）——商品身份明确，先按数量记账，等待补码闭环 |
| `UNIDENTIFIED_GOODS` | INVENTORY | HIGH | 操作员明确标记无法识别商品身份（Layer 4 新增）——`product_id=NULL` 暂存，严重度高于 MISSING_LABEL |
| `MANUAL_REVIEW` | OTHER | LOW | 其他未归入以上类型的操作员标记问题，通用兜底 |

> **Layer 3/4 现状提示**：`REFERENCE_NOT_FOUND`/`MISSING_LABEL`/`UNIDENTIFIED_GOODS` 三个类型与 PUTAWAY/COUNT/PACK 的修正细节均**仅为设计文档**，本地迁移脚本未修正/未创建，需先与 DBA 团队协调确认，详见 `docs/00-project/ROADMAP.md` Phase 1.4.1/1.4.2。

**响应 (200)**:
```json
{
  "success": true,
  "data": {
    "exception_id": "exc-uuid",
    "exception_type": "INVENTORY_SHORTAGE",
    "severity": "HIGH",
    "status": "OPEN"
  },
  "meta": { ... }
}
```
所有会遇到业务异常的设备侧接口（拣选、上架、盘点等），在触发异常的那次调用的响应中都会附带同样形状的 `exception: { exception_id, exception_type, severity }` 摘要字段，PDA 统一展示为"已登记异常 #{exception_id}（{severity}）"，不再需要为每个业务接口单独适配错误展示逻辑。

设备侧**不负责解决异常**——没有面向设备的 `fn_resolve_exception` 调用，异常处理是主管/后台管理端的职责，超出本规范范围。

### 3.10 查询异常状态（只读）
设备只能查看与自己相关任务的异常状态，不能修改。
```http
GET /api/v1/device/exceptions?task_id=task-uuid&status=OPEN
```

**响应**:
```json
{
  "success": true,
  "data": {
    "exceptions": [
      {
        "exception_id": "exc-uuid",
        "exception_type": "INVENTORY_SHORTAGE",
        "severity": "HIGH",
        "status": "OPEN",
        "title": "货位 A-01-02-03 库存不足，无法完成拣选",
        "created_at": "2025-07-11T10:32:00.000Z"
      }
    ],
    "total": 1
  },
  "meta": { ... }
}
```
完整的异常生命周期状态机、后台解决流程详见 `SYNC_API_CONTRACT.md`。

---

## 4. 核心作业操作接口

> 合规执行说明：以下涉及库位分配（收货、上架、拣选）的接口，其冷链/危化品/库位类型不兼容性校验触发器，无论是实时在线写入触发，还是从离线队列回放触发，规则完全一致——**永远不会因为走离线路径而被绕过**。区别仅在于呈现方式：实时在线写入时立即硬阻断，设备当场收到明确拒绝；离线回放时（设备当时已经离开该库位、以为操作已成功）触发器会在服务端生成 `COLD_CHAIN_VIOLATION`/`HAZMAT_CONFLICT` 异常，设备要等到下次同步才会看到，而不是被静默回滚。这一不对称性会影响 PDA 对"刚做完的离线合规敏感操作"应如何提示不确定性，界面设计需显式处理。

### 4.1 收货扫描
```http
POST /api/v1/device/inbound/receive
Content-Type: application/json

{
  "receipt_id": "receipt-uuid",
  "scans": [
    {
      "sku": "SKU-001",
      "barcode": "6901234567890",
      "quantity": 100,
      "batch_no": "BATCH-20250711",
      "mfg_date": "2025-07-01",
      "exp_date": "2026-07-01",
      "location_code": "RECV-01",
      "container_lpn": "LPN-RECV-001",
      "quality_check": { "passed": true, "notes": "外观良好" }
    }
  ],
  "device_info": { "gps": {...}, "network": "wifi", "battery": 90 }
}
```
若收货暂存位与商品的合规属性冲突（如冷链商品被扫到常温暂存区），按上文合规说明处理：在线时硬阻断，离线回放时登记 `COLD_CHAIN_VIOLATION`/`HAZMAT_CONFLICT` 异常（见 3.9）。

### 4.2 质检录入
```http
POST /api/v1/device/inbound/inspect
Content-Type: application/json

{
  "inspection_id": "insp-uuid",
  "items": [
    {
      "item_id": "item-uuid",
      "check_type": "WEIGHT",
      "expected": { "value": 1000, "unit": "g", "tolerance_pct": 2 },
      "actual": { "value": 1005, "unit": "g" },
      "result": "PASS",
      "photos": ["r2://..."]
    },
    {
      "item_id": "item-uuid-2",
      "check_type": "DIMENSION",
      "expected": { "length": 200, "width": 100, "height": 50, "unit": "mm", "tolerance_pct": 3 },
      "actual": { "length": 202, "width": 99, "height": 51, "unit": "mm" },
      "result": "PASS"
    }
  ]
}
```
质检不通过且需要人工复核时，由操作员通过 3.9 上报 `MANUAL_REVIEW` 异常，而不是在本接口内附加专属复核字段。

### 4.3 上架确认
```http
POST /api/v1/device/inbound/putaway
Content-Type: application/json

{
  "receipt_id": "receipt-uuid",
  "putaways": [
    {
      "sku": "SKU-001",
      "quantity": 50,
      "from_location": "RECV-01",
      "to_location": "A-01-02-03",
      "container_lpn": "LPN-001",
      "batch_no": "BATCH-20250711"
    }
  ]
}
```
目标库位与商品的冷链/危化品属性不兼容时**实时硬阻断**（本接口在线调用时直接拒绝并返回 `422` 级错误）；若该上架动作来自离线队列回放，则登记 `COLD_CHAIN_VIOLATION`/`HAZMAT_CONFLICT` 异常（见第 4 节顶部合规说明与 3.9）。

### 4.4 黑盒解箱
```http
POST /api/v1/device/inbound/blackbox/resolve
Content-Type: application/json

{
  "lpn_code": "LPN-BLACKBOX-001",
  "resolutions": [
    { "sku": "SKU-001", "quantity": 20, "batch_no": "BATCH-001" },
    { "sku": "SKU-002", "quantity": 30, "batch_no": "BATCH-002" }
  ],
  "device_info": { ... }
}
```
> 对应 RPC `fn_logic_resolve_blackbox_box`，生成 `picking_priority=99` 的散货库存

### 4.5 拣选扫描库位
```http
POST /api/v1/device/outbound/pick/scan-location
Content-Type: application/json

{
  "task_id": "task-uuid",
  "claim_id": "claim-uuid",   // 仅 sync_policy=ONLINE_ONLY 的任务需要
  "location_code": "A-01-02-03",
  "device_info": { ... }
}
```

### 4.6 拣选扫描商品
```http
POST /api/v1/device/outbound/pick/scan-product
Content-Type: application/json

{
  "task_id": "task-uuid",
  "step_id": "step-2",
  "sku": "SKU-001",
  "barcode": "6901234567890",
  "device_info": { ... }
}
```

### 4.7 确认拣选数量
```http
POST /api/v1/device/outbound/pick/confirm-qty
Content-Type: application/json

{
  "task_id": "task-uuid",
  "step_id": "step-3",
  "line_id": "line-uuid",
  "quantity": 10,
  "batch_no": "BATCH-001",
  "container_lpn": "LPN-PICK-001",
  "serial_numbers": ["SN001", "SN002"],
  "device_info": { ... }
}
```
若目标库位实际可用库存不足以满足 `quantity`，设备**不会**被允许写入负库存——本次拣选被拒绝（`422 UNPROCESSABLE_ENTITY`），同时服务端登记 `INVENTORY_SHORTAGE` 异常并自动生成后续 COUNT 盘点工单。响应中附带 `exception: { exception_id, exception_type: "INVENTORY_SHORTAGE", severity: "HIGH" }`。

### 4.8 打包扫描容器
```http
POST /api/v1/device/outbound/pack/scan-container
Content-Type: application/json

{
  "task_id": "task-uuid",
  "container_lpn": "LPN-PACK-001",
  "package_spec_id": "pkg-spec-uuid",
  "device_info": { ... }
}
```

### 4.9 打包添加商品
```http
POST /api/v1/device/outbound/pack/add-product
Content-Type: application/json

{
  "task_id": "task-uuid",
  "container_lpn": "LPN-PACK-001",
  "sku": "SKU-001",
  "quantity": 5,
  "batch_no": "BATCH-001",
  "serial_numbers": ["SN001"],
  "device_info": { ... }
}
```

### 4.10 打印面单
```http
POST /api/v1/device/outbound/pack/print-label
Content-Type: application/json

{
  "task_id": "task-uuid",
  "container_lpn": "LPN-PACK-001",
  "carrier": "SF",
  "label_template_id": "tpl-shipping-label",
  "copies": 2,
  "device_info": { ... }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "label_url": "https://r2.wms7.com/labels/label-uuid.zpl",
    "tracking_no": "SF1234567890",
    "format": "zpl",
    "size": "100x150mm"
  },
  "meta": { ... }
}
```

### 4.11 封箱
```http
POST /api/v1/device/outbound/pack/seal-box
Content-Type: application/json

{
  "task_id": "task-uuid",
  "container_lpn": "LPN-PACK-001",
  "seal_no": "SEAL-12345",
  "weight_kg": 2.5,
  "dimensions_cm": { "length": 30, "width": 20, "height": 15 },
  "device_info": { ... }
}
```

### 4.12 分拣扫描
```http
POST /api/v1/device/outbound/sort/scan
Content-Type: application/json

{
  "task_id": "task-uuid",
  "container_lpn": "LPN-SORT-001",
  "chute_code": "CHUTE-SF-01",
  "device_info": { ... }
}
```

### 4.13 发货扫描
```http
POST /api/v1/device/outbound/ship/scan
Content-Type: application/json

{
  "task_id": "task-uuid",
  "container_lpn": "LPN-PACK-001",
  "carrier": "SF",
  "tracking_no": "SF1234567890",
  "driver_name": "张三",
  "driver_phone": "13800138000",
  "vehicle_plate": "沪A12345",
  "device_info": { ... }
}
```

### 4.14 交接承运商
```http
POST /api/v1/device/outbound/ship/handover
Content-Type: application/json

{
  "task_id": "task-uuid",
  "shipping_document_id": "sd-uuid",
  "handover_photos": ["r2://handover/photo1.jpg"],
  "driver_signature": "data:image/png;base64,...",
  "device_info": { ... }
}
```

### 4.15 盘点扫描
```http
POST /api/v1/device/inventory/count/scan
Content-Type: application/json

{
  "count_task_id": "count-uuid",
  "scans": [
    {
      "location_code": "A-01-02-03",
      "sku": "SKU-001",
      "system_qty": 100,
      "actual_qty": 98,
      "batch_no": "BATCH-001",
      "container_lpn": "LPN-001"
    }
  ],
  "device_info": { ... }
}
```
本接口仅记录原始盘点扫描数据（系统数量 vs 实盘数量），不再包含旧版 `difference_reason` 自由文本字段——差异原因的结构化上报见 4.16。

### 4.16 提交盘点差异
```http
POST /api/v1/device/inventory/count/submit
Content-Type: application/json

{
  "count_task_id": "count-uuid",
  "adjustments": [
    {
      "product_id": "prod-uuid",
      "location_id": "loc-uuid",
      "container_id": "container-uuid",
      "expected_qty": 100,
      "actual_qty": 98,
      "difference_qty": -2,
      "reference_id": "count-uuid",
      "reference_type": "inventory_count"
    }
  ],
  "device_info": { ... }
}
```
当 `difference_qty != 0` 时，服务端会自动通过统一异常机制登记一条 `COUNT_DISCREPANCY` 异常（`source_table=inventory_counts`, `source_id=count_task_id`），取代旧版 `difference_reason` 自由文本字段；操作员如需补充说明，应在调用本接口前先调用 3.9 `POST /exceptions`（`exception_type=COUNT_DISCREPANCY`）附上结构化 `details`（差异数量、疑似原因等），本接口的响应会关联该异常。

**响应**:
```json
{
  "success": true,
  "data": {
    "submitted": true,
    "adjustments_applied": 1,
    "exceptions": [
      { "exception_id": "exc-uuid", "exception_type": "COUNT_DISCREPANCY", "severity": "MEDIUM" }
    ]
  },
  "meta": { ... }
}
```

---

## 5. 查询接口

### 5.1 商品搜索
```http
GET /api/v1/device/products/search?q=SKU-001&limit=10
```

**响应**:
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "prod-uuid",
        "sku": "SKU-001",
        "name": "商品名称",
        "barcodes": ["6901234567890"],
        "specs": { "color": "黑色", "size": "L" },
        "unit": "PCS",
        "weight_g": 200,
        "dimensions_mm": { "l": 100, "w": 50, "h": 30 },
        "is_serial_required": false,
        "abc_class": "A",
        "constraints": { "temp_range": "2-8°C", "max_stack": 5 }
      }
    ]
  },
  "meta": { ... }
}
```

### 5.2 库位搜索
```http
GET /api/v1/device/locations/search?q=A-01&zone_type=PICK&limit=20
```

### 5.3 库存查询
```http
GET /api/v1/device/inventory/lookup?sku=SKU-001&location=A-01-02-03&batch=BATCH-001
```

### 5.4 获取下一个推荐任务
```http
GET /api/v1/device/tasks/next?types=PICKING,PACKING&radius_m=50
```

---

## 6. WebSocket 实时通信

### 6.1 连接建立
```
WSS: wss://api.wms7.com/api/v1/device/ws?token=<access_token>&device_id=<device_id>
```

**握手认证**: Query 参数携带 `token` 和 `device_id`，服务端验证后建立连接

### 6.2 消息格式
```typescript
// 客户端 → 服务端
interface ClientMessage {
  type: 'PING' | 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'ACK';
  payload: any;
  msg_id: string;  // 用于确认
}

// 服务端 → 客户端
interface ServerMessage {
  type: 'PONG' | 'TASK_ASSIGNED' | 'TASK_UPDATED' | 'TASK_CANCELLED'
       | 'TASK_CLAIM_EXPIRED' | 'EXCEPTION_RAISED'
       | 'SYNC_TRIGGER' | 'NOTIFICATION' | 'COMMAND' | 'ERROR';
  payload: any;
  msg_id: string;
  timestamp: string;
}
```

### 6.3 消息类型详情

| 类型 | 方向 | 说明 | Payload 示例 |
|------|------|------|-------------|
| `PING` | C→S | 心跳（每 30 秒） | `{}` |
| `PONG` | S→C | 心跳响应 | `{ "server_time": "..." }` |
| `SUBSCRIBE` | C→S | 订阅主题 | `{ "topics": ["tasks:assigned", "sync:trigger"] }` |
| `TASK_ASSIGNED` | S→C | 新任务派发 | `{ "task_id": "...", "task": {...} }` |
| `TASK_UPDATED` | S→C | 任务状态变更 | `{ "task_id": "...", "status": "IN_PROGRESS" }` |
| `TASK_CANCELLED` | S→C | 任务取消 | `{ "task_id": "...", "reason": "ORDER_CANCELLED" }` |
| `TASK_CLAIM_EXPIRED` | S→C | 本设备持有的任务领用租约已过期 | `{ "task_id": "...", "claim_id": "...", "exception_id": "..." }` |
| `EXCEPTION_RAISED` | S→C | 与本设备相关任务上登记了新异常 | `{ "exception_id": "...", "exception_type": "INVENTORY_SHORTAGE", "severity": "HIGH" }` |
| `SYNC_TRIGGER` | S→C | 服务端触发同步 | `{ "reason": "INVENTORY_CHANGED", "tables": ["inventory"] }` |
| `NOTIFICATION` | S→C | 通知/公告 | `{ "title": "...", "body": "...", "level": "INFO" }` |
| `COMMAND` | S→C | 指令下发 | `{ "command": "REBOOT", "params": {} }` |
| `ERROR` | S→C | 连接错误 | `{ "code": "AUTH_EXPIRED", "message": "Token expired" }` |

### 6.4 重连策略
```typescript
// 客户端实现
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000]; // 指数退避，最大 60s
const MAX_RECONNECT_ATTEMPTS = Infinity;  // 永不放弃

// 断线重连时：
// 1. 重新获取 access_token（用 refresh_token）
// 2. 建立新 WebSocket 连接
// 3. 重新 SUBSCRIBE 原主题
// 4. 发送最后一条收到的 msg_id 确认（可选）
```

---

## 7. 设备注册与配置下发

### 7.1 设备注册（首次/重新绑定）
```http
POST /api/v1/device/provision
Content-Type: application/json

{
  "device_id": "pda-wh-001",
  "device_name": "仓库A-拣货PDA-01",
  "device_type": "HANDHELD",  // HANDHELD, SCALE, CONVEYOR, AGV, GATEWAY
  "model": "Zebra TC58",
  "os": "Android 13",
  "app_version": "2.1.0",
  "mac_address": "00:11:22:33:44:55",
  "serial_number": "ZTC58-2025-001",
  "tenant_id": "tenant-uuid",  // 可选，管理员预分配
  "assigned_user_id": "user-uuid"  // 可选
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "device_id": "pda-wh-001",
    "api_key": "wms7_dk_pda-wh-001_abc123def456...",
    "provisioned_at": "2025-07-11T10:30:00.000Z",
    "config": {
      "sync_interval_sec": 30,
      "auto_sync_on_wifi": true,
      "max_offline_days": 7,
      "features": ["picking", "packing", "receiving", "inventory", "shipping"],
      "label_printers": [{ "id": "printer-001", "name": "入口打印机", "type": "ZPL", "ip": "192.168.1.100" }],
      "scanners": [{ "id": "scanner-builtin", "type": "CAMERA", "config": {} }]
    }
  },
  "meta": { ... }
}
```

### 7.2 获取设备配置
```http
GET /api/v1/device/config
```

### 7.3 设备心跳/状态上报
```http
POST /api/v1/device/status
Content-Type: application/json

{
  "status": "ONLINE",  // ONLINE, OFFLINE, BUSY, ERROR
  "battery": 85,
  "storage_free_mb": 2048,
  "network": { "type": "wifi", "ssid": "WH-WIFI-A", "rssi": -45 },
  "gps": { "lat": 31.2304, "lng": 121.4737, "accuracy": 10 },
  "app_version": "2.1.0",
  "last_sync_at": "2025-07-11T10:25:00.000Z",
  "pending_sync_count": 12,
  "errors": []
}
```

---

## 8. 文件上传（R2 预签名 URL）

### 8.1 获取上传凭证
```http
POST /api/v1/device/files/upload-url
Content-Type: application/json

{
  "filename": "exception_photo.jpg",
  "content_type": "image/jpeg",
  "max_size_mb": 10,
  "category": "exception"  // exception, label, document, avatar
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "upload_url": "https://r2.wms7.com/tenant-uuid/exception/ulid.jpg?X-Amz-Signature=...",
    "file_key": "tenant-uuid/exception/ulid.jpg",
    "public_url": "https://r2.wms7.com/tenant-uuid/exception/ulid.jpg",
    "expires_at": "2025-07-11T11:30:00.000Z"
  },
  "meta": { ... }
}
```

### 8.2 直接 PUT 上传到 R2
```
PUT https://r2.wms7.com/tenant-uuid/exception/ulid.jpg?X-Amz-Signature=...
Content-Type: image/jpeg

<二进制文件内容>
```

---

## 9. 批量操作接口

### 9.1 批量任务步骤完成
```http
POST /api/v1/device/tasks/batch/steps/complete
Content-Type: application/json

{
  "operations": [
    { "task_id": "task-1", "step_id": "step-1", "scanned_data": {...}, "device_info": {...} },
    { "task_id": "task-1", "step_id": "step-2", "scanned_data": {...}, "device_info": {...} },
    { "task_id": "task-2", "step_id": "step-1", "scanned_data": {...}, "device_info": {...} }
  ]
}
```

### 9.2 批量库存调整
```http
POST /api/v1/device/inventory/batch/adjust
Content-Type: application/json

{
  "adjustments": [
    { "product_id": "prod-1", "location_id": "loc-1", "quantity": -2, "reason": "DAMAGED", "reference_id": "wo-1" },
    { "product_id": "prod-2", "location_id": "loc-2", "quantity": 5, "reason": "FOUND", "reference_id": "count-1" }
  ]
}
```

---

## 10. 分页与筛选规范

### 10.1 分页参数
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | integer | 1 | 页码（从 1 开始） |
| `page_size` | integer | 20 | 每页条数，最大 100 |
| `cursor` | string | - | 游标分页（替代 page/page_size） |

### 10.2 筛选参数
| 参数 | 示例 | 说明 |
|------|------|------|
| `filter[status]` | `filter[status]=PENDING,ASSIGNED` | 多值用逗号分隔，IN 查询 |
| `filter[created_at][gte]` | `filter[created_at][gte]=2025-07-01` | 范围筛选 |
| `search` | `search=SKU-001` | 全文搜索 |
| `sort` | `sort=-priority,created_at` | `-` 前缀降序 |

---

## 11. 限流与配额

| 维度 | 限制 | 超限响应 |
|------|------|----------|
| **设备级** | 200 req/min | `429 RATE_LIMITED` |
| **租户级** | 500 req/min | `429 RATE_LIMITED` |
| **同步接口** | 10 req/min/device | `429 SYNC_RATE_LIMITED` |
| **文件上传** | 50 MB/min/device | `413 PAYLOAD_TOO_LARGE` |
| **WebSocket** | 1 连接/设备 | 新连接踢掉旧连接 |

**响应头**:
```
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 195
X-RateLimit-Reset: 1720695600
Retry-After: 30  # 仅 429 时返回
```

---

## 12. 错误码完整表

| HTTP | 代码 | 含义 | 客户端处理建议 |
|------|------|------|----------------|
| 400 | `VALIDATION_ERROR` | 请求参数校验失败 | 显示详细错误，修正后重试 |
| 400 | `INVALID_SYNC_REQUEST` | 同步请求体格式错误 | 检查本地队列数据完整性 |
| 401 | `UNAUTHORIZED` | Token 缺失/无效 | 刷新 Token 或重新登录 |
| 401 | `TOKEN_EXPIRED` | Access Token 过期 | 用 Refresh Token 获取新 Token |
| 401 | `REFRESH_TOKEN_EXPIRED` | Refresh Token 过期 | 清理本地凭证，引导用户重新登录 |
| 403 | `FORBIDDEN` | 权限不足 | 提示无权限，联系管理员 |
| 403 | `DEVICE_NOT_PROVISIONED` | 设备未注册 | 走设备注册流程 |
| 403 | `DEVICE_SUSPENDED` | 设备被禁用 | 提示设备已禁用，联系管理员 |
| 403 | `TENANT_MISMATCH` | 租户不匹配 | 清理本地数据，重新绑定租户 |
| 403 | `CLAIM_REQUIRED` | 任务为 `ONLINE_ONLY` 但未提供有效领用 | 先调用 3.2 领用接口，成功后再重试 |
| 404 | `NOT_FOUND` | 资源不存在 | 刷新列表，可能已被删除 |
| 404 | `TASK_NOT_FOUND` | 任务不存在 | 任务可能已取消/完成，刷新任务列表 |
| 409 | `SYNC_CONFLICT` | 同步冲突 | 读取冲突列表，按策略解决 |
| 409 | `CONCURRENT_MODIFICATION` | 并发修改 | 刷新数据后重试 |
| 409 | `BUSINESS_RULE_VIOLATION` | 业务规则违反 | 显示具体错误；若已生成异常记录，展示 `exception_id`（见 3.9） |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体过大 | 分片同步，压缩图片 |
| 422 | `UNPROCESSABLE_ENTITY` | 语义错误（如扫错条码、库存不足、合规冲突） | 显示业务错误提示；若已登记异常，展示 `exception_id`（见 3.9） |
| 429 | `RATE_LIMITED` | 接口限流 | 指数退避重试，读取 `Retry-After` |
| 429 | `SYNC_RATE_LIMITED` | 同步过于频繁 | 延长同步间隔 |
| 500 | `INTERNAL_ERROR` | 服务端错误 | 上报日志，指数退避重试 |
| 503 | `SERVICE_UNAVAILABLE` | 服务暂不可用 | 延长轮询间隔，显示"服务维护中" |

> 注：任务领用失败（3.2）不是错误码——它是 `200` 响应中 `data.success=false`，详见 3.2。异常目录（`exception_type`）不是 HTTP 错误码，而是统一异常上报机制（3.9）中的业务分类，两者不要混淆。

---

## 13. 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2025-07-11 | 初版：完整 REST/WebSocket 协议、同步契约、作业操作、错误码 | 架构组 |
| 2.0.0 | 2026-07-15 | DBA 团队重新设计任务领用/离线策略/异常机制并替换旧版实现：① 任务领用改为基于数据库唯一索引的 `fn_claim_task`/`fn_release_task_claim`/`fn_expire_task_claims` 具体语义，废弃笼统的"服务端分布式锁"描述；② 新增 `GET /sync/policy` 显式查询 `ALLOW`/`LIMITED`/`ONLINE_ONLY` 离线策略，设备不再凭任务类型名称自行假设；③ 废弃旧版 `POST /tasks/{id}/exception`、`.../complete` 内联 `exception` 对象、盘点 `difference_reason` 字段，统一为 `POST /exceptions`（`fn_raise_exception` + 5 类异常目录）与只读 `GET /exceptions`；④ 明确冷链/危化品合规触发器在线硬阻断与离线回放异常登记的不对称行为 | DBA 团队 / 架构组 |
| 2.1.0 | 2026-07-16 | 异常类型目录新增 `REFERENCE_NOT_FOUND`（Layer 3）、`MISSING_LABEL`/`UNIDENTIFIED_GOODS`（Layer 4），COUNT 容差说明改为引用可配置的 `fn_get_count_tolerance`。**本次仅为文档补充，本地对应迁移脚本未修正/未创建**，需先与 DBA 团队协调确认 | DBA 团队 / 架构组 |

---

*本文档为设备端 API 协议单一事实来源。任何接口变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（同步协议与离线策略语义）、`SYNC_API_CONTRACT.md`（同步/策略/异常接口完整契约）、`SQLITE_LOCAL_SCHEMA.md`（本地表结构）、`CONFLICT_RESOLUTION_STRATEGY.md`（冲突解决）。*
