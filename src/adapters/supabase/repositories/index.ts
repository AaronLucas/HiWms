export { SupabaseBaseRepository } from './SupabaseBaseRepository';
export { SupabaseInventoryRepository } from './SupabaseInventoryRepository';
export { SupabaseOrderRepository } from './SupabaseOrderRepository';
export { SupabaseProductRepository } from './SupabaseProductRepository';
export { SupabaseTenantRepository } from './SupabaseTenantRepository';
export { SupabaseWorkOrderRepository } from './SupabaseWorkOrderRepository';

// Phase 1 新增实现
export { SupabaseLocationRepository } from './SupabaseLocationRepository';
export { SupabaseContainerRepository } from './SupabaseContainerRepository';
export { SupabaseWaveRepository } from './SupabaseWaveRepository';
export { SupabaseCrossDockJobRepository } from './SupabaseCrossDockJobRepository';
export { SupabasePackingTaskRepository } from './SupabasePackingTaskRepository';
export { SupabaseSortingTaskRepository } from './SupabaseSortingTaskRepository';
export { SupabaseLoadingTaskRepository } from './SupabaseLoadingTaskRepository';
export { SupabaseDeviceRepository } from './SupabaseDeviceRepository';
export { SupabaseInventoryLockRepository } from './SupabaseInventoryLockRepository';
export { SupabaseInventoryReservationRepository } from './SupabaseInventoryReservationRepository';
export { SupabaseInboundReceiptRepository } from './SupabaseInboundReceiptRepository';

// Phase 1 已完成的实现
export { SupabaseProductConstraintRepository } from './SupabaseProductConstraintRepository';
export { SupabaseRoleRepository } from './SupabaseRoleRepository';

// Phase 2 新增实现
export { SupabaseVehicleRepository } from './SupabaseVehicleRepository';
export { SupabasePackageSpecRepository } from './SupabasePackageSpecRepository';
export { SupabaseLabelTemplateRepository } from './SupabaseLabelTemplateRepository';
export { SupabaseQualityInspectionRepository } from './SupabaseQualityInspectionRepository';
export { SupabaseVerificationRuleRepository } from './SupabaseVerificationRuleRepository';
export { SupabaseConsumableUsageRepository } from './SupabaseConsumableUsageRepository';
export { SupabaseShippingDocumentRepository } from './SupabaseShippingDocumentRepository';
export { SupabaseSortingChuteRepository } from './SupabaseSortingChuteRepository';

// Phase 3 新增实现
export { SupabaseBillingRuleRepository } from './SupabaseBillingRuleRepository';
export { SupabaseBillingTransactionRepository } from './SupabaseBillingTransactionRepository';
export { SupabaseUserRepository } from './SupabaseUserRepository';
export { SupabaseAsnRepository } from './SupabaseAsnRepository';

// Phase 5: 离线同步 / 统一异常领域仓储（Layer 2）
export { SupabaseTaskClaimRepository } from './SupabaseTaskClaimRepository';
export { SupabaseSyncPolicyRepository } from './SupabaseSyncPolicyRepository';
export { SupabaseDeviceSyncStateRepository } from './SupabaseDeviceSyncStateRepository';
export { SupabaseSyncEventRepository } from './SupabaseSyncEventRepository';
export { SupabaseExceptionRepository } from './SupabaseExceptionRepository';

// Phase 6: 同步动作扩展仓储（Layer 3）
export { SupabaseInventoryCountPolicyRepository } from './SupabaseInventoryCountPolicyRepository';
export { SupabasePackingTaskItemRepository } from './SupabasePackingTaskItemRepository';

// Phase 7: 唯一追踪策略仓储（Layer 4）
export { SupabaseTenantTrackingPolicyRepository } from './SupabaseTenantTrackingPolicyRepository';
export { SupabaseMissingLabelRepository } from './SupabaseMissingLabelRepository';
export { SupabaseUnidentifiedGoodsRepository } from './SupabaseUnidentifiedGoodsRepository';
