# 仓储层设计文档

## 1. 设计原则

### 1.1 聚合根识别标准
基于 DDD 战略设计，从 34 个业务表中识别聚合根：
- **事务一致性边界**：跨表事务必须在同一聚合内
- **业务不变量**：聚合根负责维护业务规则不变性
- **生命周期管理**：聚合根控制内部实体的创建/删除

### 1.2 仓储接口设计规范
```typescript
// 标准模板
export interface IAggregateRepository extends IRepository<AggregateRow, AggregateInsert, AggregateUpdate> {
  // 1. 业务查询方法（按聚合根维度）
  findByBusinessKey(key: string): Promise<AggregateRow | null>;
  findByTenant(tenantId: string, options?: QueryOptions): Promise<AggregateRow[]>;
  
  // 2. 状态流转方法
  updateStatus(id: string, status: AggregateStatus): Promise<AggregateRow>;
  
  // 3. 关联聚合查询
  findWithRelations(id: string): Promise<AggregateWithRelations | null>;
  
  // 4. 批量操作（乐观锁）
  batchUpdate(updates: BatchUpdate[]): Promise<AggregateRow[]>;
}
```

### 1.3 命名约定
| 层级 | 命名 | 示例 |
|-----|------|------|
| Port 接口 | `I{Aggregate}Repository` | `ILocationRepository` |
| Supabase 实现 | `Supabase{Aggregate}Repository` | `SupabaseLocationRepository` |
| 表类型别名 | `{Aggregate}Row` | `LocationRow` |

---

## 2. 聚合根与仓储映射表

### 2.1 核心域 - 已实现（5个）

| 聚合根 | 表 | 端口 | 实现 | 状态 |
|--------|-----|------|------|------|
| Tenant | tenants | ITenantRepository | SupabaseTenantRepository | ✅ 完成 |
| Product | products, product_constraints, package_specs, barcode_mappings | IProductRepository | SupabaseProductRepository | ✅ 完成 |
| Inventory | inventory, inventory_history, inventory_locks, inventory_reservations | IInventoryRepository | SupabaseInventoryRepository | ✅ 完成 |
| Order | orders, order_lines | IOrderRepository | SupabaseOrderRepository | ✅ 完成 |
| WorkOrder | work_orders, wo_action_logs | IWorkOrderRepository | SupabaseWorkOrderRepository | ✅ 完成 |

### 2.2 入库域 - 入库收货（P0 优先）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| InboundReceipt | inbound_receipts, inspection_items | IInboundReceiptRepository | SupabaseInboundReceiptRepository | P0 |
| ASN (预入库单) | asn_headers, asn_lines | IAsnRepository | SupabaseAsnRepository | P1 |

> **业务理由**：入库是仓库作业起点，涉及收货、质检、上架全链路

### 2.3 库位/容器域 - 库存物理管理（P0 优先）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| Location | locations | ILocationRepository | SupabaseLocationRepository | P0 |
| Container | containers | IContainerRepository | SupabaseContainerRepository | P0 |

> **业务理由**：库位是拣选/补货/库存查询的核心维度；容器/LPN是移动单位

### 2.4 出库/波次域 - 作业执行核心（P0 优先）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| Wave | waves, wave_order_mapping | IWaveRepository | SupabaseWaveRepository | P0 |
| CrossDockJob | cross_dock_jobs | ICrossDockJobRepository | SupabaseCrossDockJobRepository | P0 |

> **业务理由**：波次驱动拣选/打包/分拣全流程；交叉理货是直通核心场景

### 2.5 作业任务域 - PDA/设备端执行（P0 优先）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| PackingTask | packing_tasks | IPackingTaskRepository | SupabasePackingTaskRepository | P0 |
| SortingTask | sorting_tasks, sorting_chutes | ISortingTaskRepository | SupabaseSortingTaskRepository | P0 |
| LoadingTask | loading_tasks | ILoadingTaskRepository | SupabaseLoadingTaskRepository | P0 |

> **业务理由**：直接对接 PDA/设备端，执行层核心

### 2.6 发货/运输域（P1）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| ShippingDocument | shipping_documents | IShippingDocumentRepository | SupabaseShippingDocumentRepository | P1 |
| Vehicle | vehicles | IVehicleRepository | SupabaseVehicleRepository | P1 |

### 2.7 计费/结算域（P1）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| BillingRule | billing_rules, billing_rule_tiers | IBillingRuleRepository | SupabaseBillingRuleRepository | P1 |
| BillingTransaction | billing_transactions | IBillingTransactionRepository | SupabaseBillingTransactionRepository | P1 |

### 2.8 质检/增值服务域（P2）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| QualityInspection | quality_inspections, inspection_items | IQualityInspectionRepository | SupabaseQualityInspectionRepository | P2 |
| VasBom | vas_boms, vas_bom_items | IVasBomRepository | SupabaseVasBomRepository | P2 |

### 2.9 设备/用户/规则域（P1-P2）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| Device | devices | IDeviceRepository | SupabaseDeviceRepository | P1 |
| User/Role | users, roles, user_roles, role_permissions, permissions | IUserRepository, IRoleRepository | SupabaseUserRepository, SupabaseRoleRepository | P1 |
| VerificationRule | verification_rules | IVerificationRuleRepository | SupabaseVerificationRuleRepository | P2 |
| LabelTemplate | label_templates | ILabelTemplateRepository | SupabaseLabelTemplateRepository | P2 |

### 2.10 库存并发控制（P0 - 技术基础设施）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| InventoryLock | inventory_locks | IInventoryLockRepository | SupabaseInventoryLockRepository | P0 |
| InventoryReservation | inventory_reservations | IInventoryReservationRepository | SupabaseInventoryReservationRepository | P0 |

> **技术理由**：乐观锁/悲观锁实现的核心，防止超卖

### 2.11 PDA 离线同步域（P0 - 设备端核心）

| 聚合根 | 表 | 端口 | 实现 | 优先级 |
|--------|-----|------|------|--------|
| SyncQueue | sync_queue (PDA 本地) | ISyncQueueRepository | SupabaseSyncQueueRepository | P0 |
| SyncSession | sync_sessions (PDA 本地) | ISyncSessionRepository | SupabaseSyncSessionRepository | P0 |
| SyncConflict | sync_conflicts (PDA 本地) | ISyncConflictRepository | SupabaseSyncConflictRepository | P0 |
| SyncCursor | sync_cursors (PDA 本地) | ISyncCursorRepository | SupabaseSyncCursorRepository | P0 |
| DeviceState | device_state | IDeviceStateRepository | SupabaseDeviceStateRepository | P0 |
| PendingUpload | pending_uploads (PDA 本地) | IPendingUploadRepository | SupabasePendingUploadRepository | P1 |

> **业务理由**：PDA 离线优先架构核心支撑，同步队列、冲突解决、游标管理、设备状态、文件上传全链路仓储

---

## 3. 接口设计规范（每个仓储必须实现）

### 3.1 基础查询模式
```typescript
interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  ascending?: boolean;
  filters?: Record<string, unknown>;
}

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

### 3.2 标准方法签名

| 方法类型 | 命名模式 | 返回值 | 说明 |
|---------|---------|--------|------|
| 单查 | `findBy{BusinessKey}` | `Promise<T \| null>` | 唯一业务键查询 |
| 列表 | `findBy{Condition}` | `Promise<T[]>` | 多条件查询 |
| 分页 | `findByTenantPaginated` | `Promise<PaginatedResult<T>>` | 租户隔离分页 |
| 关联 | `findWith{Relation}` | `Promise<TWithRelations \| null>` | 聚合根+关联实体 |
| 状态流转 | `updateStatus` / `transitionTo` | `Promise<T>` | 状态机驱动 |
| 批量 | `batch{Operation}` | `Promise<T[]>` | 乐观锁批量更新 |
| 统计 | `countBy{Condition}` / `aggregate{Metric}` | `Promise<number>` | 仪表盘/报表用 |

---

## 4. 实施计划

### Phase 1: 端口定义（P0 核心聚合根，11个）
| 序号 | 端口文件 | 预估行数 | 依赖 |
|-----|---------|---------|------|
| 1 | ILocationRepository.ts | ~80 | IRepository, Tables<'locations'> |
| 2 | IContainerRepository.ts | ~70 | IRepository, Tables<'containers'> |
| 3 | IInboundReceiptRepository.ts | ~100 | IRepository, Tables<'inbound_receipts'>, Tables<'inspection_items'> |
| 4 | IWaveRepository.ts | ~90 | IRepository, Tables<'waves'>, Tables<'wave_order_mapping'> |
| 5 | ICrossDockJobRepository.ts | ~80 | IRepository, Tables<'cross_dock_jobs'> |
| 6 | IPackingTaskRepository.ts | ~80 | IRepository, Tables<'packing_tasks'> |
| 7 | ISortingTaskRepository.ts | ~90 | IRepository, Tables<'sorting_tasks'>, Tables<'sorting_chutes'> |
| 8 | ILoadingTaskRepository.ts | ~70 | IRepository, Tables<'loading_tasks'> |
| 9 | IDeviceRepository.ts | ~70 | IRepository, Tables<'devices'> |
| 10 | IInventoryLockRepository.ts | ~70 | IRepository, Tables<'inventory_locks'> |
| 11 | IInventoryReservationRepository.ts | ~80 | IRepository, Tables<'inventory_reservations'> |

### Phase 2: Supabase 实现（对应 Phase 1）
每个实现约 150-250 行，复用 `SupabaseBaseRepository`

### Phase 3: 端口定义（P1 业务扩展，8个）
| 序号 | 端口文件 |
|-----|---------|
| 1 | IShippingDocumentRepository.ts |
| 2 | IVehicleRepository.ts |
| 3 | IBillingRuleRepository.ts |
| 4 | IBillingTransactionRepository.ts |
| 5 | IUserRepository.ts |
| 6 | IRoleRepository.ts |
| 7 | IAsnRepository.ts (预入库单) |
| 8 | IConsumableUsageRepository.ts |

### Phase 4: Supabase 实现（对应 Phase 3）

### Phase 5: 端口定义（P2 支撑域，6个）
| 序号 | 端口文件 |
|-----|---------|
| 1 | IQualityInspectionRepository.ts |
| 2 | IVasBomRepository.ts |
| 3 | IVerificationRuleRepository.ts |
| 4 | ILabelTemplateRepository.ts |
| 5 | IInventoryHistoryRepository.ts (审计日志) |
| 6 | IPackageSpecRepository.ts |

---

## 5. 代码生成策略

### 5.1 基类复用
```typescript
// 所有 Supabase 仓储继承
export abstract class SupabaseBaseRepository<T, TInsert, TUpdate, TId extends string = string> 
  implements IRepository<T, TInsert, TUpdate, TId>
```

### 5.2 代码模板化
使用统一模板生成：
- Port 接口模板
- Supabase 实现模板
- 单元测试模板

### 5.3 索引导出更新
每新增端口/实现，同步更新：
- `src/core/ports/db/index.ts`
- `src/adapters/supabase/repositories/index.ts`

---

## 6. 验收标准

### 6.1 编译检查
```bash
npx tsc --noEmit  # 零错误
```

### 6.2 接口完整性
- [ ] 每个聚合根对应一个 Port 接口
- [ ] 每个 Port 有对应的 Supabase 实现
- [ ] 所有实现通过 `implements I{X}Repository` 编译检查

### 6.3 功能覆盖
- [ ] CRUD 基础方法（继承基类）
- [ ] 业务查询方法（≥3个/仓储）
- [ ] 状态流转方法（≥1个/仓储）
- [ ] 关联聚合查询（≥1个/仓储）
- [ ] 批量乐观锁更新（库存/锁/预留类）

### 6.4 租户隔离
- [ ] 所有查询默认带 `tenant_id` 过滤
- [ ] 管理员客户端可选 bypass RLS

---

## 7. 依赖关系图

```
IRepository (基类接口)
    ↑
ITenantRepository ← ITenantRepository (已完成)
IProductRepository ← IProductRepository (已完成)
IInventoryRepository ← IInventoryRepository (已完成)
IOrderRepository ← IOrderRepository (已完成)
IWorkOrderRepository ← IWorkOrderRepository (已完成)

ILocationRepository ← SupabaseLocationRepository (P0)
IContainerRepository ← SupabaseContainerRepository (P0)
IInboundReceiptRepository ← SupabaseInboundReceiptRepository (P0)
IWaveRepository ← SupabaseWaveRepository (P0)
ICrossDockJobRepository ← SupabaseCrossDockJobRepository (P0)
IPackingTaskRepository ← SupabasePackingTaskRepository (P0)
ISortingTaskRepository ← SupabaseSortingTaskRepository (P0)
ILoadingTaskRepository ← SupabaseLoadingTaskRepository (P0)
IDeviceRepository ← SupabaseDeviceRepository (P0)
IInventoryLockRepository ← SupabaseInventoryLockRepository (P0)
IInventoryReservationRepository ← SupabaseInventoryReservationRepository (P0)
... (P1, P2 继续)
```

---

## 8. 风险与对策

| 风险 | 对策 |
|-----|------|
| 仓储过多导致维护成本高 | 统一基类 + 代码生成模板 + 只写业务方法 |
| 租户隔离泄露 | 基类 `findAll` 默认注入 `tenant_id`，显式 opt-out |
| 乐观锁冲突处理不一致 | 基类提供 `updateWithOptimisticLock` 统一方法 |
| 关联查询 N+1 问题 | 提供 `findWithRelations` 一次性加载，避免循环查询 |
| 类型安全缺失 | 严格使用 `Tables<'table'>` 类型，禁用 `any` |

---

*文档版本：v1.0*
*创建时间：2025-07-10*
*状态：待评审确认*