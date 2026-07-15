# PDA 本地 SQLite 数据库 Schema 设计

> **版本**: v2.0.0
> **状态**: 草案待评审
> **加密**: SQLCipher (AES-256)
> **关联文档**: `PDA_OFFLINE_SYNC_DESIGN.md`, `DEVICE_PROTOCOL_SPEC.md`, `CONFLICT_RESOLUTION_STRATEGY.md`, `SYNC_API_CONTRACT.md`（以上文档正与本文档同步重写，采用同一套"操作同步"新设计）

---

## 0. 变更背景

DBA 团队对原"状态同步"方案（`sync_queue` 提议状态队列 + 每行 `_version`/`version_vector` + `sync_conflicts` 持久化冲突 + 客户端 OT/CRDT 合并）进行复审，认为其复杂度与实际业务需求不匹配：PDA 端不需要计算"新状态应该是什么"，也不需要在本地解决合并冲突。新方案改为**操作同步（Operation Sync）**模型，详见第 1 节设计原则与第 3 节表结构。本次改版是一次**结构性简化**，而非增量调整，故版本号自 v1.0.0 跳升至 v2.0.0。

---

## 1. 设计原则

### 1.1 核心简化：本地只需两类表

新方案下，PDA 本地 SQLite 只需维护两大类业务相关表，外加设备/会话/配置类表：

1. **只读缓存表**：联网时拉取的参考数据（分配给本设备的工单、常用商品/库位主数据等）。允许过期，UI 必须显性提示"数据同步于 X 分钟前"。这些表是服务端表的只读镜像——设备只负责展示，不负责计算"新状态"，因此**不需要** `_version`/`_local_dirty` 等脏标字段，也不需要冲突逻辑。
2. **待同步队列 / Outbox**：一个纯追加（append-only）的"发生了什么"日志，替代旧 `sync_queue`。每一行记录的是一个语义化业务指令（如"为某工单行在某库位从某容器拣了数量 X 的某 SKU"），而**不是**"这一行现在应该变成什么值"的完整新状态或增量——这是与旧 `sync_queue.payload`（"完整的新值或增量"）的关键语义差异。

### 1.2 设计原则一览

| 原则 | 实现方式 |
|------|----------|
| **只读缓存可过期** | 缓存表无脏标/版本字段；每表配一个拉取游标，UI 展示"数据同步于 X 分钟前" |
| **Outbox 只追加** | `outbox_actions` 只 INSERT 不 UPDATE 业务字段，仅流转 `status` 生命周期 |
| **幂等由设备端 ID 保证** | `local_id`（ULID）即服务端 `sync_events.id` 主键值，重复上传天然被主键约束去重 |
| **设备序号兜底去重与断点检测** | `device_seq`（本设备单调递增，不依赖设备时钟）配合服务端 `UNIQUE(device_id, device_seq)` 作二级防线，并可检测丢失的序号缺口 |
| **冲突结构性预防，而非事后协商** | 库存类冲突由服务端预分区（`inventory_reservations.work_order_id`）在派工前解决；不可预分区的任务需先在线获取竞争锁（`task_claims` / `fn_claim_task`），成功才允许进入本地操作流程；因此本地**不存在**需要编码的合并冲突场景 |
| **异常统一归口** | 极少数应用时仍失败的边界情况（如预分区后库存仍不足）由服务端记录到统一 `exceptions` 域，PDA 只需轮询/展示"该操作产生了异常 #X"，不实现合并 UI |
| **离线策略前置感知** | 任务开始前查询本地缓存的 `sync_policies`（来自服务端 `fn_get_sync_policy`），判断 `task_type`/`zone_type` 组合是 `ALLOW`/`LIMITED`（含 `max_offline_duration_seconds`）/`ONLINE_ONLY` |
| **存储空间可控** | 无需持久化每行版本向量与冲突记录，存储占用显著低于旧方案 |
| **加密合规** | SQLCipher AES-256，密钥派生自设备绑定 Key + 用户 PIN（不变） |

### 1.3 为什么可以做到这么简单

- **库存类冲突**：服务端在工单派发给设备**之前**，已通过 `inventory_reservations.work_order_id` 完成预分区——PDA 开始动作时，资源已排他性地归属于该工单，不存在两台设备争抢同一份库存的场景。
- **不可预分区的任务**：必须先通过在线的竞争锁 `task_claims`（经 `fn_claim_task` 获取租约）才能开始——锁成功则设备继续，锁失败则直接提示"任务已被领用"，对于 `ONLINE_ONLY` 类型的任务，设备甚至不会为其入队任何 Outbox 动作。由于锁是"先到先得"式的在线判定，本地从结构上就不存在需要编码的冲突场景。
- **真正出问题时**（例如预分区后库存仍不足这类边界情况），服务端把它登记到统一的 `exceptions` 域，而不是要求 PDA 解决合并冲突——PDA 只需展示"该操作产生了异常 #X"，无需实现任何合并 UI。

### 1.4 已移除的旧结构（及移除原因）

| 旧表/字段 | 旧含义 | 移除原因 |
|-----------|--------|----------|
| `sync_queue`（旧含义） | 携带 `version_vector`/`payload_hash`/`business_context`/分片信息的"提议状态"队列 | 由 `outbox_actions` 取代，语义从"提议的新状态"改为"待重放的业务动作" |
| `sync_sessions` | 客户端持久化的同步会话统计记录 | 幂等 Inbox 模型下无需客户端维护会话状态；监控职责由服务端 `sync_events.received_at`/`applied_at` 与服务端侧 `device_sync_state` 承担 |
| `sync_conflicts` | 持久化冲突记录，供人工介入后重试 | **冲突已被结构性预防**（预分区 + `task_claims` 竞争锁 + 统一 `exceptions` 域），不再存在需要客户端记录、展示、人工合并的冲突态 |
| `sync_cursors`（旧含义，绑定版本向量） | 增量拉取游标 + 版本号 | 保留"拉取游标"这一必要能力，但简化为纯 `updated_at`/主键游标，改名 `sync_cursors_local`，不再携带版本向量语义 |
| 各业务镜像表的 `_version`/`_synced_at`/`_server_updated_at`/`_local_dirty` 列及自动触发器 | 每行版本向量 + 本地脏标 + 自动入队触发器 | 只读缓存表不产生本地写操作，无需脏标/版本追踪；写操作统一走 `outbox_actions`，无需逐表触发器 |

---

## 2. 表结构总览

| 分类 | 表名 | 说明 | 预估行数 | 同步方向 |
|------|------|------|----------|----------|
| **只读缓存** | `cached_work_orders` | 分配给本设备的工单缓存 | 5,000 | Server → PDA |
| | `cached_products` | 商品主数据缓存 | 10,000 | Server → PDA |
| | `cached_locations` | 库位主数据缓存 | 5,000 | Server → PDA |
| | `cached_containers` | 容器/LPN 缓存 | 20,000 | Server → PDA |
| | `cached_inventory_snapshot` | 库存粗粒度快照（非权威，仅供展示） | 50,000 | Server → PDA |
| | `sync_policies_cache` | 离线策略缓存（`fn_get_sync_policy`） | 200 | Server → PDA |
| | `local_active_claims` | 当前设备持有的任务租约缓存（`task_claims`） | 50 | Server → PDA |
| | `sync_cursors_local` | 各缓存表的增量拉取游标（纯书签，非冲突结构） | 10 | 本地 |
| **待同步队列 / Outbox** | `outbox_actions` | 待同步动作日志（追加写，替代旧 `sync_queue`） | 20,000 | PDA → Server |
| | `outbox_seq_counter` | `device_seq` 单调序号生成器 | 1 | 本地 |
| **设备/配置** | `device_info` | 设备注册信息 | 1 | 本地 |
| | `device_config` | 运行时配置 | 1 | Server → PDA |
| | `user_profile` | 当前用户档案 | 1 | Server → PDA |
| **媒体/附件** | `pending_uploads` | 待上传文件记录 | 500 | PDA → Server |

---

## 3. 核心表定义 (DDL)

### 3.1 只读缓存表

只读缓存表不含 `_version`/`_local_dirty` 等字段，也没有自动触发器；它们只在"拉取"时被整行覆盖或按 `updated_at` 增量追加/更新。每表额外携带一个 `cached_at`（本地写入时间），供 UI 计算"数据同步于 X 分钟前"。

#### 3.1.1 工单缓存

```sql
-- 分配给本设备的工单缓存（只读，Server → PDA）
CREATE TABLE cached_work_orders (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    wo_no             TEXT NOT NULL,

    wo_type           TEXT NOT NULL,              -- PICKING, PUTAWAY, REPLENISHMENT, COUNTING, PACKING, SORTING, LOADING, VAS
    status            TEXT NOT NULL,              -- OPEN, ASSIGNED, IN_PROGRESS, COMPLETED, EXCEPTION, CANCELLED
    priority          INTEGER NOT NULL DEFAULT 10,

    wave_id           TEXT,
    parent_wo_id      TEXT,
    source_document_id TEXT,

    assignee_id       TEXT,
    assignee_name     TEXT,
    device_id         TEXT,

    total_qty         REAL NOT NULL DEFAULT 0,
    completed_qty     REAL NOT NULL DEFAULT 0,
    exception_qty     REAL NOT NULL DEFAULT 0,

    planned_start_at  TEXT,
    planned_end_at    TEXT,
    started_at        TEXT,
    completed_at      TEXT,

    -- 缓存元数据（不是版本向量，只是"这份镜像是什么时候来的"）
    server_updated_at TEXT NOT NULL,              -- 服务端 work_orders.updated_at，用作增量拉取比较基准
    cached_at         TEXT NOT NULL DEFAULT (datetime('now')),  -- 本地写入时间，UI 用于计算"同步于 X 分钟前"

    UNIQUE(tenant_id, wo_no)
);

CREATE INDEX idx_cwo_assignee_status ON cached_work_orders(assignee_id, status);
CREATE INDEX idx_cwo_device ON cached_work_orders(device_id);
CREATE INDEX idx_cwo_wave ON cached_work_orders(wave_id);
```

#### 3.1.2 商品主数据缓存

```sql
-- 商品主数据缓存（只读镜像，Server → PDA）
CREATE TABLE cached_products (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    sku               TEXT NOT NULL,
    name              TEXT NOT NULL,
    category_id       TEXT,
    unit              TEXT NOT NULL DEFAULT 'PCS',

    specs             TEXT,                       -- JSON: {color, size, model...}

    unit_weight_g     INTEGER,
    unit_volume_cm3   INTEGER,
    dimensions_mm     TEXT,                       -- JSON: {length, width, height}

    barcodes          TEXT,                       -- JSON 数组 ["690123...", "690123..."]

    is_serial_required INTEGER NOT NULL DEFAULT 0,
    is_fragile        INTEGER NOT NULL DEFAULT 0,
    is_hazardous      INTEGER NOT NULL DEFAULT 0,
    temperature_range TEXT,
    shelf_life_days   INTEGER,

    abc_class         TEXT NOT NULL DEFAULT 'C',

    server_updated_at TEXT NOT NULL,
    cached_at         TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(tenant_id, sku)
);

CREATE INDEX idx_cprod_sku ON cached_products(sku);
CREATE INDEX idx_cprod_barcodes ON cached_products(barcodes);
CREATE INDEX idx_cprod_abc ON cached_products(abc_class);
```

#### 3.1.3 库位主数据缓存

```sql
-- 库位主数据缓存（只读镜像）
CREATE TABLE cached_locations (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    code              TEXT NOT NULL,
    name              TEXT,

    zone_type         TEXT NOT NULL,              -- PICK, BULK, RECV, SHIP, CROSS_DOCK, FROZEN, QUARANTINE
    zone_name         TEXT,
    abc_zone          TEXT,

    max_capacity_qty  REAL,
    max_weight_kg     REAL,
    max_volume_m3     REAL,

    status            TEXT NOT NULL DEFAULT 'ACTIVE',
    is_frozen         INTEGER NOT NULL DEFAULT 0,

    path_sequence     INTEGER,
    coordinates       TEXT,                       -- JSON: {x, y, z, aisle, rack, level, bin}

    server_updated_at TEXT NOT NULL,
    cached_at         TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(tenant_id, code)
);

CREATE INDEX idx_cloc_code ON cached_locations(code);
CREATE INDEX idx_cloc_zone ON cached_locations(zone_type, status);
CREATE INDEX idx_cloc_path ON cached_locations(path_sequence);
```

#### 3.1.4 容器/LPN 缓存

```sql
-- 容器/托盘/LPN 缓存（只读镜像；容器状态的真正变更走 outbox_actions 上报，本表只展示服务端已确认的状态）
CREATE TABLE cached_containers (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    lpn_code          TEXT NOT NULL,

    parent_container_id TEXT,
    container_type    TEXT NOT NULL,              -- PALLET, BOX, TOTE, CARTON, RACK

    location_id       TEXT,
    location_code     TEXT,

    status            TEXT NOT NULL DEFAULT 'IDLE',  -- IDLE, IN_USE, STAGED, SEALED, RETIRED
    seal_no           TEXT,
    sealed_at         TEXT,

    weight_kg         REAL,
    volume_m3         REAL,
    dimensions_cm     TEXT,

    server_updated_at TEXT NOT NULL,
    cached_at         TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(tenant_id, lpn_code)
);

CREATE INDEX idx_ccnt_lpn ON cached_containers(lpn_code);
CREATE INDEX idx_ccnt_location ON cached_containers(location_id);
CREATE INDEX idx_ccnt_parent ON cached_containers(parent_container_id);
```

#### 3.1.5 库存快照缓存（非权威）

```sql
-- 库存粗粒度快照（只读镜像，供拣选路径规划/UI 展示参考）
-- ⚠️ 非权威数据：真正的库存数量以服务端为准。任何扣减/占用均在服务端
-- fn_apply_pick_action 等函数内以行锁 + 预分区（inventory_reservations）方式完成，
-- 本表可能滞后于服务端真实状态，严禁作为库存是否充足的最终判断依据。
CREATE TABLE cached_inventory_snapshot (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    location_id       TEXT,
    container_id      TEXT,

    quantity          REAL NOT NULL DEFAULT 0,    -- 展示用数量，可能滞后
    picking_priority  INTEGER NOT NULL DEFAULT 10,
    batch_no          TEXT,
    mfg_date          TEXT,
    exp_date          TEXT,

    server_updated_at TEXT NOT NULL,
    cached_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cinv_sku_priority ON cached_inventory_snapshot(product_id, picking_priority DESC, exp_date ASC);
CREATE INDEX idx_cinv_location ON cached_inventory_snapshot(location_id);
CREATE INDEX idx_cinv_container ON cached_inventory_snapshot(container_id);
```

#### 3.1.6 离线策略缓存

```sql
-- 离线策略缓存（来自服务端 fn_get_sync_policy，联网时定期刷新）
-- PDA 在开始一项任务前，先按 (task_type, zone_type) 查本表判断离线许可级别
CREATE TABLE sync_policies_cache (
    task_type         TEXT NOT NULL,
    zone_type         TEXT NOT NULL,
    offline_mode      TEXT NOT NULL,              -- ALLOW, LIMITED, ONLINE_ONLY
    max_offline_duration_seconds INTEGER,          -- 仅 LIMITED 时有效
    server_updated_at TEXT NOT NULL,
    cached_at         TEXT NOT NULL DEFAULT (datetime('now')),

    PRIMARY KEY (task_type, zone_type)
);
```

#### 3.1.7 任务租约缓存

```sql
-- 当前设备持有的任务竞争锁缓存（来自服务端 task_claims，经 fn_claim_task 获取）
-- 仅用于本地快速判断"我是否仍持有该任务的有效租约"，避免每次操作都联网确认；
-- 租约本身的获取/续期/释放均为在线操作，本表只是只读镜像，不参与任何冲突判定。
CREATE TABLE local_active_claims (
    claim_id          TEXT PRIMARY KEY,           -- 服务端 task_claims.id
    tenant_id         TEXT NOT NULL,
    task_id           TEXT NOT NULL,
    device_id         TEXT NOT NULL,
    task_type         TEXT NOT NULL,
    zone_type         TEXT,

    status            TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, RELEASED, EXPIRED
    granted_at        TEXT NOT NULL,
    expires_at        TEXT NOT NULL,

    cached_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_lac_task ON local_active_claims(task_id);
CREATE INDEX idx_lac_status_expires ON local_active_claims(status, expires_at);
```

#### 3.1.8 拉取游标（本地书签，非冲突结构）

```sql
-- 增量拉取游标：每个只读缓存表记录最后拉取到的位置
-- 注意：这只是"我拉到哪了"的书签，不再携带版本向量，不用于冲突判定
CREATE TABLE sync_cursors_local (
    table_name        TEXT PRIMARY KEY,           -- 对应 cached_* 表名

    last_synced_at    TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',  -- 服务端 updated_at 游标
    last_synced_pk    TEXT,                       -- 同 updated_at 下按主键排序的断点

    last_pull_count   INTEGER NOT NULL DEFAULT 0,
    last_pull_at      TEXT,
    error_count       INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,

    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.2 待同步队列 / Outbox

#### 3.2.1 outbox_actions

```sql
-- Outbox：设备端动作的纯追加日志。
-- 与旧 sync_queue 的关键区别：这里存的是"发生了什么"（语义化业务指令），
-- 不是"这一行现在应该变成什么值"的完整新状态或增量。
-- 是否沿用 sync_queue 这个名字皆可，但语义必须是"待重放的动作"而非"提议的状态"。
CREATE TABLE outbox_actions (
    -- 幂等主键：ULID，设备生成，即服务端 sync_events.id 的取值本身
    -- （不是服务端 DEFAULT 生成的自增/gen_random_uuid()），
    -- 因此重复上传天然被服务端主键约束去重，无需额外幂等表
    local_id          TEXT PRIMARY KEY,

    tenant_id         TEXT NOT NULL,
    device_id         TEXT NOT NULL,

    -- 本设备自身的单调递增序号，不依赖设备时钟；
    -- 服务端以 UNIQUE(device_id, device_seq) 作为二级去重防线，
    -- 也可用于检测中间是否有序号缺口（可能意味着记录丢失）
    device_seq        INTEGER NOT NULL,

    -- 动作类型：对应服务端 sync_events.action_type
    -- 目前仅 PICK 有完整服务端处理（fn_apply_pick_action），其余类型待扩展
    action_type       TEXT NOT NULL,

    -- 关联标识，便于本地按工单/任务查询自己的操作历史（非幂等键，仅索引用）
    work_order_id     TEXT,
    task_id           TEXT,

    -- 结构化业务指令（JSON），例如 PICK：
    -- {"order_line_id": "...", "sku": "...", "location_id": "...",
    --  "container_id": "...", "qty": 5, "batch_no": "..."}
    -- 注意：这是"发生的业务事实"，不是"该行新的完整状态"
    payload           TEXT NOT NULL,

    -- 设备本地捕获时间：仅用于审计展示，不作为排序或冲突判定依据
    captured_at       TEXT NOT NULL,

    -- 生命周期：无 CONFLICT 态——冲突已被结构性预防，不存在需要协商的中间态
    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, SYNCING, SYNCED, FAILED
    retry_count       INTEGER NOT NULL DEFAULT 0,
    max_retries       INTEGER NOT NULL DEFAULT 5,
    last_attempt_at   TEXT,
    last_error        TEXT,
    synced_at         TEXT,

    -- 若服务端应用时命中边界情况（如预分区后库存仍不足），
    -- 记录关联的统一异常 ID，供 PDA 展示"该操作产生了异常 #X"
    server_exception_id TEXT,

    created_at        TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(device_id, device_seq)
);

CREATE INDEX idx_outbox_status_seq ON outbox_actions(status, device_seq);
CREATE INDEX idx_outbox_wo ON outbox_actions(work_order_id);
CREATE INDEX idx_outbox_task ON outbox_actions(task_id);
CREATE INDEX idx_outbox_action_type ON outbox_actions(action_type, status);
```

#### 3.2.2 device_seq 生成器

```sql
-- 单行计数器表：为 outbox_actions.device_seq 提供单调递增序号
-- 不依赖设备系统时钟，重启/时钟回拨均不影响单调性
CREATE TABLE outbox_seq_counter (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    next_seq          INTEGER NOT NULL DEFAULT 1
);

INSERT INTO outbox_seq_counter (id, next_seq) VALUES (1, 1);
```

### 3.3 设备/配置/用户表

设备、会话、配置类表基本延续旧设计结构，仅移除任何 `_version`/冲突相关字段与引用（原设计中这几张表本就不含此类字段）。

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
('max_outbox_batch_size', '200', 'server'),
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

### 3.4 待上传文件表

```sql
-- 待上传文件记录（异步上传 R2；与 outbox_actions 相互独立的媒体队列）
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

    status            TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, UPLOADING, COMPLETED, FAILED
    upload_url        TEXT,                             -- 预签名 URL
    r2_key            TEXT,                             -- R2 对象键
    public_url        TEXT,
    retry_count       INTEGER NOT NULL DEFAULT 0,
    max_retries       INTEGER NOT NULL DEFAULT 3,
    last_error        TEXT,

    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_at       TEXT
);

CREATE INDEX idx_pu_status ON pending_uploads(status);
CREATE INDEX idx_pu_business ON pending_uploads(business_type, business_id);
```

---

## 4. 触发器与自动化

只读缓存表没有脏标/版本触发器——它们只在拉取时被应用层整行 UPSERT。本节仅保留两类真正需要的自动化：`device_seq` 分配、以及队列/上传记录的定期清理。

### 4.1 device_seq 自动分配

```sql
-- INSERT outbox_actions 时若未显式指定 device_seq，则自动取号并递增计数器
CREATE TRIGGER trg_outbox_assign_seq
AFTER INSERT ON outbox_actions
WHEN NEW.device_seq IS NULL
BEGIN
    UPDATE outbox_actions
    SET device_seq = (SELECT next_seq FROM outbox_seq_counter WHERE id = 1)
    WHERE local_id = NEW.local_id;

    UPDATE outbox_seq_counter SET next_seq = next_seq + 1 WHERE id = 1;
END;
```

### 4.2 缓存拉取由应用层维护，非触发器

`cached_*` 表与 `sync_cursors_local` 的写入由同步引擎在拉取完成后以事务方式整批 UPSERT 并更新游标，不依赖数据库触发器（避免在只读镜像上引入隐藏的写放大逻辑）。这里刻意不做成触发器驱动，是与旧设计的另一处差异——旧设计里 `_local_dirty`/`_version` 自动触发器分散在每张镜像表上，新设计里镜像表干净，写入路径唯一且显式。

### 4.3 定期清理策略

```sql
-- 建议每次成功同步会话结束后触发一次（由应用层在同步引擎回调中调用，
-- 而不是绑定在某张表的 INSERT 上，因为本地已不存在 sync_sessions 表）

-- 清理已同步超过 7 天的 outbox 记录
DELETE FROM outbox_actions
WHERE status = 'SYNCED'
  AND synced_at < datetime('now', '-7 days');

-- 失败次数超过 max_retries 且超过 30 天的记录，转人工排查后清理
DELETE FROM outbox_actions
WHERE status = 'FAILED'
  AND retry_count >= max_retries
  AND created_at < datetime('now', '-30 days');

-- 清理已上传完成超过 3 天的文件记录
DELETE FROM pending_uploads
WHERE status = 'COMPLETED'
  AND uploaded_at < datetime('now', '-3 days');

-- 过期租约缓存清理（真正的租约生命周期以服务端 task_claims 为准，本地只是镜像）
DELETE FROM local_active_claims
WHERE status != 'ACTIVE'
   OR expires_at < datetime('now');
```

---

## 5. 索引策略总结

| 表 | 关键索引 | 用途 |
|----|----------|------|
| `outbox_actions` | `(status, device_seq)` | 同步引擎按设备内因果顺序取待上传动作 |
| | `(device_id, device_seq)` UNIQUE | 幂等二级防线 + 缺口检测 |
| | `(work_order_id)` / `(task_id)` | 本地查询"这个工单/任务我做过哪些操作" |
| `cached_inventory_snapshot` | `(product_id, picking_priority DESC, exp_date ASC)` | 拣选路径规划展示（非权威，仅参考） |
| `cached_work_orders` | `(assignee_id, status)` | 我的工单列表 |
| | `(device_id)` | 本设备工单过滤 |
| `cached_containers` | `(lpn_code)` | LPN 扫码秒查 |
| | `(location_id)` | 库位容器列表 |
| `local_active_claims` | `(status, expires_at)` | 快速判断当前有效租约、清理过期项 |
| `sync_policies_cache` | `(task_type, zone_type)` PK | 任务开始前的离线策略判定 |

---

## 6. 存储空间预估与分区策略

### 6.1 单设备存储预估（典型中型仓库）

新方案下无需持久化版本向量、冲突记录、同步会话，存储占用显著低于旧方案。

| 表类别 | 预估行数 | 单行约 | 总大小 | 备注 |
|--------|----------|--------|--------|------|
| 只读缓存 | ~90,000 | ~400 B | ~35 MB | cached_products/locations/containers/inventory_snapshot/work_orders |
| Outbox | ~20,000 | ~500 B | ~10 MB | 高峰期可达 50k，定期清理 SYNCED 记录 |
| 策略/租约/游标 | ~300 | ~500 B | <1 MB | sync_policies_cache, local_active_claims, sync_cursors_local |
| 待上传文件元数据 | ~500 | ~500 B | ~0.25 MB | 文件体存文件系统 |
| **合计** | | | **~46 MB** | 远低于旧方案的 ~90 MB，< 100 MB 目标 |

### 6.2 大表处理策略

`outbox_actions` 定期清理 `SYNCED` 记录（见 4.3），不再需要像旧 `wo_action_logs` 那样按月物理分表——因为 Outbox 本身只承载"待同步"的短生命周期数据，同步成功后即应清理，不作为长期操作历史存储（长期历史查询应查服务端 `sync_events`）。

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
INSERT INTO db_version (version, description) VALUES (2, 'Operation-sync schema: cached_* 只读镜像 + outbox_actions，废弃 sync_queue/sync_conflicts/sync_sessions 状态同步模型');

-- 迁移示例：v2 → v3 新增字段
-- ALTER TABLE cached_locations ADD COLUMN putaway_strategy TEXT;
-- INSERT INTO db_version (version, description) VALUES (3, 'Add putaway_strategy to cached_locations');
```

> 从 v1（状态同步模型）升级到 v2（操作同步模型）的设备，视为**全新安装**处理：卸载旧库中的 `sync_queue`/`sync_sessions`/`sync_conflicts`/`sync_cursors` 及各业务镜像表的 `_version`/`_local_dirty` 等列，重新按本文档全量建表，并触发一次全量只读缓存拉取。不提供就地 ALTER 迁移路径，因为新旧模型的表结构与语义均不兼容。

---

## 9. 版本记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.0.0 | 2025-07-11 | 初版：完整表结构、触发器、索引、分区、加密、迁移策略（状态同步模型） | 架构组 |
| 2.0.0 | 2026-07-15 | DBA 团队复审后重新设计：废弃"状态同步"模型（`sync_queue` 提议状态队列/`version_vector`/`sync_conflicts`/`sync_sessions`/逐表 `_version`+`_local_dirty` 触发器），改为"操作同步"模型——本地仅保留只读缓存表（`cached_*`）与追加式 Outbox（`outbox_actions`），冲突通过服务端预分区（`inventory_reservations`）与竞争锁（`task_claims`/`fn_claim_task`）结构性预防，异常统一归口服务端 `exceptions` 域，离线策略经 `sync_policies_cache`（`fn_get_sync_policy`）前置感知 | DBA 团队 |

---

*本文档为 PDA 本地 SQLite Schema 单一事实来源。任何 Schema 变更需同步更新：`PDA_OFFLINE_SYNC_DESIGN.md`（操作同步整体架构、预分区与竞争锁流程）、`DEVICE_PROTOCOL_SPEC.md`（Outbox 上传载荷结构）、`CONFLICT_RESOLUTION_STRATEGY.md`（结构性冲突预防策略，取代原"冲突解决"策略）、`SYNC_API_CONTRACT.md`（`sync_events`/`task_claims`/`sync_policies`/`exceptions` 相关接口契约）。*
