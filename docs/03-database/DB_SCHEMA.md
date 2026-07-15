# DB_SCHEMA.md

> **版本**: v2.3.0 (2026-07-16)  
> **同步来源**: `supabase/migrations/` 下的初始化脚本（V2.1 主脚本 + 离线同步/统一异常领域增量扩展 + Layer 3/4 设计）。**注意**：`supabase/` 目录已按项目决定加入 `.gitignore`（不再纳入版本管理），因此本文档而非某个具体 SQL 文件才是表结构的版本化事实来源；SQL 迁移脚本的实际落地由部署流程另行维护。  
> **状态**: ✅ V2.1 主体生产就绪；🚧 Layer 2（离线同步/统一异常领域，7 张表）为**设计已确定、待迁移脚本落地**；🚧 Layer 3（同步动作扩展 PUTAWAY/COUNT/PACK，2 张表）与 Layer 4（唯一追踪策略+无码/未识别货物，1 张表+3 新列）为**本轮新增设计文档、本地零实现**——**这三层的迁移脚本改动均需先与 DBA 团队协调确认，未确认前不得起草/执行/推送**（工程排期见 `docs/00-project/ROADMAP.md` Phase 1.4/1.4.1/1.4.2、`docs/03-database/REPOSITORY_ROADMAP.md` Phase 5-7）

---

## 0. 本次变更说明

### v2.2.0（2026-07-15）
DBA 团队评审了旧版 PDA 离线同步设计后，交付了新的离线同步 + 竞争性任务锁 + 统一异常领域扩展方案（详见 `docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md`）。本次更新把该方案涉及的 **7 张新表**、**9 个新函数**补充进本文档：

- 新表：`task_claims`、`sync_policies`、`device_sync_state`、`sync_events`、`exception_type_catalog`、`exceptions`、`exception_events`
- `inventory_reservations` 增加 `work_order_id` 列（库存预占精确到工单）
- `order_lines.status` CHECK 约束增加 `EXCEPTION` 取值
- 新函数：`fn_claim_task`、`fn_release_task_claim`、`fn_expire_task_claims`、`fn_get_sync_policy`、`fn_apply_sync_event`、`fn_apply_pick_action`、`fn_confirm_inventory_recount`、`fn_raise_exception`、`fn_resolve_exception`

### v2.3.0（2026-07-16）
DBA 团队对开发团队提交的同步动作扩展 PR（本地文件 `supabase/migrations/003_extend_sync_event_actions.sql`，含真实语法错误/并发丢单 bug/表结构引用错误，详见 `docs/02-api/SYNC_ACTIONS_EXTENSION.md` §1）做了评审修正，并交付了一份全新的第 4 层设计（唯一追踪策略 + 无码/未识别货物处理）。本次补充：

- **Layer 3 新表**：`inventory_count_policies`、`packing_task_items`
- **Layer 3 新函数**：`fn_adjust_inventory_at_location`、`fn_reconcile_location_count`、`fn_get_count_tolerance`、`fn_apply_putaway_action`（修正版）、`fn_apply_count_action`（修正版）、`fn_apply_pack_action`（修正版）；`adjust_inventory` 内部实现改为原子操作（签名不变）
- **Layer 3 新异常类型**：`REFERENCE_NOT_FOUND`
- **Layer 4 新表**：`tenant_tracking_policies`
- **Layer 4 新列**：`containers.lpn_source`、`locations.force_unique_tracking`、`product_constraints.requires_unique_tracking`
- **Layer 4 新函数**：`fn_get_tenant_abc_tracking_default`、`fn_requires_unique_tracking`、`fn_generate_internal_lpn`、`fn_confirm_label_applied`、`fn_receive_unidentified_goods`、`fn_identify_unidentified_goods`
- **Layer 4 新异常类型**：`MISSING_LABEL`、`UNIDENTIFIED_GOODS`
- **Layer 4 触发器变更**：`fn_trg_enforce_product_constraints` 挂载范围从 `BEFORE UPDATE OF location_id` 扩展为 `BEFORE INSERT OR UPDATE OF location_id, product_id`

> ⛔ **本次是设计文档补充，不代表迁移脚本已修正/新增**。本地 `supabase/migrations/003_extend_sync_event_actions.sql` 现状仍是含 bug 的原始版本；`004_tracking_policy_missing_label.sql` 尚不存在。这两个文件的起草/执行需要用户先与 DBA 团队完成协调确认。部署顺序硬约束：Layer 4 必须严格在 Layer 3 之后部署（Layer 4 会 `CREATE OR REPLACE` 覆盖 Layer 3 的 `fn_apply_putaway_action`）。

设计原则与业务背景见 `PDA_OFFLINE_SYNC_DESIGN.md` §1、`SYNC_ACTIONS_EXTENSION.md`、`TRACKING_POLICY_MISSING_LABEL.md`；本文档只记录表结构事实，不重复设计动机。

---

## 1. 表结构总览（48 张业务表：38 张 V2.1 核心表 + 7 张 Layer 2 离线同步/异常领域表 + 2 张 Layer 3 同步动作扩展表 + 1 张 Layer 4 追踪策略表）

| 分类 | 表名 | 说明 | RLS | updated_at | CHECK约束 |
|------|------|------|-----|------------|-----------|
| **租户/权限** | `tenants` | 租户主表，含 JSONB 阶梯计费策略 | ✅ (id) | ✅ | - |
| | `permissions` | 权限字典 | - | ✅ | - |
| | `roles` | 租户级角色 | ✅ | ✅ | - |
| | `role_permissions` | 角色-权限关联 | - | ✅ | - |
| | `users` | 用户表，含角色、系统用户标识 | ✅ | ✅ | - |
| | `user_roles` | 用户-角色关联（支持 scope） | - | ✅ | - |
| | `devices` | PDA/电子秤/传送带/GPS 等设备 | ✅ | ✅ | - |
| **商品/库位/容器** | `products` | 商品主数据（SKU、ABC 分类） | ✅ | ✅ | - |
| | `product_constraints` | 存储约束（危险品、冷链、温度、互斥标签、序列号强扫） | - | ✅ | - |
| | `locations` | 库位（分区类型、ABC 分区、容量、路径序列、冷冻标识） | ✅ | ✅ | - |
| | `containers` | 容器/托盘（LPN、嵌套、位置、密封状态） | - | ✅ | ✅ |
| **订单/波次** | `waves` | 波次（策略类型、状态） | ✅ | ✅ | ✅ |
| | `orders` | 订单（外部单号、截单时间、平台优先级） | ✅ | ✅ | ✅ |
| | `order_lines` | 订单行（SKU 级状态：PENDING→ALLOCATED→PICKED→PACKED→SHIPPED，**新增 EXCEPTION** 用于库存异常闭环） | - | ✅ | ✅ |
| | `wave_order_mapping` | 波次-订单关联 | - | - | - |
| **库存** | `inventory` | 库存（乐观锁 version、拣货优先级、批次/效期） | ✅ | ✅ | - |
| | `inventory_history` | 库存变动审计（INBOUND/OUTBOUND/ADJUSTMENT） | - | - | - |
| | `inventory_reservations` | 库存预留（ACTIVE/RELEASED/EXPIRED/CONSUMED，**新增 `work_order_id` 精确到工单的预分工**） | - | ✅ | ✅ |
| | `inventory_locks` | 库存冻结（按类型/目标/过期时间） | - | ✅ | - |
| **工单** | `work_orders` | 作业工单（拣货/上架/盘点/补货、父子工单、PPH 统计） | ✅ | ✅ | ✅ |
| | `wo_action_logs` | 原子动作日志（扫码、拣货、打包、上架、盘点） | - | - | - |
| **VAS/计费/条码** | `vas_boms` | 增值服务 BOM（贴标/组套/拆套） | - | ✅ | - |
| | `vas_bom_items` | BOM 明细 | - | ✅ | - |
| | `billing_rules` | 计费规则规范化表（版本化、生效日期、默认规则） | ✅ | ✅ | - |
| | `billing_rule_tiers` | 计费阶梯（最小/最大天数、费率、最小/最大收费） | - | ✅ | ✅ |
| | `billing_transactions` | 计费流水（STORAGE/LABOR/CONSUMABLE/VAS） | ✅ | ✅ | ✅ |
| | `barcode_mappings` | 条码映射（多目标类型、子类型） | ✅ | ✅ | - |
| **入库** | `inbound_receipts` | 入库单据（供直通匹配） | ✅ | ✅ | ✅ |
| **履约链路-分拣** | `sorting_chutes` | 滑道（按 ORDER/SKU/ZONE/CARRIER 分配、容量管理） | ✅ | ✅ | ✅ |
| | `sorting_tasks` | 分拣任务（优先级、序列号、异常处理） | ✅ | ✅ | ✅ |
| | `sorting_waves` | 分拣波次（策略配置、进度聚合） | ✅ | ✅ | ✅ |
| **履约链路-验货** | `verification_rules` | 验货规则（重量/尺寸公差、拍照角度、自动通过阈值、**版本化 effective_from/to**） | ✅ | ✅ | ✅ |
| | `quality_inspections` | 质检任务（结果：PASS/REJECT/QUARANTINE/REWORK） | ✅ | ✅ | ✅ |
| | `inspection_items` | 质检明细项（WEIGHT/DIMENSION/BARCODE/APPEARANCE/SERIAL/CUSTOM） | - | ✅ | - |
| **履约链路-打包** | `package_specs` | 包装规格（箱型、尺寸、缓冲材、封箱方式、面单位置） | ✅ | ✅ | - |
| | `label_templates` | 面单模板（多承运商 SF/YTO/ZTO/STO/YUNDA/JD/EMS、ZPL/PDF/EPL/IMAGE） | ✅ | ✅ | - |
| | `packing_tasks` | 打包任务（箱数、重量体积、承运商、面单号） | ✅ | ✅ | ✅ |
| | `consumable_usages` | 耗材用量成本核算 | ✅ | ✅ | - |
| **履约链路-装车** | `vehicles` | 车辆（类型、载重/载积、分仓、GPS、司机） | ✅ | ✅ | ✅ |
| | `loading_tasks` | 装车任务（计划/实载重体积、铅封、分仓顺序） | ✅ | ✅ | ✅ |
| | `shipping_documents` | 运输单据（POD/BOL/MANIFEST/CUSTOMS/INSURANCE/DELIVERY_NOTE） | ✅ | ✅ | - |
| **履约链路-直通** | `cross_dock_jobs` | 越库作业（入库单+出库单匹配、暂存区、超时降级 FALLBACK） | ✅ | ✅ | ✅ |
| **离线同步-预分工/锁** | `task_claims` | 竞争性在线任务租约（ACTIVE/RELEASED/EXPIRED，局部唯一索引保证同工单同时只有一条 ACTIVE） | ✅ | ✅ | ✅ |
| | `sync_policies` | 离线策略配置（ALLOW/LIMITED/ONLINE_ONLY，按 tenant+task_type+zone_type 三维匹配） | ✅ | ✅ | ✅ |
| | `device_sync_state` | 设备同步状态（last_pull/push_at、last_applied_seq、last_seen_online_at） | ✅ | ✅ | - |
| **离线同步-事件收件箱** | `sync_events` | PDA 离线动作收件箱（PENDING→APPLIED/EXCEPTION/REJECTED，主键即幂等键，UNIQUE(device_id, device_seq) 检测丢包） | ✅ | - | ✅ |
| **Layer 3-库存策略** | `inventory_count_policies` | 盘点容差配置（按租户默认+按 SKU 覆盖，未配置默认零容差） | ✅ | ✅ | - |
| **Layer 3-打包明细** | `packing_task_items` | 打包明细行（订单行/数量/箱号，`container_id` 可空，双局部唯一索引去重） | ✅ | ✅ | - |
| **Layer 4-追踪策略** | `tenant_tracking_policies` | 租户按 ABC 分类的唯一追踪策略默认值（A/C 有系统默认，B 无默认需显式配置） | ✅ | ✅ | ✅ |
| **统一异常领域** | `exception_type_catalog` | 异常类型元数据字典（domain、默认严重度、处理所需权限，支持全局默认+租户覆盖） | ✅ (特殊策略，见 §8) | ✅ | ✅ |
| | `exceptions` | 统一异常台账（PENDING_REVIEW→CONFLICT→RESOLVED/DISMISSED，跨领域统一查看/权限/审计入口） | ✅ | ✅ | ✅ |
| | `exception_events` | 异常处理审计轨迹（纯追加型，RAISED/ASSIGNED/COMMENT/STATUS_CHANGE/RESOLVED/DISMISSED/REOPENED） | ✅ | - | - |

> **故意不加 updated_at 的表**（设计决策）：`inventory_history`、`wo_action_logs`（纯追加审计日志）、`wave_order_mapping`、`role_permissions`、`user_roles`、`permissions`、`inspection_items`、`vas_boms`、`vas_bom_items`、`shipping_documents`（仅 INSERT/DELETE，无 UPDATE 语义）、`sync_events`、`exception_events`（同属纯追加型事件流水，与 `wo_action_logs`/`inventory_history` 同一设计约定）

> **Layer 4 在既有表上新增的列**（不是新表，是既有表的列扩展）：
> - `containers.lpn_source` VARCHAR(20) NOT NULL DEFAULT 'EXTERNAL'，CHECK IN ('EXTERNAL','SYSTEM_GENERATED')——区分供应商自带码 vs 系统内部生成码
> - `locations.force_unique_tracking` BOOLEAN NOT NULL DEFAULT FALSE——库位级强制唯一追踪标记，只能调严不能调松
> - `product_constraints.requires_unique_tracking` BOOLEAN（可空）——商品级追踪覆盖，NULL 表示跟随租户 ABC 默认值

---

## 2. 核心表结构详情

### 2.1 tenants (租户)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK, DEFAULT uuid_generate_v4() | |
| name | varchar(100) | NOT NULL | 租户名称 |
| contact_info | jsonb | | 联系信息 |
| billing_strategy | jsonb | DEFAULT 阶梯费率 | **兼容旧版 JSONB 计费**，含 escalation、volume discount |
| is_active | boolean | DEFAULT TRUE | |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP | 触发器自动维护 |

### 2.2 permissions (权限字典)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK, DEFAULT uuid_generate_v4() | |
| resource | varchar(100) | NOT NULL | 资源标识（如 orders, inventory） |
| action | varchar(50) | NOT NULL | 动作（READ, WRITE, DELETE, APPROVE 等） |
| description | text | | |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| UNIQUE(resource, action) | | | |

### 2.3 roles (角色)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK, DEFAULT uuid_generate_v4() | |
| tenant_id | uuid | FK→tenants(id) CASCADE, NOT NULL | 租户级角色 |
| name | varchar(100) | NOT NULL | 如 OPERATOR, INSPECTOR, PACKER, LOADER, ADMIN |
| description | text | | |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| UNIQUE(tenant_id, name) | | | |

### 2.4 users (用户)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK, DEFAULT uuid_generate_v4() | |
| tenant_id | uuid | FK→tenants(id) CASCADE, NOT NULL | |
| username | varchar(100) | NOT NULL | 租户内唯一 |
| password_hash | varchar(255) | NOT NULL | |
| role | varchar(50) | DEFAULT 'OPERATOR' | 兼容旧版单角色字段 |
| is_system_user | boolean | DEFAULT FALSE | 系统/集成账号 |
| is_active | boolean | DEFAULT TRUE | |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| UNIQUE(tenant_id, username) | | | |

### 2.5 products (商品)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK, DEFAULT uuid_generate_v4() | |
| tenant_id | uuid | FK→tenants(id) CASCADE, NOT NULL | |
| sku | varchar(50) | NOT NULL | 租户内唯一 |
| name | varchar(255) | NOT NULL | |
| abc_class | char(1) | DEFAULT 'C' | A/B/C 分类，影响库位分配 |
| unit_weight | decimal(12,4) | | 单件重量 kg |
| unit_volume | decimal(12,4) | | 单件体积 m³ |
| is_serial_required | boolean | DEFAULT FALSE | 是否强制扫序列号 |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| UNIQUE(tenant_id, sku) | | | |

### 2.6 product_constraints (商品存储约束)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| product_id | uuid | PK, FK→products(id) CASCADE | 一商品一约束 |
| required_zone_type | varchar(50) | | 必需库位类型（PICK/BULK/CROSS_DOCK/冷藏等） |
| hs_code | varchar(50) | | 海关编码 |
| is_dangerous | boolean | DEFAULT FALSE | 是否危险品 |
| max_out_fridge_seconds | int | | 脱冷时限秒数 |
| storage_temp_range | varchar(50) | | 存储温度范围（如 "2-8°C"） |
| expiry_threshold_days | int | DEFAULT 30 | 效期预警天数 |
| hazmat_incompatibility_tags | text[] | | 危险品互斥标签数组（如 {"氧化剂","易燃品"}） |
| must_scan_sn | boolean | DEFAULT FALSE | 强制扫序列号 |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |

> **触发器强校验**：`fn_trg_enforce_product_constraints` 在库存 INSERT/UPDATE location_id 时自动校验：
> 1. 库位类型匹配 `required_zone_type`
> 2. 冷链商品不可放入非冷藏库位 (`is_frozen = FALSE`)
> 3. 危险品互斥标签同库位检查（数组交集 `&&`）

### 2.7 inventory (库存核心表)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK, DEFAULT uuid_generate_v4() | |
| tenant_id | uuid | FK→tenants(id) CASCADE, NOT NULL | |
| product_id | uuid | FK→products(id) SET NULL | |
| location_id | uuid | FK→locations(id) SET NULL | |
| container_id | uuid | FK→containers(id) SET NULL | |
| quantity | decimal(15,4) | NOT NULL DEFAULT 0, CHECK >= 0 | 可用数量 |
| picking_priority | int | DEFAULT 10 | **99 = 已开封散货（黑盒入库开箱后），拣货最高优先** |
| batch_no | varchar(100) | | 批次号 |
| mfg_date | date | | 生产日期 |
| exp_date | date | | 效期，**FEFO 分配按此字段 ASC NULLS LAST** |
| version | bigint | DEFAULT 1 | **乐观锁版本号** |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP | 触发器自动维护 |

> **关键索引**：
> - `idx_inv_sku_priority` (product_id, picking_priority DESC, exp_date ASC NULLS LAST) —— 分配查询覆盖
> - `idx_inv_picking_priority` (picking_priority DESC) WHERE picking_priority = 99 —— 散货快速查找

> **触发器**：
> - `trg_inventory_version_update` (BEFORE UPDATE): `version = version + 1`
> - `trg_inventory_history` (AFTER UPDATE): 记录 `inventory_history`
> - `trg_enforce_product_constraints` (BEFORE INSERT OR UPDATE OF location_id): 存储合规校验

### 2.8 orders / order_lines (订单与行项)

**orders**
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK, NOT NULL | |
| external_order_id | varchar(100) | UNIQUE, NOT NULL | 外部系统单号 |
| order_type | varchar(50) | NOT NULL | 订单类型 |
| status | varchar(50) | DEFAULT 'PENDING', CHECK 约束 | 见下 |
| tracking_no | varchar(100) | | 运单号 |
| cutoff_time | timestamptz | | **截单时间，波次规划排序依据** |
| platform_priority | int | DEFAULT 0 | **平台优先级，越大越优先** |
| created_at | timestamptz | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | timestamptz | DEFAULT CURRENT_TIMESTAMP | |

**order_lines**
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| order_id | uuid | FK→orders(id) CASCADE, NOT NULL | |
| product_id | uuid | FK→products(id) SET NULL | |
| qty | decimal(15,4) | NOT NULL | |
| status | varchar(20) | DEFAULT 'PENDING', CHECK 约束 | PENDING/ALLOCATED/PICKED/PACKED/SHIPPED/CANCELLED |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |

**状态 CHECK 约束**：
```sql
orders.status IN ('PENDING','CONFIRMED','ALLOCATED','PICKING','PACKED','SHIPPED','CANCELLED','EXCEPTION')
order_lines.status IN ('PENDING','ALLOCATED','PICKED','PACKED','SHIPPED','CANCELLED')
```

### 2.9 waves (波次)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK, DEFAULT uuid_generate_v4() | |
| tenant_id | uuid | FK→tenants(id) CASCADE, NOT NULL | |
| wave_no | varchar(50) | UNIQUE, NOT NULL | |
| status | varchar(50) | DEFAULT 'PLANNING', CHECK 约束 | PLANNING/RELEASED/IN_PROGRESS/COMPLETED/CANCELLED |
| strategy_type | varchar(50) | | 拣货策略类型 |
| created_at | timestamptz | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | timestamptz | DEFAULT CURRENT_TIMESTAMP | |

**CHECK 约束**：
```sql
status IN ('PLANNING','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED')
```

### 2.10 task_claims (竞争性任务租约)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK→tenants(id) CASCADE | |
| work_order_id | uuid | FK→work_orders(id) CASCADE | |
| claimed_by_user_id | uuid | FK→users(id) SET NULL | |
| claimed_by_device_id | uuid | FK→devices(id) SET NULL | |
| status | varchar(20) | NOT NULL DEFAULT 'ACTIVE', CHECK | ACTIVE/RELEASED/EXPIRED |
| claimed_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| expires_at | timestamp | NOT NULL | |
| released_at | timestamp | | |

> **核心约束**：`uq_task_claims_active` 局部唯一索引 ON (work_order_id) WHERE status='ACTIVE' —— 同一工单同一时刻只能有一条 ACTIVE 租约，并发保证完全依赖数据库唯一约束的原子性，不依赖应用层加锁。参见 `fn_claim_task`/`fn_release_task_claim`/`fn_expire_task_claims`（§4）。

### 2.11 sync_policies (离线策略配置)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK→tenants(id) CASCADE | |
| task_type | varchar(20) | NULL=不限任务类型 | |
| zone_type | varchar(20) | NULL=不限库位类型 | |
| offline_mode | varchar(20) | NOT NULL DEFAULT 'ALLOW', CHECK | ALLOW/LIMITED/ONLINE_ONLY |
| max_offline_duration_seconds | int | 仅 LIMITED 生效 | CHECK: offline_mode<>'LIMITED' OR 非空 |
| priority | int | NOT NULL DEFAULT 0 | 维度越具体应配越高优先级 |

> 按 tenant_id+task_type+zone_type 三维匹配，找不到配置时 `fn_get_sync_policy` 返回安全默认值（ALLOW + 28800 秒）。危险品/冷链相关组合的 `ONLINE_ONLY` 判定与具体秒数需业务/合规负责人确认，本表只提供机制（详见 `PDA_OFFLINE_SYNC_DESIGN.md` 开放问题章节）。

### 2.12 device_sync_state (设备同步状态)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| device_id | uuid | PK, FK→devices(id) CASCADE | |
| tenant_id | uuid | FK→tenants(id) CASCADE | 冗余存储，便于 RLS 直接过滤 |
| last_pull_at | timestamp | | |
| last_push_at | timestamp | | |
| last_applied_seq | bigint | NOT NULL DEFAULT 0 | |
| last_seen_online_at | timestamp | | |

### 2.13 sync_events (离线动作事件收件箱)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | **PK，由 PDA 生成，不用 DEFAULT** | 主键即幂等键，重复上传天然去重 |
| tenant_id | uuid | FK→tenants(id) CASCADE | |
| device_id | uuid | FK→devices(id) SET NULL | |
| operator_user_id | uuid | FK→users(id) SET NULL | |
| device_seq | bigint | NOT NULL | 设备端单调递增序号，不依赖设备时钟 |
| action_type | varchar(30) | NOT NULL | 目前只有 PICK 完整实现 |
| payload | jsonb | NOT NULL | 结构化业务动作参数 |
| captured_at | timestamp | NOT NULL | 设备本地捕获时间，仅供审计 |
| received_at | timestamp | DEFAULT CURRENT_TIMESTAMP | |
| applied_at | timestamp | | |
| status | varchar(20) | NOT NULL DEFAULT 'PENDING', CHECK | PENDING/APPLIED/EXCEPTION/REJECTED |
| UNIQUE(device_id, device_seq) | | | 第二重防线，检测设备序列号缺口（可能丢包） |

> 分发执行见 `fn_apply_sync_event`（§4），业务性异常（如库存不足）主动判断后登记，不等数据库报错再捕获；合规触发器改造为携带自定义 SQLSTATE `WMS01`，供精确分类为 `COLD_CHAIN_VIOLATION`。

### 2.14 exception_type_catalog / exceptions / exception_events (统一异常领域)

**exception_type_catalog**（异常类型元数据字典）
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| code | varchar(50) | NOT NULL | 如 INVENTORY_SHORTAGE |
| tenant_id | uuid | FK→tenants(id) CASCADE, NULL=全局默认 | |
| domain | varchar(30) | NOT NULL | INVENTORY/SYNC/COMPLIANCE/TASK/FULFILLMENT/BILLING/OTHER |
| default_severity | varchar(20) | NOT NULL DEFAULT 'MEDIUM', CHECK | LOW/MEDIUM/HIGH/CRITICAL |
| required_permission_resource | varchar(100) | | 处理该类异常所需权限 |
| required_permission_action | varchar(50) | DEFAULT 'resolve' | |
| is_active | boolean | DEFAULT TRUE | |

> `code` 不放进主键（因 tenant_id 需支持 NULL 表达"全局默认"，而主键列隐含 NOT NULL），改用两条局部唯一索引分别约束"全局唯一"（`uq_exception_type_catalog_global` WHERE tenant_id IS NULL）与"租户内唯一"（`uq_exception_type_catalog_tenant`）。

预置 9 种全局异常类型：

| code | domain | 默认严重度 | 触发方式 |
|---|---|---|---|
| `INVENTORY_SHORTAGE` | INVENTORY | HIGH | `fn_apply_pick_action` 主动判断触发 |
| `SYNC_APPLY_FAILURE` | SYNC | MEDIUM | `fn_apply_sync_event` 兜底捕获 |
| `COLD_CHAIN_VIOLATION` | COMPLIANCE | CRITICAL | 合规触发器（自定义 SQLSTATE WMS01）捕获 |
| `HAZMAT_CONFLICT` | COMPLIANCE | CRITICAL | 同上 |
| `TASK_CLAIM_EXPIRED` | TASK | MEDIUM | `fn_expire_task_claims` 定时巡检触发 |
| `COUNT_DISCREPANCY` | INVENTORY | MEDIUM | 人工发起（当前无自动检测子系统） |
| `CROSS_DOCK_TIMEOUT` | FULFILLMENT | LOW | `fn_cross_dock_timeout_sweep` 定时巡检触发 |
| `BILLING_DISCREPANCY` | BILLING | MEDIUM | 人工发起（当前无自动稽核逻辑） |
| `MANUAL_REVIEW` | OTHER | LOW | 人工发起的通用兜底类别 |

**exceptions**（统一异常台账）
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK→tenants(id) CASCADE | |
| exception_type | varchar(50) | NOT NULL | 对应 exception_type_catalog.code |
| domain | varchar(30) | NOT NULL | |
| severity | varchar(20) | NOT NULL | |
| status | varchar(20) | NOT NULL DEFAULT 'PENDING_REVIEW', CHECK | PENDING_REVIEW/CONFLICT/RESOLVED/DISMISSED |
| source_table | varchar(50) | | 触发来源表名 |
| source_id | uuid | | 触发来源那一行的 id |
| title | varchar(200) | | |
| details | jsonb | DEFAULT '{}' | |
| raised_by | uuid | FK→users(id) SET NULL, NULL=系统自动触发 | |
| assigned_to | uuid | FK→users(id) SET NULL | |
| resolution_action | varchar(50) | | |
| resolved_by | uuid | FK→users(id) SET NULL | |
| resolved_at | timestamp | | |
| resolution_notes | text | | |

> 生命周期：🟡 PENDING_REVIEW（默认起点）→ 🔴 CONFLICT（处理中发现复杂需升级，不是所有异常一开始就是红色）→ 🟢 RESOLVED（已处理）/ DISMISSED（已知悉判定不需处理，误报）。登记走 `fn_raise_exception`，恢复走 `fn_resolve_exception`（§4）。**定位说明**：各业务表自身 status 字段仍保留（支撑高频本表内查询），`exceptions` 是在其之上的"影子台账"，负责跨领域统一查看/权限校验/审计/恢复。

**exception_events**（追加型审计轨迹，永不修改，与 wo_action_logs/inventory_history 同一设计哲学）
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | bigserial | PK | |
| tenant_id | uuid | FK→tenants(id) CASCADE | |
| exception_id | uuid | FK→exceptions(id) CASCADE | |
| event_type | varchar(30) | NOT NULL | RAISED/ASSIGNED/COMMENT/STATUS_CHANGE/RESOLVED/DISMISSED/REOPENED |
| actor_user_id | uuid | FK→users(id) SET NULL, NULL=系统 | |
| from_status | varchar(20) | | |
| to_status | varchar(20) | | |
| note | text | | |

### 2.15 inventory_count_policies (盘点容差策略，Layer 3)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK→tenants(id) CASCADE | |
| product_id | uuid | FK→products(id) CASCADE，可空=租户默认容差 | |
| tolerance_qty | decimal(12,4) | NOT NULL DEFAULT 0 | |

> 局部唯一索引：`uq_count_policy_tenant_default` (tenant_id) WHERE product_id IS NULL；`uq_count_policy_tenant_product` (tenant_id, product_id) WHERE product_id IS NOT NULL。`fn_get_count_tolerance` 按 SKU 覆盖 > 租户默认 > 0（未配置时零容差，差异一律登记异常）解析。

### 2.16 packing_task_items (打包明细行，Layer 3)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK→tenants(id) CASCADE | |
| packing_task_id | uuid | FK→packing_tasks(id) CASCADE | |
| order_line_id | uuid | FK→order_lines(id) CASCADE | |
| product_id | uuid | FK→products(id) SET NULL | |
| container_id | uuid | FK→containers(id) SET NULL，**可空** | 同码/批量箱场景不记录具体箱号 |
| qty | decimal(15,4) | NOT NULL | |

> **可空唯一键的标准处理模式**：`container_id` 可空导致普通 `UNIQUE` 约束对 NULL 值不去重（Postgres `NULL <> NULL`），已改用两条局部唯一索引：`uq_packing_task_items_no_container` (packing_task_id, order_line_id) WHERE container_id IS NULL；`uq_packing_task_items_with_container` (packing_task_id, order_line_id, container_id) WHERE container_id IS NOT NULL。`packing_tasks` 是任务级汇总表，本表补充明细行级追踪——**是否启用取决于业务是否需要"箱级追溯"**，详见 `SYNC_ACTIONS_EXTENSION.md` §3。

### 2.17 tenant_tracking_policies (租户唯一追踪策略，Layer 4)
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| tenant_id | uuid | FK→tenants(id) CASCADE | |
| abc_class | char(1) | NOT NULL, CHECK IN ('A','B','C') | |
| requires_unique_tracking | boolean | NOT NULL | |
| UNIQUE(tenant_id, abc_class) | | | |

> A/C 有系统建议默认值（`fn_get_tenant_abc_tracking_default`：A=需要追踪，C=不需要），**B 类无系统默认值**，未配置时保守按"需要追踪"处理，部署前必须显式配置（详见 `TRACKING_POLICY_MISSING_LABEL.md` §2）。完整解析优先级：商品级覆盖（`product_constraints.requires_unique_tracking`）> 库位级强制（`locations.force_unique_tracking`，只能调严）> 本表租户 ABC 默认值，由 `fn_requires_unique_tracking` 统一解析。

---

## 3. 视图（10 个只读分析视图）

| 视图 | 说明 | 核心指标 |
|------|------|----------|
| `v_replenishment_needs` | 补货需求（PICK 区库位填充率 < 20%） | loc_code, sku, current_qty, fill_rate_pct |
| `v_boss_management_cockpit` | 老板驾驶舱（人效 PPH、异常率） | tenant, task_type, order_count, avg_response_sec, pph, exception_rate |
| `v_inventory_aging` | 库龄分析 | sku, batch, mfg_date, exp_date, qty, age_days, aging_status |
| `v_turnover_rate` | 周转率统计 | sku, movement_count, total_outbound_qty, avg_inventory_qty, turnover_ratio |
| `v_fulfillment_chain_progress` | 全链路进度看板 | wave 级：拣货/分拣/验货/打包/装车/直通各环节完成度 |
| `v_sorting_efficiency` | 分拣效率 | sorting_wave 级：任务/数量完成率、时长、件/小时 |
| `v_verification_pass_rate` | 验货合格率 | SKU 级：总检数、通过/拒收/隔离/返工数、合格率 |
| `v_packing_efficiency` | 打包效率 | packer 级：任务数、箱数、面单数、平均耗时、总重量 |
| `v_loading_utilization` | 装车载重利用率 | vehicle 级：计划/实载重体积、重量/体积利用率 |
| `v_cross_dock_efficiency` | 直通效率 | tenant 级：总作业数、发运/降级/超时数、平均前置时长、发运率 |

---

## 4. 核心 RPC 函数（37 个：17 个 V2.1 核心函数 + 9 个 Layer 2 离线同步/异常领域函数 + 6 个 Layer 3 同步动作扩展函数 + 6 个 Layer 4 追踪策略函数）

| 函数 | 分类 | 说明 |
|------|------|------|
| `fn_trg_inventory_version_manager()` | 触发器 | 库存乐观锁版本自增 |
| `fn_trg_inventory_history()` | 触发器 | 库存变动历史审计 |
| `fn_logic_stock_allocation(p_order_id, p_sku_id, p_needed_qty)` | 业务 | **跨箱分配：散货优先→近效期(FEFO)→创建时间** |
| `fn_logic_resolve_blackbox_box(p_lpn_code, p_sku_id, p_qty, p_batch)` | 业务 | **黑盒入库解析**：扫箱不扫货，开箱时确认 SKU/数量，picking_priority=99 |
| `check_user_permission(p_user_id, p_resource, p_action, p_scope)` | 认证 | **RBAC 权限检查 RPC**（供 AuthMiddleware 调用） |
| `adjust_inventory(p_tenant_id, p_sku, p_quantity, p_reason)` | 业务 | 库存调整（入库/出库/盘点调整） |
| `sync_inventory_from_source(p_tenant_id)` | 集成 | 同步外部库存（占位，对接 ERP/WMS） |
| `fn_match_cross_dock(p_receipt_id, p_sku_id, p_qty)` | 业务 | **直通匹配**：入库单+SKU→匹配出库单，按 platform_priority DESC, cutoff_time ASC |
| `fn_allocate_chute(p_wave_id, p_sku_id)` | 业务 | **滑道分配**：优先填满已用滑道、集中分拣 |
| `fn_verify_weight(p_sku_id, p_actual_weight)` | 业务 | **重量校验**：基于 verification_rules 当前生效版本 |
| `fn_get_active_billing_rule(p_tenant_id)` | 计费 | **查询当前生效计费规则**（规范化表优先，回退 JSONB） |
| `fn_trg_enforce_product_constraints()` | 触发器 | **存储合规强校验**（库位类型、冷链、危险品互斥） |
| `fn_update_updated_at()` | 通用 | updated_at 自动维护 |
| `fn_current_tenant_id()` | 认证 | **获取当前租户 ID**（优先 JWT app_metadata.tenant_id，回退 users 表） |
| `fn_cross_dock_timeout_sweep()` | 维护 | **直通超时自动降级**（MATCHED/STAGING→FALLBACK，每 5 分钟跑批） |
| `fn_purge_old_action_logs(p_days INT DEFAULT 180)` | 维护 | **历史日志清理**（wo_action_logs + inventory_history，每天凌晨 3 点） |
| `fn_claim_task(p_work_order_id, p_user_id, p_device_id, p_lease_seconds=300)` | 离线同步 | **竞争性任务租约领用**：插入成功即领用成功；因唯一约束冲突失败时返回明确失败原因（不抛异常） |
| `fn_release_task_claim(p_claim_id)` | 离线同步 | 任务正常完成后主动释放租约 |
| `fn_expire_task_claims()` | 维护 | **定时清扫过期租约**（建议每 1~5 分钟），发现工单未完成则标记 EXCEPTION + 登记 `TASK_CLAIM_EXPIRED` 异常 |
| `fn_get_sync_policy(p_tenant_id, p_task_type, p_zone_type)` | 离线同步 | 查询离线策略（ALLOW/LIMITED/ONLINE_ONLY），未配置时返回安全默认值 ALLOW+28800秒 |
| `fn_apply_sync_event(p_event_id)` | 离线同步 | **同步事件统一分发入口**：按 action_type 路由（目前仅 PICK 完整实现），WMS01 SQLSTATE→COLD_CHAIN_VIOLATION，WHEN OTHERS→SYNC_APPLY_FAILURE |
| `fn_apply_pick_action(p_event_id)` | 离线同步 | **拣货动作处理**：库存不足时主动判断、不写入负库存，登记 INVENTORY_SHORTAGE + 生成 COUNT 复盘工单 + 订单行标记 EXCEPTION |
| `fn_confirm_inventory_recount(p_exception_id, p_resolution_details)` | 离线同步 | 主管确认复盘后：库存修正为确认值（标注"盘点调整"）+ 订单行解除异常 |
| `fn_raise_exception(p_tenant_id, p_exception_type, p_source_table, p_source_id, p_title, p_details, p_raised_by)` | 统一异常 | **统一登记入口**：解析类型元数据、写台账 + 首条审计轨迹 |
| `fn_resolve_exception(p_exception_id, p_resolver_user_id, p_new_status, p_resolution_action, p_resolution_notes, p_resolution_details)` | 统一异常 | **统一恢复入口**：权限校验（复用 check_user_permission）→ 领域收尾动作（目前完整实现库存异常闭环）→ 更新台账 → 写审计轨迹 |
| `fn_adjust_inventory_at_location(p_tenant_id, p_product_id, p_location_id, p_delta, p_container_id?, p_batch_no?, p_mfg_date?, p_exp_date?)` | Layer 3 | **原子库存写入原语**：按具体库位/容器/批次维度原子调整，负库存不写入直接返回 NOT FOUND 由调用方转异常 |
| `fn_reconcile_location_count(p_tenant_id, p_product_id, p_location_id, p_diff)` | Layer 3 | **批次无关的库位盘点核销原语**：核销到该库位最近更新的一行，避免因批次未知而误建重复行 |
| `fn_get_count_tolerance(p_tenant_id, p_product_id)` | Layer 3 | 查询盘点容差（SKU 覆盖 > 租户默认 > 0） |
| `fn_apply_putaway_action(p_event_id)`（Layer 3 修正版，Layer 4 会再次 CREATE OR REPLACE） | Layer 3 | **上架动作**：修正原 PR 的 `locations.status` 列名错误（实为 `is_active`），实际写入批次/效期 |
| `fn_apply_count_action(p_event_id)`（修正版） | Layer 3 | **盘点动作**：容差改用 `fn_get_count_tolerance` 可配置值，差异类型统一为 `COUNT_DISCREPANCY` |
| `fn_apply_pack_action(p_event_id)`（修正版） | Layer 3 | **打包动作**：对齐真实 `packing_tasks`/`packing_task_items` 表结构，完成时联动更新 `order_lines`/`packing_tasks` 状态 |
| `fn_get_tenant_abc_tracking_default(p_tenant_id, p_abc_class)` | Layer 4 | 租户 ABC 分类唯一追踪默认值（A=需要，C=不需要，B 无默认保守按需要处理） |
| `fn_requires_unique_tracking(p_tenant_id, p_product_id, p_location_id)` | Layer 4 | **唯一追踪策略完整解析**：商品覆盖 > 库位强制 > 租户 ABC 默认，任一层判定需要即为需要 |
| `fn_generate_internal_lpn(p_exception_id, p_actor_user_id)` | Layer 4 | 为 `MISSING_LABEL` 异常生成内部码（`INT-{日期}-{随机串}`），`containers.lpn_source='SYSTEM_GENERATED'` |
| `fn_confirm_label_applied(p_exception_id, p_scanned_lpn_code, p_resolver_user_id)` | Layer 4 | 核对扫码与生成码一致后挂载容器，通过 `fn_resolve_exception` 关闭异常 |
| `fn_receive_unidentified_goods(p_tenant_id, p_location_id, p_qty, p_note, p_actor_user_id?)` | Layer 4 | 登记 `UNIDENTIFIED_GOODS`（`product_id=NULL` 暂存库存，严重度 HIGH） |
| `fn_identify_unidentified_goods(p_exception_id, p_confirmed_product_id, p_resolver_user_id)` | Layer 4 | 回填 `product_id`，触发合规复查（依赖 §5 触发器范围扩展），通过 `fn_resolve_exception` 关闭异常 |

---

## 5. 触发器体系

| 触发器 | 表 | 时机 | 事件 | 函数 | 说明 |
|--------|-----|------|------|------|------|
| `trg_inventory_version_update` | inventory | BEFORE | UPDATE | `fn_trg_inventory_version_manager()` | 乐观锁版本号+1 |
| `trg_inventory_history` | inventory | AFTER | UPDATE | `fn_trg_inventory_history()` | 变动审计入历史表 |
| `trg_enforce_product_constraints` | inventory | BEFORE | INSERT, UPDATE OF **location_id, product_id**（Layer 4 扩展，原仅 location_id） | `fn_trg_enforce_product_constraints()` | **存储合规强校验**；Layer 4 扩展原因：回填 `product_id`（未识别货物识别确认）只改 product_id 不改 location_id，原范围会导致该场景静默跳过合规校验 |
| `trg_*_updated_at` | **46 表**（48 表中 `sync_events`/`exception_events` 按设计不加） | BEFORE | UPDATE | `fn_update_updated_at()` | 统一自动维护 updated_at（DO 块批量挂载） |

---

## 6. 关键索引（节选）

| 索引 | 表 | 列 | 类型/条件 | 用途 |
|------|-----|-----|-----------|------|
| `idx_inv_sku_priority` | inventory | (product_id, picking_priority DESC, exp_date ASC NULLS LAST) | B-tree | 核心分配查询覆盖索引 |
| `idx_inv_picking_priority` | inventory | (picking_priority DESC) | 部分索引 WHERE picking_priority=99 | 散货快速查找 |
| `uq_resv_active` | inventory_reservations | (inventory_id, order_id) | 唯一索引 WHERE status='ACTIVE' | 活跃预留防重复 |
| `uq_verification_rules_current` | verification_rules | (tenant_id, sku_id) | 唯一索引 WHERE effective_to IS NULL | **当前生效规则唯一** |
| `idx_cross_dock_jobs_timeout` | cross_dock_jobs | (timeout_at) | 部分索引 WHERE status NOT IN ('SHIPPED','CANCELLED','FALLBACK') | 超时扫描加速 |
| `uq_task_claims_active` | task_claims | (work_order_id) | 局部唯一索引 WHERE status='ACTIVE' | **竞争性锁核心**：同工单同时只允许一条 ACTIVE 租约 |
| `idx_task_claims_expires` | task_claims | (expires_at) | 部分索引 WHERE status='ACTIVE' | `fn_expire_task_claims` 扫描加速 |
| `idx_sync_events_status` | sync_events | (status) | 部分索引 WHERE status='PENDING' | 待处理事件扫描加速 |
| `idx_sync_events_device` | sync_events | (device_id, device_seq) | B-tree | 序列号缺口检测、按设备追溯 |
| `uq_exception_type_catalog_global` / `_tenant` | exception_type_catalog | (code) / (code, tenant_id) | 局部唯一索引 | 全局默认唯一 + 租户覆盖唯一并存 |
| `idx_exceptions_tenant_status` | exceptions | (tenant_id, status) | B-tree | 异常看板核心查询 |
| `idx_exceptions_severity` | exceptions | (severity) | 部分索引 WHERE status IN ('PENDING_REVIEW','CONFLICT') | 高严重度异常优先展示 |

---

## 7. 状态字段 CHECK 约束（29 个：26 个既有 + 3 个 Layer 3/4 新增）

| 约束名 | 表 | 允许值 |
|--------|-----|--------|
| `chk_orders_status` | orders | PENDING, CONFIRMED, ALLOCATED, PICKING, PACKED, SHIPPED, CANCELLED, EXCEPTION |
| `chk_order_lines_status` | order_lines | PENDING, ALLOCATED, PICKED, PACKED, SHIPPED, CANCELLED, **EXCEPTION**（v2.2.0 新增，库存异常闭环用） |
| `chk_work_orders_status` | work_orders | OPEN, ASSIGNED, IN_PROGRESS, COMPLETED, EXCEPTION, CANCELLED |
| `chk_containers_status` | containers | IDLE, IN_USE, STAGED, RETIRED |
| `chk_waves_status` | waves | PLANNING, RELEASED, IN_PROGRESS, COMPLETED, CANCELLED |
| `chk_inventory_reservations_status` | inventory_reservations | ACTIVE, RELEASED, EXPIRED, CONSUMED |
| `chk_inbound_receipts_status` | inbound_receipts | PENDING, RECEIVING, RECEIVED, CLOSED |
| `chk_sorting_chutes_status` | sorting_chutes | ACTIVE, FULL, CLOSED, MAINTENANCE |
| `chk_sorting_tasks_status` | sorting_tasks | PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, EXCEPTION, CANCELLED |
| `chk_sorting_waves_status` | sorting_waves | PLANNING, CHUTE_ALLOCATED, SORTING, COMPLETED, EXCEPTION |
| `chk_quality_inspections_status` | quality_inspections | PENDING, IN_PROGRESS, PASSED, FAILED, QUARANTINE, REWORK, CANCELLED |
| `chk_quality_inspections_result` | quality_inspections | PASS, REJECT, QUARANTINE, REWORK (result 列) |
| `chk_packing_tasks_status` | packing_tasks | PENDING, PACKING, LABEL_PRINTING, SEALING, COMPLETED, EXCEPTION, CANCELLED |
| `chk_vehicles_status` | vehicles | AVAILABLE, LOADING, IN_TRANSIT, UNLOADING, MAINTENANCE, RETIRED |
| `chk_loading_tasks_status` | loading_tasks | PLANNING, LOADING, LOADED, SEALED, DEPARTED, EXCEPTION, CANCELLED |
| `chk_shipping_documents_status` | shipping_documents | DRAFT, ISSUED, SIGNED, ARCHIVED |
| `chk_cross_dock_jobs_status` | cross_dock_jobs | MATCHED, STAGING, PICKING, PACKING, LOADING, SHIPPED, TIMEOUT, FALLBACK, CANCELLED |
| `chk_billing_transactions_status` | billing_transactions | PENDING, INVOICED, PAID, VOID |
| `chk_billing_tier_days` | billing_rule_tiers | max_days IS NULL OR max_days >= min_days |
| `chk_verification_rules_period` | verification_rules | effective_to IS NULL OR effective_to >= effective_from |
| `chk_task_claims_status` | task_claims | ACTIVE, RELEASED, EXPIRED |
| `chk_sync_policies_offline_mode` | sync_policies | ALLOW, LIMITED, ONLINE_ONLY |
| `chk_sync_policies_limited_duration` | sync_policies | offline_mode <> 'LIMITED' OR max_offline_duration_seconds IS NOT NULL |
| `chk_sync_events_status` | sync_events | PENDING, APPLIED, EXCEPTION, REJECTED |
| `chk_exception_type_catalog_severity` | exception_type_catalog | LOW, MEDIUM, HIGH, CRITICAL |
| `chk_exceptions_status` | exceptions | PENDING_REVIEW, CONFLICT, RESOLVED, DISMISSED |
| `chk_containers_lpn_source` | containers | EXTERNAL, SYSTEM_GENERATED（Layer 4 新增） |
| `chk_tenant_tracking_abc_class` | tenant_tracking_policies | A, B, C（Layer 4 新增） |
| （复用既有）`chk_order_lines_status` 已含 EXCEPTION | order_lines | 见 v2.2.0 变更，Layer 3 库存不足闭环复用同一状态值 |

> **设计意图**：全库状态值统一大写，写入非法值直接报错，避免统计视图静默漏数。

---

## 8. 行级安全 (RLS) 策略

**启用表（38 表）**：`users`、`devices`、`products`、`locations`、`waves`、`orders`、`inventory`、`billing_transactions`、`barcode_mappings`、`work_orders`、`roles`、`inbound_receipts`、`sorting_chutes`、`sorting_tasks`、`sorting_waves`、`verification_rules`、`quality_inspections`、`package_specs`、`label_templates`、`packing_tasks`、`consumable_usages`、`vehicles`、`loading_tasks`、`shipping_documents`、`cross_dock_jobs`、`billing_rules`、`task_claims`、`sync_policies`、`device_sync_state`、`sync_events`、`exceptions`、`exception_events`（v2.2.0 新增 6 张）、`inventory_count_policies`、`packing_task_items`、`tenant_tracking_policies`（v2.3.0 新增 3 张）

**exception_type_catalog 特殊策略**（v2.2.0 新增，需同时看到"本租户覆盖配置"与"全局默认配置"两部分，不能用标准模板）：
```sql
CREATE POLICY tenant_isolation ON exception_type_catalog
USING (tenant_id = fn_current_tenant_id() OR tenant_id IS NULL)
WITH CHECK (tenant_id = fn_current_tenant_id());
```

**策略模板**：
```sql
CREATE POLICY tenant_isolation ON <table>
USING (tenant_id = fn_current_tenant_id())
WITH CHECK (tenant_id = fn_current_tenant_id());
```

**tenants 表特殊策略**（基于自身 id）：
```sql
CREATE POLICY tenant_isolation ON tenants
USING (id = fn_current_tenant_id())
WITH CHECK (id = fn_current_tenant_id());
```

**未直接启用 RLS 的表**（通过外键间接隔离，主要由 SECURITY DEFINER 函数/后端服务账号访问）：
`containers`, `product_constraints`, `inventory_history`, `inventory_reservations`, `inventory_locks`, `wo_action_logs`, `inspection_items`, `vas_boms`, `vas_bom_items`, `wave_order_mapping`, `order_lines`, `permissions`, `role_permissions`, `user_roles`

> **Supabase 免费版同样支持 RLS**，无需升级套餐。service_role key 天然绕过 RLS，供后台批处理/定时任务使用。

---

## 9. 定时维护任务 (pg_cron)

> 实际注册语句在独立脚本 `unWMS_Setup_Cron_Jobs_V2.1.sql` 中，部署时单独执行。

| 任务名 | 调度 | 调用函数 | 说明 |
|--------|------|----------|------|
| `cross-dock-timeout-sweep` | `*/5 * * * *` (每 5 分钟) | `fn_cross_dock_timeout_sweep()` | 直通超时自动降级 FALLBACK |
| `purge-old-action-logs` | `0 3 * * *` (每天凌晨 3 点) | `fn_purge_old_action_logs(180)` | 清理 180 天前日志，释放 Supabase 免费版 500MB 配额 |
| `task-claim-expiry-sweep` | 建议 `*/1-5 * * * *` (每 1~5 分钟，v2.2.0 新增) | `fn_expire_task_claims()` | 清扫过期任务租约，未完成工单自动标记异常 |

**pg_cron 启用方式**（主脚本已含异常捕获）：
```sql
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron;
RAISE NOTICE 'pg_cron 已启用'; EXCEPTION WHEN OTHERS THEN
RAISE NOTICE 'pg_cron 不可用（本地/CI 正常）：%', SQLERRM; END $$;
```

---

## 10. 关键差异对照（V2.1 vs 旧 3 文件迁移）

| 特性 | 旧迁移 (3 文件) | V2.1 (单文件) | 影响 |
|------|----------------|---------------|------|
| 权限表 | 缺失 | ✅ 完整 | `check_user_permission` 可运行 |
| order_lines | 缺失 | ✅ 完整 | 直通匹配、订单行状态可用 |
| inbound_receipts | 缺失 | ✅ 完整 | 直通入库单据可用 |
| RLS | 仅注释 | ✅ 全量启用 | 多租户隔离生效 |
| CHECK 约束 | 无 | ✅ 20+ 约束 | 状态值大写强制、脏数据拦截 |
| updated_at | 仅履约链路表 | ✅ 38 表全覆盖 | 核心主数据可审计修改时间 |
| 计费规则 | 仅 JSONB | ✅ 规范化表 + 回退 | 费率可追溯、可版本化 |
| 验货规则 | 单版本 | ✅ 版本化 + 局部唯一索引 | 历史订单可按当时规则复核 |
| 存储合规 | 仅字段 | ✅ 触发器强校验 | 危险品/冷链违规入库直接报错 |
| 直通超时 | 仅字段 | ✅ 定时任务自动降级 | 货物不再无限期滞留 |
| 日志清理 | 无 | ✅ 180 天定时清理 | 免费版 500MB 配额可持续 |
| pg_cron | 注释掉 | ✅ 显式启用 + 异常捕获 | 部署不再遗漏扩展启用 |

---

## 11. 迁移脚本对应关系

> **重要提示**：`supabase/` 目录（含 `supabase/migrations/`）已加入 `.gitignore`，不再纳入本仓库版本管理（历史备份目录 `supabase/migrations.backup.*` 同样被忽略）。因此下表记录的是**设计层面**的脚本对应关系，实际 SQL 文件由部署流程在仓库之外维护；本文档才是表结构的版本化事实来源。

| 迁移脚本（设计对应） | 包含表 | 状态 |
|----------|--------|------|
| V2.1 统一初始化脚本 | 38 表全量 | ✅ 当前生效 |
| 离线同步 + 统一异常领域增量扩展 | `task_claims`/`sync_policies`/`device_sync_state`/`sync_events`/`exception_type_catalog`/`exceptions`/`exception_events` 共 7 表 + `inventory_reservations.work_order_id` + `order_lines` EXCEPTION 状态 | 🚧 设计已确定，迁移脚本落地待 Phase 1（见 `docs/00-project/ROADMAP.md`） |

---

## 12. 版本记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-07-01 | 初始 Schema 定义（基于 3 份历史脚本） |
| 1.1.0 | 2025-07-07 | 新增 RLS 策略状态表、迁移脚本对应关系 |
| **2.1.0** | **2026-07-08** | **基于 V2.1 SQL 全量重写：RLS 全启用、CHECK 约束、updated_at 全覆盖、计费规范化、验货版本化、合规触发器、直通超时降级、日志清理、pg_cron 显式启用** |
| **2.2.0** | **2026-07-15** | **补充离线同步 + 统一异常领域设计**（DBA 新方案替代旧状态同步/OT-CRDT 设计）：新增 `task_claims`/`sync_policies`/`device_sync_state`/`sync_events`/`exception_type_catalog`/`exceptions`/`exception_events` 7 表、9 个函数、`inventory_reservations.work_order_id`、`order_lines.EXCEPTION` 状态；修正 §11 迁移文件引用（`supabase/` 已加入 .gitignore，不再假设某个具体文件名） |

---

## 13. 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **架构设计** | `docs/01-architecture/ARCHITECTURE.md` | 系统架构、数据流、ADR |
| **API 规范** | `docs/02-api/API_SPEC.md` | OpenAPI 端点、RPC、认证 |
| **PDA 离线同步设计** | `docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md` | 操作同步、预分工、竞争性锁、统一异常领域 |
| **设备端 API 协议** | `docs/02-api/DEVICE_PROTOCOL_SPEC.md` | REST/WebSocket 接口、任务领用、统一异常上报 |
| **PDA 本地 SQLite Schema** | `docs/03-database/SQLITE_LOCAL_SCHEMA.md` | 只读缓存 + Outbox 两类本地表 |
| **冲突解决策略** | `docs/03-database/CONFLICT_RESOLUTION_STRATEGY.md` | 预分工为何让冲突不可能发生、任务租约语义 |
| **同步接口契约规范** | `docs/02-api/SYNC_API_CONTRACT.md` | sync_events 幂等收件箱、APPLIED/EXCEPTION/REJECTED 契约 |
| **仓储层设计** | `docs/03-database/REPOSITORY_DESIGN.md` | 聚合根、端口、实现策略 |
| **仓储层路线图** | `docs/03-database/REPOSITORY_ROADMAP.md` | 实施计划、里程碑 |

---

*本文档为单一事实来源。`supabase/` 目录已加入 .gitignore、不再纳入版本管理，因此 Schema 变更需以本文档为准，实际迁移脚本的部署由运维流程另行维护并需与本文档保持一致。*