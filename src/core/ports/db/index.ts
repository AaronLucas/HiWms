export { IRepository } from './IRepository';
export { IInventoryRepository } from './IInventoryRepository';
export { IOrderRepository } from './IOrderRepository';
export { IProductRepository } from './IProductRepository';
export { ITenantRepository } from './ITenantRepository';
export { IWorkOrderRepository } from './IWorkOrderRepository';

// Phase 1 新增端口
export { ILocationRepository } from './ILocationRepository';
export { IContainerRepository } from './IContainerRepository';
export { IWaveRepository } from './IWaveRepository';
export { ICrossDockJobRepository } from './ICrossDockJobRepository';
export { IPackingTaskRepository } from './IPackingTaskRepository';
export { ISortingTaskRepository } from './ISortingTaskRepository';
export { ILoadingTaskRepository } from './ILoadingTaskRepository';
export { IDeviceRepository } from './IDeviceRepository';
export { IInventoryLockRepository } from './IInventoryLockRepository';
export { IInventoryReservationRepository } from './IInventoryReservationRepository';
export { IInboundReceiptRepository } from './IInboundReceiptRepository';

// Phase 1 已完成的端口
export { IProductConstraintRepository } from './IProductConstraintRepository';
export { IRoleRepository } from './IRoleRepository';

// Phase 2 新增端口
export { IVehicleRepository } from './IVehicleRepository';
export { IPackageSpecRepository } from './IPackageSpecRepository';
export { ILabelTemplateRepository } from './ILabelTemplateRepository';
export { IQualityInspectionRepository } from './IQualityInspectionRepository';
export { IVerificationRuleRepository } from './IVerificationRuleRepository';
export { IConsumableUsageRepository } from './IConsumableUsageRepository';
export { IShippingDocumentRepository } from './IShippingDocumentRepository';
export { ISortingChuteRepository } from './ISortingChuteRepository';

// Phase 3 新增端口
export { IBillingRuleRepository } from './IBillingRuleRepository';
export { IBillingTransactionRepository } from './IBillingTransactionRepository';
export { IUserRepository } from './IUserRepository';
export { IAsnRepository } from './IAsnRepository';

// Phase 5: 离线同步 / 统一异常领域仓储（Layer 2）
export { ITaskClaimRepository, type TaskClaimRow, type TaskClaimInsert, type TaskClaimUpdate } from './ITaskClaimRepository';
export { ISyncPolicyRepository, type SyncPolicyRow, type SyncPolicyInsert, type SyncPolicyUpdate } from './ISyncPolicyRepository';
export { IDeviceSyncStateRepository, type DeviceSyncStateRow, type DeviceSyncStateInsert, type DeviceSyncStateUpdate } from './IDeviceSyncStateRepository';
export { ISyncEventRepository, type SyncEventRow, type SyncEventInsert, type SyncEventUpdate, type SyncEventStatus, type SyncActionType } from './ISyncEventRepository';
export { IExceptionRepository, type ExceptionRow, type ExceptionInsert, type ExceptionUpdate, type ExceptionEventRow, type ExceptionEventInsert, type ExceptionTypeCatalogRow, type ExceptionStatus, type ExceptionDomain, type ExceptionSeverity } from './IExceptionRepository';

// Phase 6: 同步动作扩展仓储（Layer 3）
export { IInventoryCountPolicyRepository, type InventoryCountPolicyRow, type InventoryCountPolicyInsert, type InventoryCountPolicyUpdate } from './IInventoryCountPolicyRepository';
export { IPackingTaskItemRepository, type PackingTaskItemRow, type PackingTaskItemInsert, type PackingTaskItemUpdate } from './IPackingTaskItemRepository';

// Phase 7: 唯一追踪策略仓储（Layer 4）
export { ITenantTrackingPolicyRepository, type TenantTrackingPolicyRow, type TenantTrackingPolicyInsert, type TenantTrackingPolicyUpdate } from './ITenantTrackingPolicyRepository';
export { IMissingLabelRepository, type MissingLabelRow, type MissingLabelInsert, type MissingLabelUpdate, type ContainerRow, type ContainerInsert, type ContainerUpdate } from './IMissingLabelRepository';
export { IUnidentifiedGoodsRepository, type UnidentifiedGoodsRow, type UnidentifiedGoodsInsert, type UnidentifiedGoodsUpdate } from './IUnidentifiedGoodsRepository';

// Phase 8: 库区/序列号追踪 + 存储管理仓储（migration 007/008）
export { IInventoryUnitRepository, type InventoryUnitRow, type SerialLookupRow } from './IInventoryUnitRepository';
export { IStorageManagementPolicyRepository, type StorageManagementPolicyRow, type StorageManagementPolicyInsert, type StorageManagementPolicyUpdate, type StorageUsageStatus } from './IStorageManagementPolicyRepository';
export { IZoneRepository, type ZoneRow, type ZoneInsert, type ZoneUpdate } from './IZoneRepository';
