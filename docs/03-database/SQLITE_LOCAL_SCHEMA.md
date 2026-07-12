# PDA 本地 SQLite 数据库 Schema 设计

> **版本**: v1.0.0  
> **状态**: 草案待评审  
> **加密**: SQLCipher (AES-256)  
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`, `DEVICE_PROTOCOL_SPEC.md`, `CONFLICT_RESOLUTION_STRATEGY.md`

---

## 1. 设计原则

| 原则 | 实现方式 |
|------|----------|
| **主库表结构镜像** | 本地表字段与主库 Supabase 表严格对应，便于同步映射 |
| **版本向量内嵌** | 每业务表含 `_version` 字段，同步队列携带完整版本向量 |
| **同步状态显性化** | 独立 `sync_queue` 表记录所有待同步操作，支持重试/分片/优先级 |
| **冲突可追溯** | 冲突记录持久化，支持人工介入后重试 |
| **存储空间可控** | 分区表 + 定期清理策略，单设备上限 100MB |
| **加密合规** | SQLCipher AES-256，密钥派生自设备绑定 Key + 用户 PIN |

---

## 2. 表结构总览

| 分类 | 表名 | 说明 | 预估行数 | 同步方向 |
|------|------|------|----------|----------|
| **同步核心** | `sync_queue` | 待同步操作队列 | 50,000 | PDA → Server |
| | `sync_sessions` | 同步会话记录 | 1,000 | 双向 |
| | `sync_conflicts` | 冲突记录 | 500 | 双向 |
| | `sync_cursors` | 增量同步游标 | 50 | Server → PDA |
| **业务数据镜像** | `products` | 商品主数据 | 10,000 | Server → PDA |
| | `locations` | 库位主数据 | 5,000 | Server → PDA |
| | `containers` | 容器/LPN | 20,000 | 双向 |
| | `inventory` | 库存快照 | 50,000 | 双向 |
| | `work_orders` | 作业工单 | 5,000 | 双向 |
| | `wo_action_logs` | 操作日志 | 100,000 | PDA → Server |
| | `tasks` | 任务分配 | 2,000 | Server → PDA |
| | `tasks_steps` | 任务步骤 | 10,000 | 双向 |
| | `inbound_receipts` | 入库单 | 1,000 | 双向 |
| | `packing_tasks` | 打包任务 | 2,000 | 双向 |
| | `sorting_tasks` | 分拣任务 | 2,000 | 双向 |
| | `quality_inspections` | 质检单 | 1,000 | 双向 |
| **设备/配置** | `device_info` | 设备注册信息 | 1 | 本地 |
| | `device_config` | 运行时配置 | 1 | Server → PDA |
| | `user_profile` | 当前用户档案 | 1 | Server → PDA |
| **媒体/附件** | `pending_uploads` | 待上传文件记录 | 500 | PDA → Server |

---

## 3. 核心表定义 (DDL)

### 3.1 同步队列表

```sql
-- 同步操作队列：所有本地写操作先入队，再异步推送
CREATE TABLE sync_queue (
    -- 主键
    local_id          TEXT PRIMARY KEY,           -- ULID，含时间戳，天然有序
    
    -- 实体标识
    entity_type       TEXT NOT NULL,              -- 对应 EntityType 枚举
    operation         TEXT NOT NULL,              -- CREATE, UPDATE, DELETE, COMPOUND
    entity_id         TEXT NOT NULL,              -- 业务主键（如 work_order_id）
    
    -- 租户/设备上下文
    tenant_id         TEXT NOT NULL,
    device_id         TEXT NOT NULL,
    
    -- 操作载荷（JSON）
    payload           TEXT NOT NULL,              -- 完整新值或增量字段
    payload_hash      TEXT NOT NULL,              -- SHA256(payload)，用于幂等去重
    
    -- 版本向量（JSON）：{ "table_name": { "row_pk": version } }
    version_vector    TEXT NOT NULL,
    
    -- 业务上下文（JSON）
    business_context  TEXT,                       -- 可选，冲突解决用
    
    -- 时间戳
    occurred_at       TEXT NOT NULL,              -- ISO8601 UTC，操作发生时间
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    
    -- 同步元数据
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, SYNCING, CONFLICT, RESOLVED, COMPLETED, FAILED
    priority          INTEGER NOT NULL DEFAULT 2,   -- 1=高(拣选/发货), 2=中(收货/上架), 3=低(盘点/移库)
    retry_count       INTEGER NOT NULL DEFAULT 0,
    max_retries       INTEGER NOT NULL DEFAULT 3,
    last_sync_attempt TEXT,                       -- 最后尝试同步时间
    last_error        TEXT,                       -- 最后错误信息
    
    -- 分片支持
    chunk_id          TEXT,                       -- 同步会话分片 ID
    chunk_index       INTEGER,                    -- 分片序号
    total_chunks      INTEGER,                    -- 总分片数
    
    -- 服务端响应（成功时填充）
    server_entity_id  TEXT,                       -- CREATE 时服务端生成的 ID
    server_version    TEXT,                       -- 服务端版本
    synced_at         TEXT                        -- 同步成功时间
);

-- 索引
CREATE INDEX idx_sync_queue_status_priority ON sync_queue(status, priority, occurred_at);
CREATE INDEX idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
CREATE INDEX idx_sync_queue_chunk ON sync_queue(chunk_id, chunk_index);
CREATE INDEX idx_sync_queue_tenant_device ON sync_queue(tenant_id, device_id);
CREATE INDEX idx_sync_queue_payload_hash ON sync_queue(payload_hash);  -- 幂等去重
```

### 3.2 同步会话表

```sql
-- 同步会话记录：每次同步发起一条，记录统计与状态
CREATE TABLE sync_sessions (
    session_id        TEXT PRIMARY KEY,           -- ULID
    tenant_id         TEXT NOT NULL,
    device_id         TEXT NOT NULL,
    
    -- 时间
    started_at        TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at      TEXT,
    
    -- 统计
    push_total        INTEGER NOT NULL DEFAULT 0,
    push_succeeded    INTEGER NOT NULL DEFAULT 0,
    push_conflicts    INTEGER NOT NULL DEFAULT 0,
    push_errors       INTEGER NOT NULL DEFAULT 0,
    pull_total        INTEGER NOT NULL DEFAULT 0,
    
    -- 状态
    status            TEXT NOT NULL DEFAULT 'IN_PROGRESS',  -- IN_PROGRESS, COMPLETED, FAILED, PARTIAL
    error_summary     TEXT,                       -- 失败汇总
    
    -- 网络/环境
    network_type      TEXT,                       -- wifi, 4g, 5g, ethernet
    client_version    TEXT,
    server_version    TEXT,
    
    -- 分片
    total_chunks      INTEGER NOT NULL DEFAULT 1,
    completed_chunks  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sync_sessions_device_time ON sync_sessions(device_id, started_at DESC);
```

### 3.3 冲突记录表

```sql
-- 同步冲突持久化：服务端返回冲突后本地存储，供用户解决
CREATE TABLE sync_conflicts (
    conflict_id       TEXT PRIMARY KEY,           -- 服务端生成
    local_id          TEXT NOT NULL,              -- 关联 sync_queue.local_id
    
    -- 冲突详情（JSON）
    local_operation   TEXT NOT NULL,              -- 完整 LocalOperation
    server_state      TEXT NOT NULL,              -- 服务端当前状态
    server_version_vector TEXT NOT NULL,          -- 服务端版本向量
    conflict_type     TEXT NOT NULL,              -- VERSION_MISMATCH, UNIQUE_VIOLATION, FK_VIOLATION, BUSINESS_RULE, CONCURRENT_OPERATION
    
    -- 解决建议
    suggested_resolution TEXT NOT NULL,           -- SERVER_WINS, CLIENT_WINS, MERGE, MANUAL, TRANSFORM, CRDT_MERGE
    resolution_options TEXT NOT NULL,             -- JSON 数组 ConflictResolutionOption[]
    
    -- 解决状态
    status            TEXT NOT NULL DEFAULT 'UNRESOLVED',  -- UNRESOLVED, RESOLVED, IGNORED
    resolved_strategy TEXT,                       -- 实际使用的策略
    resolved_by       TEXT,                       -- 解决人 user_id
    resolved_at       TEXT,                       -- 解决时间
    resolution_note   TEXT,                       -- 备注
    
    -- 重试
    retry_synced      INTEGER NOT NULL DEFAULT 0, -- 0=否, 1=是
    retry_count       INTEGER NOT NULL DEFAULT 0,
    
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sync_conflicts_status ON sync_conflicts(status);
CREATE INDEX idx_sync_conflicts_local_id ON sync_conflicts(local_id);
```

### 3.4 同步游标表

```sql
-- 增量同步游标：每表记录最后拉取位置
CREATE TABLE sync_cursors (
    table_name        TEXT PRIMARY KEY,           -- 表名
    tenant_id         TEXT NOT NULL,
    device_id         TEXT NOT NULL,
    
    -- 游标位置
    cursor_updated_at TEXT NOT NULL,              -- 最后一条记录的 updated_at
    cursor_pk         TEXT NOT NULL,              -- 最后一条记录的主键
    cursor_version    TEXT,                       -- 版本号（如有）
    
    -- 统计
    last_pull_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_pull_count   INTEGER NOT NULL DEFAULT 0,
    total_pulled      INTEGER NOT NULL DEFAULT 0,
    
    -- 状态
    is_full_sync      INTEGER NOT NULL DEFAULT 0, -- 0=增量, 1=全量
    error_count       INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,
    
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.5 商品主数据表

```sql
-- 商品主数据（只读镜像，Server → PDA）
CREATE TABLE products (
    id                TEXT PRIMARY KEY,           -- UUID
    tenant_id         TEXT NOT NULL,
    sku               TEXT NOT NULL,
    name              TEXT NOT NULL,
    category_id       TEXT,
    unit              TEXT NOT NULL DEFAULT 'PCS',
    
    -- 规格
    specs             TEXT,                       -- JSON: {color, size, model...}
    
    -- 物理属性
    unit_weight_g     INTEGER,                    -- 单件重量(克)
    unit_volume_cm3   INTEGER,                    -- 单件体积(立方厘米)
    dimensions_mm     TEXT,                       -- JSON: {length, width, height}
    
    -- 条码
    barcodes          TEXT,                       -- JSON 数组 ["690123...", "690123..."]
    
    -- 约束
    is_serial_required INTEGER NOT NULL DEFAULT 0,
    is_fragile        INTEGER NOT NULL DEFAULT 0,
    is_hazardous      INTEGER NOT NULL DEFAULT 0,
    temperature_range TEXT,                       -- "2-8°C"
    shelf_life_days   INTEGER,
    
    -- 分类
    abc_class         TEXT NOT NULL DEFAULT 'C',  -- A/B/C
    
    -- 版本/同步
    _version          INTEGER NOT NULL DEFAULT 1, -- 乐观锁版本
    _synced_at        TEXT NOT NULL,              -- 最后同步时间
    _server_updated_at TEXT NOT NULL,             -- 服务端 updated_at
    
    UNIQUE(tenant_id, sku)
);

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_barcodes ON products(barcodes);  -- JSON1 扩展索引
CREATE INDEX idx_products_abc ON products(abc_class);
```

### 3.6 库位主数据表

```sql
-- 库位主数据（只读镜像）
CREATE TABLE locations (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    code              TEXT NOT NULL,              -- 人类可读编码：A-01-02-03
    name              TEXT,
    
    -- 分区
    zone_type         TEXT NOT NULL,              -- PICK, BULK, RECV, SHIP, CROSS_DOCK, FROZEN, QUARANTINE
    zone_name         TEXT,
    abc_zone          TEXT,                       -- A/B/C 区
    
    -- 容量
    max_capacity_qty  REAL,                       -- 最大容量(件)
    max_weight_kg     REAL,                       -- 最大承重(kg)
    max_volume_m3     REAL,                       -- 最大体积(m³)
    current_qty       REAL NOT NULL DEFAULT 0,    -- 当前占用(件)
    current_weight_kg REAL NOT NULL DEFAULT 0,
    current_volume_m3 REAL NOT NULL DEFAULT 0,
    
    -- 状态
    status            TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, FROZEN, MAINTENANCE, FULL
    is_frozen         INTEGER NOT NULL DEFAULT 0,      -- 冷冻库位标识
    
    -- 路径/坐标
    path_sequence     INTEGER,                    -- 拣选路径序号
    coordinates       TEXT,                       -- JSON: {x, y, z, aisle, rack, level, bin}
    
    -- 版本/同步
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    
    UNIQUE(tenant_id, code)
);

CREATE INDEX idx_locations_code ON locations(code);
CREATE INDEX idx_locations_zone ON locations(zone_type, status);
CREATE INDEX idx_locations_path ON locations(path_sequence);
```

### 3.7 容器/LPN 表

```sql
-- 容器/托盘/LPN（双向同步）
CREATE TABLE containers (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    lpn_code          TEXT NOT NULL,              -- LPN 条码，业务唯一
    
    -- 层级
    parent_container_id TEXT,                     -- 嵌套容器
    container_type    TEXT NOT NULL,              -- PALLET, BOX, TOTE, CARTON, RACK
    
    -- 位置
    location_id       TEXT,                       -- 当前库位
    location_code     TEXT,                       -- 冗余，便于离线查询
    
    -- 状态
    status            TEXT NOT NULL DEFAULT 'IDLE',  -- IDLE, IN_USE, STAGED, SEALED, RETIRED
    seal_no           TEXT,                       -- 铅封号
    sealed_at         TEXT,
    sealed_by         TEXT,
    
    -- 物理属性
    weight_kg         REAL,
    volume_m3         REAL,
    dimensions_cm     TEXT,                       -- JSON: {l, w, h}
    
    -- 版本/同步
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    _local_dirty      INTEGER NOT NULL DEFAULT 0, -- 1=本地有未同步修改
    
    UNIQUE(tenant_id, lpn_code)
);

CREATE INDEX idx_containers_lpn ON containers(lpn_code);
CREATE INDEX idx_containers_location ON containers(location_id);
CREATE INDEX idx_containers_parent ON containers(parent_container_id);
CREATE INDEX idx_containers_dirty ON containers(_local_dirty) WHERE _local_dirty = 1;
```

### 3.8 库存表

```sql
-- 库存快照（双向同步，核心高频表）
CREATE TABLE inventory (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    location_id       TEXT,
    container_id      TEXT,
    
    -- 数量
    quantity          REAL NOT NULL DEFAULT 0,    -- 可用数量
    reserved_qty      REAL NOT NULL DEFAULT 0,    -- 预留数量
    locked_qty        REAL NOT NULL DEFAULT 0,    -- 冻结数量
    
    -- 属性
    picking_priority  INTEGER NOT NULL DEFAULT 10, -- 99=散货最高优先
    batch_no          TEXT,
    mfg_date          TEXT,                       -- YYYY-MM-DD
    exp_date          TEXT,                       -- YYYY-MM-DD
    
    -- 版本/并发控制（关键）
    _version          INTEGER NOT NULL DEFAULT 1, -- 乐观锁，每次 UPDATE +1
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    _local_dirty      INTEGER NOT NULL DEFAULT 0,
    
    -- 唯一约束：同一租户下，商品+库位+容器+批次+效期唯一
    UNIQUE(tenant_id, product_id, location_id, container_id, batch_no, exp_date)
);

-- 核心索引（对应主库 idx_inv_sku_priority）
CREATE INDEX idx_inv_sku_priority ON inventory(product_id, picking_priority DESC, exp_date ASC NULLS LAST);
CREATE INDEX idx_inv_picking_priority ON inventory(picking_priority DESC) WHERE picking_priority = 99;
CREATE INDEX idx_inv_location ON inventory(location_id);
CREATE INDEX idx_inv_container ON inventory(container_id);
CREATE INDEX idx_inv_batch_exp ON inventory(batch_no, exp_date);
CREATE INDEX idx_inv_dirty ON inventory(_local_dirty) WHERE _local_dirty = 1;
CREATE INDEX idx_inv_tenant_product ON inventory(tenant_id, product_id);

-- 触发器：自动维护 _version
CREATE TRIGGER trg_inventory_version_update
AFTER UPDATE ON inventory
WHEN NEW._version = OLD._version
BEGIN
    UPDATE inventory SET _version = _version + 1, _local_dirty = 1 WHERE id = NEW.id;
END;
```

### 3.9 作业工单表

```sql
-- 作业工单（双向同步）
CREATE TABLE work_orders (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    wo_no             TEXT NOT NULL,              -- 业务单号
    
    -- 类型与状态
    wo_type           TEXT NOT NULL,              -- PICKING, PUTAWAY, REPLENISHMENT, COUNTING, PACKING, SORTING, LOADING, VAS
    status            TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN, ASSIGNED, IN_PROGRESS, COMPLETED, EXCEPTION, CANCELLED
    priority          INTEGER NOT NULL DEFAULT 10,
    
    -- 关联
    wave_id           TEXT,
    parent_wo_id      TEXT,                       -- 父工单（拆分场景）
    source_document_id TEXT,                      -- 来源单据
    
    -- 指派
    assignee_id       TEXT,
    assignee_name     TEXT,
    device_id         TEXT,
    
    -- 进度
    total_qty         REAL NOT NULL DEFAULT 0,
    completed_qty     REAL NOT NULL DEFAULT 0,
    exception_qty     REAL NOT NULL DEFAULT 0,
    
    -- PPH 统计
    target_pph        REAL,
    actual_pph        REAL,
    
    -- 时间
    planned_start_at  TEXT,
    planned_end_at    TEXT,
    started_at        TEXT,
    completed_at      TEXT,
    
    -- 版本/同步
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    _local_dirty      INTEGER NOT NULL DEFAULT 0,
    
    UNIQUE(tenant_id, wo_no)
);

CREATE INDEX idx_wo_assignee_status ON work_orders(assignee_id, status);
CREATE INDEX idx_wo_wave ON work_orders(wave_id);
CREATE INDEX idx_wo_device ON work_orders(device_id);
CREATE INDEX idx_wo_dirty ON work_orders(_local_dirty) WHERE _local_dirty = 1;

-- 操作日志（PDA → Server，纯追加）
CREATE TABLE wo_action_logs (
    id                TEXT PRIMARY KEY,           -- ULID
    tenant_id         TEXT NOT NULL,
    work_order_id     TEXT NOT NULL,
    action_type       TEXT NOT NULL,              -- SCAN_LOCATION, SCAN_PRODUCT, CONFIRM_QTY, PACK, SEAL, EXCEPTION, ...
    step_id           TEXT,                       -- 任务步骤 ID
    
    -- 执行数据
    scanned_data      TEXT,                       -- JSON: 扫描的原始数据
    result_data       TEXT,                       -- JSON: 执行结果
    
    -- 上下文
    operator_id       TEXT NOT NULL,
    device_id         TEXT NOT NULL,
    location_code     TEXT,
    product_sku       TEXT,
    quantity          REAL,
    batch_no          TEXT,
    container_lpn     TEXT,
    
    -- 状态
    is_success        INTEGER NOT NULL DEFAULT 1,
    error_code        TEXT,
    error_message     TEXT,
    
    -- 性能
    duration_ms       INTEGER,
    
    -- 时间/版本
    occurred_at       TEXT NOT NULL,              -- 本地发生时间
    _synced_at        TEXT,                       -- 同步时间，NULL=未同步
    _local_dirty      INTEGER NOT NULL DEFAULT 1  -- 新增即脏
);

CREATE INDEX idx_woal_wo ON wo_action_logs(work_order_id, occurred_at);
CREATE INDEX idx_woal_operator ON wo_action_logs(operator_id, occurred_at);
CREATE INDEX idx_woal_dirty ON wo_action_logs(_local_dirty) WHERE _local_dirty = 1;
CREATE INDEX idx_woal_device_time ON wo_action_logs(device_id, occurred_at);
```

### 3.10 任务与步骤表

```sql
-- 任务分配（Server → PDA 为主，PDA 更新状态双向）
CREATE TABLE tasks (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    task_no           TEXT NOT NULL,
    
    -- 类型与状态
    task_type         TEXT NOT NULL,              -- PICKING, PACKING, SORTING, LOADING, RECEIVING, PUTAWAY, COUNTING
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, EXCEPTION, CANCELLED
    priority          INTEGER NOT NULL DEFAULT 10,
    
    -- 关联
    work_order_id     TEXT,
    wave_id           TEXT,
    parent_task_id    TEXT,
    
    -- 指派
    assignee_id       TEXT,
    assignee_name     TEXT,
    device_id         TEXT,
    
    -- 进度
    total_steps       INTEGER NOT NULL DEFAULT 0,
    completed_steps   INTEGER NOT NULL DEFAULT 0,
    
    -- 汇总
    summary           TEXT,                       -- JSON: {total_lines, total_qty, completed_qty}
    
    -- 时间
    assigned_at       TEXT,
    started_at        TEXT,
    completed_at      TEXT,
    due_at            TEXT,
    
    -- 版本/同步
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    _local_dirty      INTEGER NOT NULL DEFAULT 0,
    
    UNIQUE(tenant_id, task_no)
);

CREATE INDEX idx_tasks_assignee_status ON tasks(assignee_id, status);
CREATE INDEX idx_tasks_wo ON tasks(work_order_id);
CREATE INDEX idx_tasks_device ON tasks(device_id);
CREATE INDEX idx_tasks_due ON tasks(due_at) WHERE status IN ('PENDING','ASSIGNED','IN_PROGRESS');
CREATE INDEX idx_tasks_dirty ON tasks(_local_dirty) WHERE _local_dirty = 1;

-- 任务步骤（双向）
CREATE TABLE task_steps (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    task_id           TEXT NOT NULL,
    step_no           INTEGER NOT NULL,           -- 步骤序号
    
    -- 类型与指令
    step_type         TEXT NOT NULL,              -- SCAN_LOCATION, SCAN_PRODUCT, CONFIRM_QTY, PRINT_LABEL, SEAL, HANDOVER, ...
    instruction       TEXT NOT NULL,
    
    -- 校验规则
    validation_rule   TEXT,                       -- JSON: {type, expected, ...}
    
    -- 状态
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, IN_PROGRESS, COMPLETED, SKIPPED, EXCEPTION
    is_required       INTEGER NOT NULL DEFAULT 1,
    
    -- 执行记录
    executed_at       TEXT,
    executed_by       TEXT,
    scanned_data      TEXT,                       -- JSON: 实际扫描数据
    result_data       TEXT,                       -- JSON: 执行结果
    duration_ms       INTEGER,
    exception_code    TEXT,
    exception_note    TEXT,
    
    -- 版本/同步
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT,
    _server_updated_at TEXT,
    _local_dirty      INTEGER NOT NULL DEFAULT 0,
    
    UNIQUE(task_id, step_no)
);

CREATE INDEX idx_ts_task ON task_steps(task_id, step_no);
CREATE INDEX idx_ts_dirty ON task_steps(_local_dirty) WHERE _local_dirty = 1;
```

### 3.11 入库/打包/分拣/质检等业务表

```sql
-- 入库单据（双向）
CREATE TABLE inbound_receipts (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    receipt_no        TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, RECEIVING, RECEIVED, INSPECTING, PUTAWAY, CLOSED
    supplier_id       TEXT,
    supplier_name     TEXT,
    asn_id            TEXT,                           -- 预入库单关联
    expected_at       TEXT,
    received_at       TEXT,
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    _local_dirty      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, receipt_no)
);

-- 打包任务（双向）
CREATE TABLE packing_tasks (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    task_no           TEXT NOT NULL,
    work_order_id     TEXT,
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, PACKING, LABEL_PRINTING, SEALED, COMPLETED, EXCEPTION
    container_lpn     TEXT,
    package_spec_id   TEXT,
    carrier           TEXT,
    tracking_no       TEXT,
    label_url         TEXT,
    boxes_count       INTEGER NOT NULL DEFAULT 0,
    total_weight_kg   REAL,
    total_volume_m3   REAL,
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    _local_dirty      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, task_no)
);

-- 分拣任务（双向）
CREATE TABLE sorting_tasks (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    task_no           TEXT NOT NULL,
    wave_id           TEXT,
    sorting_wave_id   TEXT,
    chute_id          TEXT,
    chute_code        TEXT,
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, EXCEPTION
    priority          INTEGER NOT NULL DEFAULT 10,
    sequence_no       INTEGER,
    container_lpn     TEXT,
    product_id        TEXT,
    product_sku       TEXT,
    quantity          REAL,
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    _local_dirty      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, task_no)
);

-- 质检单（双向）
CREATE TABLE quality_inspections (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    inspection_no     TEXT NOT NULL,
    inbound_receipt_id TEXT,
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, IN_PROGRESS, PASSED, FAILED, QUARANTINE, REWORK, CANCELLED
    result            TEXT,                             -- PASS, REJECT, QUARANTINE, REWORK
    inspector_id      TEXT,
    started_at        TEXT,
    completed_at      TEXT,
    _version          INTEGER NOT NULL DEFAULT 1,
    _synced_at        TEXT NOT NULL,
    _server_updated_at TEXT NOT NULL,
    _local_dirty      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, inspection_no)
);
```

### 3.12 设备/配置/用户表

```sql
-- 设备注册信息（本地持久化）
CREATE TABLE device_info (
    id                TEXT PRIMARY KEY DEFAULT 'current',
    device_id         TEXT NOT NULL UNIQUE,
    api_key           TEXT NOT NULL,                    -- 加密存储
    tenant_id         TEXT,
    device_name       TEXT,
    device_type       TEXT NOT NULL DEFAULT 'HANDHELD',
    model             TEXT,
    os_version        TEXT,
    app_version       TEXT,
    serial_number     TEXT,
    mac_address       TEXT,
    provisioned_at    TEXT,
    last_login_at     TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1
);

-- 运行时配置（Server 下发，本地缓存）
CREATE TABLE device_config (
    key               TEXT PRIMARY KEY,
    value             TEXT NOT NULL,                    -- JSON
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    source            TEXT NOT NULL DEFAULT 'server'    -- server, local
);

-- 预置配置键
INSERT INTO device_config (key, value, source) VALUES
('sync_interval_sec', '30', 'server'),
('auto_sync_on_wifi', 'true', 'server'),
('max_offline_days', '7', 'server'),
('max_sync_batch_size', '200', 'server'),
('photo_max_size_mb', '10', 'server'),
('photo_quality', '0.8', 'server'),
('gps_required', 'false', 'server'),
('barcode_scan_sound', 'true', 'local'),
('vibration_feedback', 'true', 'local');

-- 当前用户档案（登录后下发缓存）
CREATE TABLE user_profile (
    id                TEXT PRIMARY KEY DEFAULT 'current',
    user_id           TEXT NOT NULL,
    username          TEXT NOT NULL,
    real_name         TEXT,
    role              TEXT NOT NULL,
    permissions       TEXT,                             -- JSON 数组
    warehouse_id      TEXT,
    warehouse_name    TEXT,
    avatar_url        TEXT,
    updated_at        TEXT NOT NULL
);
```

### 3.13 待上传文件表

```sql
-- 待上传文件记录（异步上传 R2）
CREATE TABLE pending_uploads (
    id                TEXT PRIMARY KEY,                 -- ULID
    tenant_id         TEXT NOT NULL,
    device_id         TEXT NOT NULL,
    category          TEXT NOT NULL,                    -- exception, label, document, avatar, proof
    business_type     TEXT,                             -- work_order, task, inspection, receipt
    business_id       TEXT,                             -- 关联业务 ID
    local_path        TEXT NOT NULL,                    -- 本地加密存储路径
    filename          TEXT NOT NULL,
    content_type      TEXT NOT NULL,
    file_size         INTEGER NOT NULL,
    checksum          TEXT NOT NULL,                    -- SHA256
    
    -- 上传状态
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, UPLOADING, COMPLETED, FAILED
    upload_url        TEXT,                             -- 预签名 URL
    r2_key            TEXT,                             -- R2 对象键
    public_url        TEXT,
    retry_count       INTEGER NOT NULL DEFAULT 0,
    max_retries       INTEGER NOT NULL DEFAULT 3,
    last_error        TEXT,
    
    -- 时间
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_at       TEXT
);

CREATE INDEX idx_pu_status ON pending_uploads(status);
CREATE INDEX idx_pu_business ON pending_uploads(business_type, business_id);
```

---

## 4. 触发器与自动化

### 4.1 本地脏标自动维护

```sql
-- 通用脏标触发器模板：任何业务表 UPDATE 时自动置 _local_dirty=1, _version+1
CREATE TRIGGER trg_auto_dirty_work_orders
AFTER UPDATE ON work_orders
WHEN NEW._local_dirty = 0 AND NEW._version = OLD._version
BEGIN
    UPDATE work_orders SET _local_dirty = 1, _version = _version + 1 WHERE id = NEW.id;
END;

-- 对所有带 _local_dirty/_version 的表创建相同触发器
-- work_orders, tasks, task_steps, containers, inventory, packing_tasks, sorting_tasks, quality_inspections, inbound_receipts
```

### 4.2 写操作自动入同步队列

```sql
-- 示例：work_orders INSERT/UPDATE/DELETE 自动生成 sync_queue 记录
CREATE TRIGGER trg_wo_insert_to_sync
AFTER INSERT ON work_orders
BEGIN
    INSERT INTO sync_queue (
        local_id, entity_type, operation, entity_id, tenant_id, device_id,
        payload, payload_hash, version_vector, occurred_at, priority
    ) VALUES (
        lower(hex(randomblob(16))) || '-' || strftime('%s','now'),
        'work_order', 'CREATE', NEW.id, NEW.tenant_id, (SELECT device_id FROM device_info WHERE id='current'),
        json(NEW.*),  -- 需排除 _local_dirty, _synced_at 等内部字段
        sha256(json(NEW.*)),
        json_object('work_orders', json_object(NEW.id, NEW._version)),
        datetime('now'), 2
    );
END;

CREATE TRIGGER trg_wo_update_to_sync
AFTER UPDATE ON work_orders
WHEN NEW._local_dirty = 1
BEGIN
    INSERT INTO sync_queue (...) VALUES (... 'UPDATE' ...);
END;

CREATE TRIGGER trg_wo_delete_to_sync
BEFORE DELETE ON work_orders
BEGIN
    INSERT INTO sync_queue (...) VALUES (... 'DELETE' ...);
END;
```

### 4.3 同步成功后清理脏标

```sql
-- 同步成功回调（由同步引擎调用）
CREATE PROCEDURE mark_synced(entity_type TEXT, entity_id TEXT, server_version TEXT, server_entity_id TEXT)
BEGIN
    -- 更新业务表
    UPDATE <entity_table> 
    SET _local_dirty = 0, 
        _synced_at = datetime('now'), 
        _server_updated_at = datetime('now'),
        _version = CAST(server_version AS INTEGER)
    WHERE id = entity_id;
    
    -- 更新同步队列
    UPDATE sync_queue 
    SET status = 'COMPLETED', 
        synced_at = datetime('now'),
        server_version = server_version,
        server_entity_id = server_entity_id
    WHERE entity_type = entity_type AND entity_id = entity_id AND status IN ('SYNCING', 'RESOLVED');
END;
```

### 4.4 定期清理策略

```sql
-- 每日清理：保留最近 7 天已同步操作，未同步操作保留 30 天
CREATE TRIGGER trg_daily_cleanup
AFTER INSERT ON sync_sessions
WHEN (SELECT COUNT(*) FROM sync_sessions) % 10 = 0  -- 每 10 次同步触发一次
BEGIN
    -- 清理已同步超过 7 天的队列记录
    DELETE FROM sync_queue 
    WHERE status = 'COMPLETED' 
      AND synced_at < datetime('now', '-7 days');
    
    -- 清理已解决超过 30 天的冲突
    DELETE FROM sync_conflicts 
    WHERE status = 'RESOLVED' 
      AND resolved_at < datetime('now', '-30 days');
    
    -- 清理已上传完成超过 3 天的文件记录
    DELETE FROM pending_uploads 
    WHERE status = 'COMPLETED' 
      AND uploaded_at < datetime('now', '-3 days');
    
    -- 清理已同步超过 30 天的操作日志
    DELETE FROM wo_action_logs 
    WHERE _synced_at IS NOT NULL 
      AND _synced_at < datetime('now', '-30 days');
END;
```

---

## 5. 索引策略总结

| 表 | 关键索引 | 用途 |
|----|----------|------|
| `sync_queue` | `(status, priority, occurred_at)` | 同步引擎按优先级取任务 |
| | `(entity_type, entity_id)` | 去重/幂等查询 |
| | `(chunk_id, chunk_index)` | 分片有序执行 |
| | `(payload_hash)` | 幂等键去重 |
| `sync_conflicts` | `(status)` | 待解决冲突列表 |
| `inventory` | `(product_id, picking_priority DESC, exp_date ASC)` | 拣选分配查询（覆盖主库 idx） |
| | `(picking_priority DESC) WHERE picking_priority=99` | 散货快速查找 |
| | `(_local_dirty) WHERE _local_dirty=1` | 增量同步推送 |
| `work_orders` | `(assignee_id, status)` | 我的工单列表 |
| | `(_local_dirty) WHERE _local_dirty=1` | 增量同步 |
| `wo_action_logs` | `(work_order_id, occurred_at)` | 工单日志流 |
| | `(_local_dirty) WHERE _local_dirty=1` | 批量同步日志 |
| `tasks` | `(assignee_id, status)` | 我的任务列表 |
| | `(due_at) WHERE status IN (...)` | 即将到期任务 |
| `containers` | `(lpn_code)` | LPN 扫码秒查 |
| | `(location_id)` | 库位容器列表 |
| | `(_local_dirty) WHERE _local_dirty=1` | 容器状态同步 |

---

## 6. 存储空间预估与分区策略

### 6.1 单设备存储预估（典型中型仓库）

| 表类别 | 预估行数 | 单行约 | 总大小 | 备注 |
|--------|----------|--------|--------|------|
| 业务数据镜像 | ~100,000 | ~500 B | ~50 MB | products, locations, inventory, tasks... |
| 同步队列 | ~10,000 | ~800 B | ~8 MB | 高峰期可达 50k |
| 操作日志 | ~50,000 | ~600 B | ~30 MB | wo_action_logs 纯追加 |
| 冲突/会话/游标 | ~1,000 | ~1 KB | ~1 MB | |
| 待上传文件元数据 | ~500 | ~500 B | ~0.25 MB | 文件体存文件系统 |
| **合计** | | | **~90 MB** | < 100 MB 目标 |

### 6.2 大表分区策略（SQLite 不支持原生分区，采用物理分表）

```sql
-- wo_action_logs 按月分表：wo_action_logs_2025_07, wo_action_logs_2025_08...
-- 同步引擎写入时按 occurred_at 月份路由到对应表
-- 查询时 UNION ALL 合并（或视图）
CREATE VIEW wo_action_logs_all AS
SELECT * FROM wo_action_logs_2025_07
UNION ALL SELECT * FROM wo_action_logs_2025_08
UNION ALL SELECT * FROM wo_action_logs;  -- 当前月写入表
```

---

## 7. 加密与安全

### 7.1 SQLCipher 配置

```sql
-- 数据库初始化时执行
PRAGMA cipher_page_size = 4096;
PRAGMA kdf_iter = 256000;           -- PBKDF2 迭代次数
PRAGMA cipher_hmac_algorithm = HMAC_SHA512;
PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;

-- 密钥派生：设备绑定 Key + 用户 PIN → 256 位加密密钥
-- Key = HKDF-SHA256(salt=device_id, IKM=device_master_key || user_pin, info="wms7-pda-db", L=32)
```

### 7.2 敏感字段加密存储

| 表 | 字段 | 加密方式 |
|----|------|----------|
| `device_info` | `api_key` | AES-256-GCM (密钥派生自设备硬件指纹) |
| `pending_uploads` | `local_path` | 文件系统级加密 + 路径混淆 |
| `user_profile` | `permissions` | 非敏感，明文存储 |

---

## 8. 迁移与版本管理

```sql
-- 数据库版本表
CREATE TABLE db_version (
    version     INTEGER PRIMARY KEY,       -- 1, 2, 3...
    applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
);

-- 当前版本
INSERT INTO db_version (version, description) VALUES (1, 'Initial PDA offline schema');

-- 迁移示例：v1 → v2 新增字段
-- ALTER TABLE inventory ADD COLUMN zone_type TEXT;
-- UPDATE inventory SET zone_type = (SELECT zone_type FROM locations WHERE id = inventory.location_id);
-- CREATE INDEX idx_inv_zone ON inventory(zone_type);
-- INSERT INTO db_version (version, description) VALUES (2, 'Add zone_type to inventory for zone-aware picking');
```

---

## 9. 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2025-07-11 | 初版：完整表结构、触发器、索引、分区、加密、迁移策略 | 架构组 |

---

*本文档为 PDA 本地 SQLite Schema 单一事实来源。任何 Schema 变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（版本向量定义）、`DEVICE_PROTOCOL_SPEC.md`（同步载荷结构）、`CONFLICT_RESOLUTION_STRATEGY.md`（冲突检测字段）。*