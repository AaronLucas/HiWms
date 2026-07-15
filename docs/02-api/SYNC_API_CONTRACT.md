# 同步接口完整契约规范

> **版本**: v2.0.0
> **状态**: 草案待评审
> **基础路径**: `/api/v1/device`
> **协议**: HTTPS / JSON
> **认证**: Device JWT + API Key
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`, `DEVICE_PROTOCOL_SPEC.md` (2.3 节), `SQLITE_LOCAL_SCHEMA.md`, `CONFLICT_RESOLUTION_STRATEGY.md`（均按本次 DBA 新方案同步重写）

> **⚠️ 重大变更**：本版本废弃 v1.0.0 的“状态同步”模型（`LocalOperation` + `version_vector` + 服务端 `conflicts[]` + 客户端合并策略协商）。新模型为**事件同步**：PDA 只上报“发生了什么动作”，服务端以幂等收件箱（`sync_events`）落库，并通过确定性业务逻辑重放函数应用。不再存在需要客户端参与决策的“冲突”，无法干净应用的事件一律转化为统一异常域中的一条记录，交由人工在管理端处理。详见第 1 节“模型说明”。

---

## 1. 模型说明（新旧对比）

| 维度 | 旧模型（v1.0.0，已废弃） | 新模型（v2.0.0，本文档） |
|------|--------------------------|---------------------------|
| 客户端上报内容 | 拟提交的“最终状态”（完整新值或增量）+ `version_vector` | 离散的“动作事件”（发生了什么），不携带目标状态 |
| 服务端处理方式 | 比较版本向量，检测冲突 | 按 `id` 幂等落库到 `sync_events`，调用确定性重放函数应用 |
| 结果状态 | `SUCCESS` / `CONFLICT` / `ERROR`，`CONFLICT` 需客户端选择合并策略 | `APPLIED` / `EXCEPTION` / `REJECTED`，三态互斥，无需客户端决策 |
| 冲突处理 | 客户端实现 OT/CRDT/人工合并 UI，调用 `/sync/conflicts/{id}/resolve` | 服务端生成统一异常域记录，人工在管理端（Web）用 `fn_resolve_exception` 处理；PDA 仅只读展示 |
| 幂等键 | 请求级 `X-Request-Id` + 操作级 `local_id`，两套语义 | 事件的 `id`（客户端生成的 UUID/ULID）即幂等键，别无二义 |
| 拉取（只读参考数据） | `pull_data` 随 `/sync` 一并返回，游标含 `version` | 独立的 `GET /sync/pull`，游标基于各表 `updated_at`，语义单一 |
| 分片/断点续传 | `chunk_meta` / `ChunkAckResponse` 机制 | 不再需要：每个事件独立幂等，批次失败直接整批重试即可 |

---

## 2. 接口概览

| 接口 | 方法 | 路径 | 说明 | 幂等 |
|------|------|------|------|------|
| **提交动作事件** | POST | `/sync/events` | 批量提交离散动作事件到服务端收件箱 | ✅ (事件 `id`) |
| **拉取参考数据** | GET | `/sync/pull` | 增量拉取只读主数据/工单等参考数据 | ✅ |
| **查询同步策略** | GET | `/sync/policy` | 查询任务/区域的离线策略 | ✅ |
| **领用任务** | POST | `/tasks/{work_order_id}/claim` | 领用工单，建立设备-任务租约 | ⚠️ 非幂等（业务语义上每次调用都是一次领用尝试） |
| **释放任务租约** | POST | `/tasks/claims/{claim_id}/release` | 释放已领用的任务 | ✅ |
| **异常列表** | GET | `/exceptions` | 分页查询与本设备/用户相关的异常 | ✅ |
| **异常详情** | GET | `/exceptions/{id}` | 查询单条异常详情 | ✅ |
| **生成内部码** | POST | `/missing-label/generate` | 生成内部 LPN 码（`fn_generate_internal_lpn`） | ✅ |
| **确认贴码** | POST | `/missing-label/confirm` | 扫码确认内部码已贴好（`fn_confirm_label_applied`） | ✅ |
| **上报未识别货物** | POST | `/unidentified/receive` | 记录无法识别的货物（`fn_receive_unidentified_goods`） | ✅ |
| **识别未识别货物** | POST | `/unidentified/identify` | 回填未识别货物的商品身份（`fn_identify_unidentified_goods`） | ✅ |

**已移除的旧接口**（不再提供）：`GET /sync/status`、`GET /sync/conflicts`、`POST /sync/conflicts/{id}/resolve`、`GET /sync/cursors`（作为冲突/版本游标的构造）、`POST /sync/cursors/reset`，以及依附于 `version_vector` 的任何分片/断点续传机制。异常的完整解决流程（`fn_resolve_exception`）不在设备 API 范围内，仅提供只读可见性（见第 7 节）。

---

## 3. 提交动作事件 - POST /sync/events

### 3.1 请求规范

```http
POST /api/v1/device/sync/events HTTP/1.1
Host: api.wms7.com
Authorization: Bearer <device_access_token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
X-Client-Version: 3.0.0
Content-Type: application/json
Content-Encoding: gzip         # >1KB 建议压缩
Accept: application/json
Accept-Encoding: gzip, br
```

#### 3.1.1 请求体 Schema

```typescript
interface SubmitEventsRequest {
  events: SyncEvent[];                   // 本批次事件，≤ 200 条
}

interface SyncEvent {
  id: string;                            // 客户端生成的 UUID/ULID —— 即幂等键，服务端主键，不由服务端 DEFAULT 生成
  device_id: string;                     // 设备 ID，需与 X-Device-Id 一致
  operator_user_id: string;              // 实际操作人（PDA 当前登录用户）
  device_seq: number;                    // 设备本地单调递增序列号（bigint，非时钟相关）
  action_type: ActionType;               // 动作类型枚举，见 3.1.2
  payload: Record<string, unknown>;      // 结构化业务命令参数，随 action_type 变化，见 3.1.3
  captured_at: string;                   // ISO8601，设备本地时间戳；仅作审计参考，不作为权威时间
}
```

> **幂等说明**：`id` 即幂等键，无需额外的 `Idempotency-Key` 请求头或字段。重复提交同一条 `id` 的事件会被主键约束天然去重，服务端直接返回该事件当前的（首次处理产生的）结果，不会重复应用副作用。

> **序列号说明**：`UNIQUE(device_id, device_seq)` 是第二重防线，同时用于检测“该设备的序列号是否存在缺口”（可能意味着某次上传丢包，需要设备重新补发缺口部分）。`device_seq` 必须由设备本地严格单调递增生成，不得使用时钟时间代替。

#### 3.1.2 动作类型枚举

```typescript
enum ActionType {
  PICK = 'PICK',                         // 当前唯一已实现完整服务端处理逻辑的动作类型
  PUTAWAY = 'PUTAWAY',                   // Layer 3: 上架（含批次/效期写入、合规校验、MISSING_LABEL 分支）
  COUNT = 'COUNT',                       // Layer 3: 盘点（容差策略查询、自动过账/超容差登记 COUNT_DISCREPANCY、fn_reconcile_location_count 核销）
  PACK = 'PACK',                         // Layer 3: 打包（明细追踪、一箱一码/同码模式、完成时联动更新 order_lines/packing_tasks 状态）
  // 以下类型暂未实现服务端处理，提交后统一返回 REJECTED_UNKNOWN_ACTION：
  RECEIVE = 'RECEIVE',
  SHIP = 'SHIP',
  MOVE = 'MOVE',
}
```

> 未实现的 `action_type` 不代表协议不支持，而是服务端 `fn_apply_sync_event` 尚未提供对应分支；PDA 可以照常提交，只是当前会得到 `REJECTED` / `REJECTED_UNKNOWN_ACTION`。每新增一个可处理的 `action_type`，需在本文档同步登记状态。

#### 3.1.3 `payload` 示例（`action_type = 'PICK'`）

```json
{
  "id": "01J8Z3K7QZR8N5V9X6M2W4T1E0",
  "device_id": "pda-0231",
  "operator_user_id": "user-uuid-7788",
  "device_seq": 10245,
  "action_type": "PICK",
  "payload": {
    "sku": "SKU-000123",
    "qty": 5,
    "location_id": "loc-uuid-A01-02-03",
    "order_line_id": "ol-uuid-9981"
  },
  "captured_at": "2026-07-15T02:31:07.412Z"
}
```

#### 3.1.4 `payload` 示例（`action_type = 'PUTAWAY'`）

```json
{
  "id": "01J8Z3K7QZR8N5V9X6M2W4T1E1",
  "device_id": "pda-0231",
  "operator_user_id": "user-uuid-7788",
  "device_seq": 10246,
  "action_type": "PUTAWAY",
  "payload": {
    "sku": "SKU-000123",
    "qty": 10,
    "location_id": "loc-uuid-B01-01-01",
    "container_id": "ctn-uuid-5566",
    "batch_no": "BATCH-20260701-001",
    "mfg_date": "2026-06-15",
    "exp_date": "2027-06-15"
  },
  "captured_at": "2026-07-15T02:32:15.123Z"
}
```

#### 3.1.5 `payload` 示例（`action_type = 'COUNT'`）

```json
{
  "id": "01J8Z3K7QZR8N5V9X6M2W4T1E2",
  "device_id": "pda-0231",
  "operator_user_id": "user-uuid-7788",
  "device_seq": 10247,
  "action_type": "COUNT",
  "payload": {
    "location_id": "loc-uuid-A01-02-03",
    "product_id": "prod-uuid-4455",
    "counted_qty": 95,
    "expected_qty": 100,
    "difference_qty": -5,
    "difference_reason": "DAMAGED"
  },
  "captured_at": "2026-07-15T02:33:20.456Z"
}
```

#### 3.1.6 `payload` 示例（`action_type = 'PACK'`）

```json
{
  "id": "01J8Z3K7QZR8N5V9X6M2W4T1E3",
  "device_id": "pda-0231",
  "operator_user_id": "user-uuid-7788",
  "device_seq": 10248,
  "action_type": "PACK",
  "payload": {
    "order_line_id": "ol-uuid-9981",
    "sku": "SKU-000123",
    "qty": 5,
    "container_id": "ctn-uuid-7788",
    "box_type": "MEDIUM",
    "box_code": "BOX-001",
    "labels_printed": ["SF1234567890"],
    "completed": true
  },
  "captured_at": "2026-07-15T02:34:10.789Z"
}
```

### 3.2 响应规范

#### 3.2.1 成功响应 (200 OK)

```typescript
interface SubmitEventsResponse {
  results: EventResult[];                // 与请求 events 一一对应，顺序不保证与请求一致，以 id 匹配
  server_time: string;                   // ISO8601 UTC
}

interface EventResult {
  id: string;                            // 回传事件 id，用于客户端匹配
  status: 'APPLIED' | 'EXCEPTION' | 'REJECTED';

  // status = EXCEPTION 时
  exception_id?: string;                 // 关联的异常记录 ID，PDA 可用于展示/跳转
  exception_type?: string;               // COLD_CHAIN_VIOLATION | HAZMAT_CONFLICT | SYNC_APPLY_FAILURE 等

  // status = REJECTED 时
  reason?: string;                       // REJECTED_UNKNOWN_ACTION 等

  message?: string;                      // 人类可读说明，供 PDA 直接展示
}
```

示例：

```json
{
  "results": [
    {
      "id": "01J8Z3K7QZR8N5V9X6M2W4T1E0",
      "status": "APPLIED",
      "message": "拣选已确认"
    },
    {
      "id": "01J8Z3K7R1S9P2Q7Y8N3X5U2F1",
      "status": "EXCEPTION",
      "exception_id": "exc-uuid-4471",
      "exception_type": "COLD_CHAIN_VIOLATION",
      "message": "该库位温区与商品冷链要求不符，已生成异常 #4471，请联系主管处理"
    },
    {
      "id": "01J8Z3K7R3T0Q3R8Z9P4Y6V3G2",
      "status": "REJECTED",
      "reason": "REJECTED_UNKNOWN_ACTION",
      "message": "action_type=COUNT 暂未支持服务端处理"
    }
  ],
  "server_time": "2026-07-15T02:31:08.020Z"
}
```

> **关键差异（对照旧模型）**：响应中不存在 `conflicts[]` 数组，也不存在需要客户端选择合并策略的字段。`EXCEPTION` 是一个终态展示信息，PDA 只需提示用户“此操作触发异常 #X，请联系主管”，不需要实现任何合并/重试 UI。

#### 3.2.2 事件生命周期（服务端内部状态，供理解响应含义）

```
PENDING → APPLIED    （fn_apply_sync_event 正常执行完成）
PENDING → EXCEPTION  （命中业务合规异常 / 未预期错误，进入统一异常域）
PENDING → REJECTED   （action_type 未知，或请求本身不满足处理前提）
```

只有 `PENDING` 会发生状态迁移；`APPLIED` / `EXCEPTION` / `REJECTED` 均为终态，不会再变化（异常记录本身在管理端可能被人工解决，但对应 `sync_events.status` 仍保持 `EXCEPTION` 不变，解决状态记录在异常域自身的状态字段中，见第 7 节）。

#### 3.2.3 错误响应（批次级，非单条事件级）

| HTTP | 错误码 | 含义 | 客户端处理 |
|------|--------|------|------------|
| 400 | `INVALID_SYNC_REQUEST` | 请求体 Schema 校验失败（如缺少必填字段） | 记录日志，不重试，上报开发 |
| 401 | `UNAUTHORIZED` | Token 过期/无效 | 刷新 Token 重试 |
| 403 | `DEVICE_SUSPENDED` | 设备被禁用 | 停止同步，提示联系管理员 |
| 403 | `TENANT_MISMATCH` | 租户不匹配 | 清理本地数据，重新登录 |
| 413 | `PAYLOAD_TOO_LARGE` | 单批 > 200 条或请求体 > 2MB | 拆分为多批重试 |
| 429 | `SYNC_RATE_LIMITED` | 同步过于频繁 | 读取 `Retry-After`，指数退避 |
| 500 | `INTERNAL_ERROR` | 服务端异常（批次级，非单条事件的 EXCEPTION） | 指数退避重试同一批次（`id` 幂等，安全） |
| 503 | `SERVICE_UNAVAILABLE` | 同步服务维护中 | 延长轮询间隔至 5 分钟 |

> 注意：`409 SYNC_CONFLICT` 已从错误码表中移除。旧模型中的“冲突”在新模型中不再作为同步层的 HTTP 错误出现——它们表现为 HTTP 200 响应中某条事件的 `status: EXCEPTION`，而不是请求级失败。

---

## 4. 拉取参考数据 - GET /sync/pull

### 4.1 请求

```http
GET /api/v1/device/sync/pull?tables=work_order,product,location,container&cursor=<opaque> HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `tables` | string | 分配给该设备的高频表全集 | 逗号分隔，需拉取的表 |
| `cursor` | string | - | 上次拉取返回的游标（按设备+表维度），首次拉取不传 |
| `limit` | integer | 200 | 单表单页上限，最大 500 |

### 4.2 响应

```typescript
interface PullResponse {
  server_time: string;                   // ISO8601 UTC，供设备计算“数据同步于 X 分钟前”
  data: {
    [table: string]: {
      records: Record<string, unknown>[];
      cursor: string;                    // 基于该表 updated_at 的下一页游标，per-device per-table
      has_more: boolean;
    };
  };
}
```

示例：

```json
{
  "server_time": "2026-07-15T02:35:00.000Z",
  "data": {
    "work_order": {
      "records": [ { "id": "wo-uuid-1", "status": "ASSIGNED", "updated_at": "2026-07-15T02:20:11.000Z" } ],
      "cursor": "eyJ1cGRhdGVkX2F0IjoiMjAyNi0wNy0xNVQwMjoyMDoxMS4wMDBaIiwiaWQiOiJ3by11dWlkLTEifQ==",
      "has_more": false
    },
    "product": {
      "records": [],
      "cursor": "eyJ1cGRhdGVkX2F0IjoiMjAyNi0wNy0xNVQwMDowMDowMC4wMDBaIiwiaWQiOm51bGx9",
      "has_more": false
    }
  }
}
```

> 拉取游标基于各核心表已有的 `updated_at` 列（V2.1 schema 中已全表覆盖），无需为同步专门新增版本字段。游标为不透明字符串（服务端编码 `updated_at + pk`），客户端只需原样回传，不需要解析或重建其结构。

---

## 5. 查询同步策略 - GET /sync/policy

### 5.1 请求

```http
GET /api/v1/device/sync/policy?task_type=PICK&zone_type=COLD_CHAIN HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
```

底层封装 `fn_get_sync_policy(tenant_id, task_type, zone_type)`，`tenant_id` 从鉴权上下文解析，无需前端传入。

### 5.2 响应

```json
{
  "offline_mode": "LIMITED",
  "max_offline_duration_seconds": 1800
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `offline_mode` | `ALLOW` \| `LIMITED` \| `ONLINE_ONLY` | 该任务类型/区域是否允许离线作业 |
| `max_offline_duration_seconds` | integer \| null | `LIMITED` 时的最大允许离线时长；`ALLOW` 时通常为 null（不限）；`ONLINE_ONLY` 时为 0 |

PDA 在开始任务前应先调用本接口：若 `offline_mode = ONLINE_ONLY`，则必须先完成任务领用（第 6 节）确认在线可用后才允许进入作业界面；若为 `LIMITED`，需在本地记录离线开始时间，超过 `max_offline_duration_seconds` 后阻止继续离线提交并提示用户联网。

---

## 6. 任务领用 - POST /tasks/{work_order_id}/claim

### 6.1 请求

```http
POST /api/v1/device/tasks/wo-uuid-1/claim HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
Content-Type: application/json

{
  "user_id": "user-uuid-7788",
  "lease_seconds": 1800
}
```

底层封装 `fn_claim_task(work_order_id, user_id, device_id, lease_seconds)`。

### 6.2 响应（200 OK，无论领用成功与否）

```json
{
  "success": true,
  "claim_id": "claim-uuid-9012",
  "message": "领用成功"
}
```

领用失败示例（**依然是 200，而不是错误状态码**）：

```json
{
  "success": false,
  "claim_id": null,
  "message": "该任务已被其他设备领用，请稍后重试或联系主管"
}
```

> **设计说明**：领用失败（唯一约束冲突导致 `fn_claim_task` 返回失败）是一种预期内的、常规的业务结果，而不是系统错误，因此使用 `200 + success:false` 而非 `409`/`423` 等错误状态码。客户端只需读取 `success` 字段分支处理，无需捕获异常。

## 7. 释放任务租约 - POST /tasks/claims/{claim_id}/release

```http
POST /api/v1/device/tasks/claims/claim-uuid-9012/release HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
```

底层封装 `fn_release_task_claim`。

响应：

```json
{
  "success": true,
  "message": "任务租约已释放"
}
```

---

## 8. 异常可见性 - GET /exceptions, GET /exceptions/{id}

### 8.1 列表 - GET /exceptions

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `status` | string | `OPEN` | `OPEN`, `RESOLVED`, `ALL` |
| `exception_type` | string | - | 按类型筛选，如 `COLD_CHAIN_VIOLATION` |
| `limit` | integer | 50 | 最大 200 |
| `offset` | integer | 0 | 分页偏移 |

响应：

```json
{
  "exceptions": [
    {
      "id": "exc-uuid-4471",
      "exception_type": "COLD_CHAIN_VIOLATION",
      "status": "OPEN",
      "source_event_id": "01J8Z3K7R1S9P2Q7Y8N3X5U2F1",
      "summary": "库位温区与商品冷链要求不符",
      "created_at": "2026-07-15T02:31:07.900Z"
    }
  ],
  "total": 1,
  "has_more": false
}
```

### 8.2 详情 - GET /exceptions/{id}

```json
{
  "id": "exc-uuid-4471",
  "exception_type": "COLD_CHAIN_VIOLATION",
  "status": "OPEN",
  "source_event_id": "01J8Z3K7R1S9P2Q7Y8N3X5U2F1",
  "detail": {
    "sqlstate": "WMS01",
    "sku": "SKU-000123",
    "location_id": "loc-uuid-A01-02-03",
    "required_zone": "COLD_CHAIN",
    "actual_zone": "AMBIENT"
  },
  "summary": "库位温区与商品冷链要求不符",
  "created_at": "2026-07-15T02:31:07.900Z",
  "resolved_at": null,
  "resolved_by": null,
  "resolution_note": null
}
```

---

## 9. 缺码处理 - POST /missing-label/generate

### 9.1 请求

```http
POST /api/v1/device/missing-label/generate HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
Content-Type: application/json

{
  "exception_id": "exc-uuid-4471",
  "sku": "SKU-000123",
  "location_id": "loc-uuid-A01-02-03",
  "quantity": 10
}
```

底层封装 `fn_generate_internal_lpn`，返回格式为 `INT-{日期}-{随机串}` 的内部 LPN 码（`containers.lpn_source = 'SYSTEM_GENERATED'`）。

### 9.2 响应 (200 OK)

```json
{
  "internal_lpn": "INT-20260715-A1B2C3D4",
  "container_id": "ctn-uuid-9999",
  "message": "内部码已生成，请打印贴码"
}
```

---

## 10. 确认贴码 - POST /missing-label/confirm

### 10.1 请求

```http
POST /api/v1/device/missing-label/confirm HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
Content-Type: application/json

{
  "exception_id": "exc-uuid-4471",
  "scanned_lpn": "INT-20260715-A1B2C3D4"
}
```

底层封装 `fn_confirm_label_applied`，核对扫描码与生成码一致后，将暂存库存正式挂载到该容器，并通过 `fn_resolve_exception` 关闭异常。

### 10.2 响应 (200 OK)

```json
{
  "success": true,
  "message": "贴码确认成功，库存已挂载至容器 INT-20260715-A1B2C3D4，异常已关闭"
}
```

扫码不匹配时返回 `400 { "success": false, "message": "扫描码与生成的内部码不一致，请重新扫描" }`。

---

## 11. 上报未识别货物 - POST /unidentified/receive

### 11.1 请求

```http
POST /api/v1/device/unidentified/receive HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
Content-Type: application/json

{
  "tenant_id": "tenant-uuid-1234",
  "location_id": "loc-uuid-Q01-01-01",
  "quantity": 5,
  "unit": "PCS",
  "notes": "残包，无标签，无法识别 SKU"
}
```

底层封装 `fn_receive_unidentified_goods`，向 `inventory` 插入 `product_id=NULL` 的暂存行，登记 `UNIDENTIFIED_GOODS` 异常（severity=HIGH）。

### 11.2 响应 (200 OK)

```json
{
  "inventory_id": "inv-uuid-8888",
  "exception_id": "exc-uuid-5555",
  "message": "未识别货物已暂存，请联系主管识别"
}
```

---

## 12. 识别未识别货物 - POST /unidentified/identify

### 12.1 请求

```http
POST /api/v1/device/unidentified/identify HTTP/1.1
Authorization: Bearer <token>
X-API-Key: wms7_dk_<deviceId>_<random>
X-Device-Id: <device_id>
Content-Type: application/json

{
  "inventory_id": "inv-uuid-8888",
  "product_id": "prod-uuid-4455"
}
```

底层封装 `fn_identify_unidentified_goods`，回填 `product_id`，**同时触发合规触发器复查（UPDATE OF product_id 触发 `fn_trg_enforce_product_constraints`）**。若目标库位不满足该商品的冷链/危险品要求，识别动作会被直接拦截并报错，倒逼主管先移库再识别。

### 12.2 响应 (200 OK)

```json
{
  "success": true,
  "message": "未识别货物已识别为 SKU-000445，库存已更新，异常已关闭"
}
```

若合规复查失败：

```json
{
  "success": false,
  "message": "识别失败：商品 SKU-000445 要求冷链存储（2-8°C），但当前库位 loc-uuid-Q01-01-01 非冷藏区，请先将货物移至合规库位后再确认身份"
}
```

---

## 9. 异常分类与错误码

### 9.1 `fn_apply_sync_event` 结果分类

| 触发条件 | 事件 `status` | `exception_type` / `reason` | 说明 |
|----------|----------------|-------------------------------|------|
| 命中自定义 SQLSTATE `'WMS01'`（合规性冲突） | `EXCEPTION` | `COLD_CHAIN_VIOLATION` 或 `HAZMAT_CONFLICT`（按具体校验规则区分） | 业务规则明确拒绝，但不是系统故障；生成异常记录供人工处理 |
| 应用过程中出现未预期错误（如下游服务超时、数据不一致） | `EXCEPTION` | `SYNC_APPLY_FAILURE` | 非业务规则触发，值得工程侧关注，同样落入统一异常域 |
| `action_type` 不在已实现集合内 | `REJECTED` | `REJECTED_UNKNOWN_ACTION` | 不生成异常记录，仅作为请求被拒绝的说明返回给客户端 |

### 9.2 批次级错误码汇总

| HTTP | 错误码 | 含义 |
|------|--------|------|
| 400 | `INVALID_SYNC_REQUEST` | 请求体 Schema 校验失败 |
| 401 | `UNAUTHORIZED` | Token 过期/无效 |
| 403 | `DEVICE_SUSPENDED` | 设备被禁用 |
| 403 | `TENANT_MISMATCH` | 租户不匹配 |
| 413 | `PAYLOAD_TOO_LARGE` | 单批超出条数/大小限制 |
| 429 | `SYNC_RATE_LIMITED` | 同步过于频繁 |
| 500 | `INTERNAL_ERROR` | 服务端异常（整批未处理，非单条 EXCEPTION） |
| 503 | `SERVICE_UNAVAILABLE` | 同步服务维护中 |

> `409 SYNC_CONFLICT` 已废弃，不再出现于任何接口。

---

## 10. 限流与配额

| 维度 | 限制 | 超限响应 |
|------|------|----------|
| 设备级事件提交频率 | 10 次/分钟 | `429 SYNC_RATE_LIMITED` |
| 设备级 API 总频率 | 200 次/分钟 | `429 RATE_LIMITED` |
| 单批事件数 | ≤ 200 条 | `413 PAYLOAD_TOO_LARGE`，客户端拆分为多批 |
| 单批载荷大小 | 2 MB（压缩前） | `413 PAYLOAD_TOO_LARGE` |
| 单次拉取记录数 | 500 条/表 | 服务端截断并返回 `has_more=true` |

响应头：

```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 8
X-RateLimit-Reset: 1720695600
Retry-After: 30          # 仅 429 时返回
```

---

## 11. 幂等与重试策略

- **幂等键即事件 `id`**：不存在也不需要独立的 `Idempotency-Key` 请求头或字段。`sync_events.id` 由 PDA 生成（UUID/ULID），作为主键天然去重；重复提交同一 `id` 直接返回该事件当前结果，不重复触发副作用。
- **`device_seq` 用于缺口检测**：`UNIQUE(device_id, device_seq)` 便于服务端察觉“这台设备的序列号是否有缺口”，从而推断是否存在丢包；PDA 应保证 `device_seq` 严格本地单调递增（不依赖设备时钟）。
- **网络失败后的安全做法**：由于 `PENDING → {APPLIED, EXCEPTION, REJECTED}` 只有 `PENDING` 会迁移，且 `id` 幂等，客户端在网络失败/超时后的唯一正确行为是——**原样重试同一批次（相同的 `id` 集合）**，无需任何额外的去重/重试协议层，也无需先查询状态再决定是否重发。

---

## 12. 安全规范

### 12.1 请求签名（可选增强）

```
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

### 12.2 数据加密

| 层面 | 方案 |
|------|------|
| 传输层 | TLS 1.3 强制，证书锁定 |
| 应用层 | 敏感字段（如批次号、序列号）可选字段级加密 |
| 存储层 | 服务端 PostgreSQL TDE，PDA 端 SQLCipher |

### 12.3 审计日志

同步接口必须记录：
- `device_id`, `tenant_id`, `operator_user_id`
- 每批 `events` 数量、`APPLIED`/`EXCEPTION`/`REJECTED` 计数
- `duration_ms`, `network_type`
- 异常生成详情：`exception_id`, `exception_type`, `source_event_id`

---

## 13. 客户端实现指南

### 13.1 同步状态机（简化）

新模型下客户端状态机显著简化：不再有 `RESOLVING_CONFLICTS` 状态，也没有分片重试循环。

```typescript
enum SyncState {
  IDLE = 'IDLE',
  SUBMITTING = 'SUBMITTING',    // 提交本地待发送事件批次
  PULLING = 'PULLING',          // 拉取只读参考数据
  APPLYING = 'APPLYING',        // 本地写入拉取到的参考数据
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

class SyncEngine {
  private state = SyncState.IDLE;

  async sync(): Promise<SyncResult> {
    if (this.state !== SyncState.IDLE) throw new Error('Sync in progress');

    this.state = SyncState.SUBMITTING;
    const batch = await this.collectPendingEvents(200); // 本地已生成 id/device_seq
    const { results } = await this.submitEvents(batch); // 失败直接重试同一批次即可

    for (const r of results) {
      if (r.status === 'EXCEPTION') {
        await this.markLocalEventException(r.id, r.exception_id, r.message);
      } else if (r.status === 'REJECTED') {
        await this.markLocalEventRejected(r.id, r.reason, r.message);
      } else {
        await this.markLocalEventApplied(r.id);
      }
    }

    this.state = SyncState.PULLING;
    const pulled = await this.pullReferenceData();
    this.state = SyncState.APPLYING;
    await this.applyPullData(pulled);

    this.state = SyncState.COMPLETED;
    return { success: true };
  }
}
```

### 13.2 退避重试策略

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
        continue; // 重试同一批次，events 数组内 id 不变，服务端天然幂等
      }
      throw e; // 非重试错误直接抛出
    }
  }
}
```

### 13.3 网络感知同步调度

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

## 14. 测试契约

### 14.1 契约测试用例

| 用例 ID | 场景 | 预期结果 |
|---------|------|----------|
| SYNC-001 | 首次拉取（空本地） | `GET /sync/pull` 无 `cursor` 时返回全量高频表数据，游标建立 |
| SYNC-002 | 正常提交（5 条 PICK 事件） | 全部返回 `status=APPLIED` |
| SYNC-003 | 冷链违规提交 | 返回 `status=EXCEPTION`，`exception_type=COLD_CHAIN_VIOLATION`，生成 `exception_id` |
| SYNC-004 | 未知 action_type 提交 | 返回 `status=REJECTED`，`reason=REJECTED_UNKNOWN_ACTION` |
| SYNC-005 | 幂等重试（网络超时后重发同一批次） | 服务端识别 `id` 已处理，返回原结果，不重复应用副作用 |
| SYNC-006 | `device_seq` 缺口 | 服务端可通过 `UNIQUE(device_id, device_seq)` 查询发现缺口，触发丢包排查（非本接口直接返回错误） |
| SYNC-007 | 任务领用竞争 | 两台设备并发领用同一 `work_order_id`，一台 `success:true`，另一台 `success:false` 且为 200 |
| SYNC-008 | 离线策略查询 | `ONLINE_ONLY` 任务在无网络时 PDA 阻止进入作业界面 |
| SYNC-009 | 限流触发退避 | 连续 11 次提交触发 `429`，客户端指数退避 |
| SYNC-010 | 异常列表展示 | `GET /exceptions?status=OPEN` 返回本设备产生的未解决异常，供 PDA 展示 |

### 14.2 性能基线

| 指标 | 目标 | 测试条件 |
|------|------|----------|
| 单批事件提交延迟 (P99) | < 1000ms | 200 条事件，WiFi |
| 参考数据拉取延迟 (P99) | < 800ms | 500 条/表，WiFi |
| 事件应用成功率（`APPLIED` 占比，排除业务性 `EXCEPTION`/`REJECTED`） | > 99.9% | 日均 1000 设备 |
| 异常生成到管理端可见延迟 | < 5s | 事件提交后 |
| 离线数据零丢失 | 100% | 杀进程/断电/卸载重装测试 |

---

## 15. 版本变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 2.1.0 | 2026-07-16 | **Layer 3/4 扩展**：新增 PUTAWAY/COUNT/PACK 三个 action_type 的 payload 规范，新增 Layer 4 端点（`/missing-label/generate`、`/missing-label/confirm`、`/unidentified/receive`、`/unidentified/identify`），对应 Layer 3 同步动作扩展与 Layer 4 追踪策略/无码货物闭环 | DBA 团队 / 架构组 |
| 2.0.0 | 2026-07-15 | **重大变更**：DBA 团队交付新方案，废弃 v1.0.0 的状态同步模型（`LocalOperation` + `version_vector` + 服务端 `conflicts[]` + 客户端合并策略协商），改为事件同步模型（`sync_events` 幂等收件箱 + 确定性重放函数 + `APPLIED`/`EXCEPTION`/`REJECTED` 三态）。移除 `/sync/status`、`/sync/conflicts`、`/sync/conflicts/{id}/resolve`、`/sync/cursors`、`/sync/cursors/reset` 及分片/断点续传机制；新增 `/sync/events`、`/sync/pull`、`/sync/policy`、`/tasks/{work_order_id}/claim`、`/tasks/claims/{claim_id}/release`、`/exceptions`、`/exceptions/{id}`。移除 `409 SYNC_CONFLICT` 错误码。 | DBA 团队 / 架构组 |
| 1.0.0 | 2025-07-11 | 初版：完整契约、分片、冲突、游标、限流、安全、客户端指南、测试用例（已废弃，见上） | 架构组 |

---

*本文档为同步接口契约单一事实来源。任何接口变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（第 4 节流程）、`DEVICE_PROTOCOL_SPEC.md`（2.3 节）、`SQLITE_LOCAL_SCHEMA.md`（`sync_events` 本地镜像字段）、`CONFLICT_RESOLUTION_STRATEGY.md`（已转型为“异常处理策略”，不再描述客户端合并策略）。*
