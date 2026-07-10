# 设备端 API 协议详细规范

> **版本**: v1.0.0  
> **状态**: 草案待评审  
> **基础路径**: `/api/v1/device`  
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`, `API_SPEC.md` (第 4 节), `SQLITE_LOCAL_SCHEMA.md`, `CONFLICT_RESOLUTION_STRATEGY.md`

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

### 3.1 获取待执行任务列表
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

### 3.2 获取任务详情
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

### 3.3 开始任务
```http
POST /api/v1/device/tasks/task-uuid/start
Content-Type: application/json

{
  "device_info": {
    "gps": { "lat": 31.2304, "lng": 121.4737, "accuracy": 10 },
    "network": "wifi",
    "battery": 85
  }
}
```

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

### 3.4 完成任务步骤
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

### 3.5 完成任务
```http
POST /api/v1/device/tasks/task-uuid/complete
Content-Type: application/json

{
  "device_info": { "gps": {...}, "network": "wifi", "battery": 80 },
  "exception": null  // 或 { "code": "DAMAGED", "description": "商品包装破损", "photos": ["r2://..."] }
}
```

### 3.6 上报异常
```http
POST /api/v1/device/tasks/task-uuid/exception
Content-Type: application/json

{
  "exception_code": "LOCATION_EMPTY",
  "description": "货位无货，无法拣选",
  "severity": "HIGH",  // LOW, MEDIUM, HIGH, CRITICAL
  "photos": ["r2://exception/photo1.jpg"],
  "location_code": "A-01-02-03",
  "product_sku": "SKU-001",
  "suggested_action": "REPLENISH"
}
```

---

## 4. 核心作业操作接口

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
      "container_lpn": "LPN-001",
      "difference_reason": "DAMAGED"
    }
  ],
  "device_info": { ... }
}
```

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
      "reason": "DAMAGED",
      "reference_id": "count-uuid",
      "reference_type": "inventory_count"
    }
  ],
  "device_info": { ... }
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
| 404 | `NOT_FOUND` | 资源不存在 | 刷新列表，可能已被删除 |
| 404 | `TASK_NOT_FOUND` | 任务不存在 | 任务可能已取消/完成，刷新任务列表 |
| 409 | `SYNC_CONFLICT` | 同步冲突 | 读取冲突列表，按策略解决 |
| 409 | `CONCURRENT_MODIFICATION` | 并发修改 | 刷新数据后重试 |
| 409 | `BUSINESS_RULE_VIOLATION` | 业务规则违反 | 显示具体错误（如库存不足、库位冻结） |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体过大 | 分片同步，压缩图片 |
| 422 | `UNPROCESSABLE_ENTITY` | 语义错误（如扫错条码） | 显示业务错误提示 |
| 429 | `RATE_LIMITED` | 接口限流 | 指数退避重试，读取 `Retry-After` |
| 429 | `SYNC_RATE_LIMITED` | 同步过于频繁 | 延长同步间隔 |
| 500 | `INTERNAL_ERROR` | 服务端错误 | 上报日志，指数退避重试 |
| 503 | `SERVICE_UNAVAILABLE` | 服务暂不可用 | 延长轮询间隔，显示"服务维护中" |

---

## 13. 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2025-07-11 | 初版：完整 REST/WebSocket 协议、同步契约、作业操作、错误码 | 架构组 |

---

*本文档为设备端 API 协议单一事实来源。任何接口变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（同步协议）、`SQLITE_LOCAL_SCHEMA.md`（本地表结构）、`CONFLICT_RESOLUTION_STRATEGY.md`（冲突解决）。*