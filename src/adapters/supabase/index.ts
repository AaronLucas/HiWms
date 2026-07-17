/**
 * Supabase 适配器统一导出
 * 所有外部依赖通过此文件访问 Supabase 实现
 */
export { WmsSupabaseClient, TABLES, type TableName, type SupabaseConfig } from './SupabaseClient';
export { SupabaseRpcClient } from './rpc/SupabaseRpcClient';
export { SupabaseTenantRepository } from './repositories/SupabaseTenantRepository';
export { SupabaseProductRepository } from './repositories/SupabaseProductRepository';
export { SupabaseInventoryRepository } from './repositories/SupabaseInventoryRepository';
export { SupabaseOrderRepository } from './repositories/SupabaseOrderRepository';
export { SupabaseWorkOrderRepository } from './repositories/SupabaseWorkOrderRepository';
// Phase 1 新增
export { SupabaseLocationRepository } from './repositories/SupabaseLocationRepository';
export { SupabaseContainerRepository } from './repositories/SupabaseContainerRepository';
export { SupabaseWaveRepository } from './repositories/SupabaseWaveRepository';
export { SupabaseCrossDockJobRepository } from './repositories/SupabaseCrossDockJobRepository';
export { SupabasePackingTaskRepository } from './repositories/SupabasePackingTaskRepository';
export { SupabaseSortingTaskRepository } from './repositories/SupabaseSortingTaskRepository';
export { SupabaseLoadingTaskRepository } from './repositories/SupabaseLoadingTaskRepository';
export { SupabaseDeviceRepository } from './repositories/SupabaseDeviceRepository';
export { SupabaseInventoryLockRepository } from './repositories/SupabaseInventoryLockRepository';
export { SupabaseInventoryReservationRepository } from './repositories/SupabaseInventoryReservationRepository';
export { SupabaseInboundReceiptRepository } from './repositories/SupabaseInboundReceiptRepository';
export { SupabaseProductConstraintRepository } from './repositories/SupabaseProductConstraintRepository';
export { SupabaseRoleRepository } from './repositories/SupabaseRoleRepository';
// Phase 2 新增
export { SupabaseVehicleRepository } from './repositories/SupabaseVehicleRepository';
export { SupabasePackageSpecRepository } from './repositories/SupabasePackageSpecRepository';
export { SupabaseLabelTemplateRepository } from './repositories/SupabaseLabelTemplateRepository';
export { SupabaseQualityInspectionRepository } from './repositories/SupabaseQualityInspectionRepository';
export { SupabaseVerificationRuleRepository } from './repositories/SupabaseVerificationRuleRepository';
export { SupabaseConsumableUsageRepository } from './repositories/SupabaseConsumableUsageRepository';
export { SupabaseShippingDocumentRepository } from './repositories/SupabaseShippingDocumentRepository';
export { SupabaseSortingChuteRepository } from './repositories/SupabaseSortingChuteRepository';
// Phase 3 新增
export { SupabaseBillingRuleRepository } from './repositories/SupabaseBillingRuleRepository';
export { SupabaseBillingTransactionRepository } from './repositories/SupabaseBillingTransactionRepository';
export { SupabaseUserRepository } from './repositories/SupabaseUserRepository';
export { SupabaseAsnRepository } from './repositories/SupabaseAsnRepository';

// Phase 5: 离线同步 / 统一异常领域仓储（Layer 2）
export { SupabaseTaskClaimRepository } from './repositories/SupabaseTaskClaimRepository';
export { SupabaseSyncPolicyRepository } from './repositories/SupabaseSyncPolicyRepository';
export { SupabaseDeviceSyncStateRepository } from './repositories/SupabaseDeviceSyncStateRepository';
export { SupabaseSyncEventRepository } from './repositories/SupabaseSyncEventRepository';
export { SupabaseExceptionRepository } from './repositories/SupabaseExceptionRepository';

export { SupabaseAuthProvider } from './auth/SupabaseAuthProvider';
export { SupabasePermissionChecker } from './auth/SupabasePermissionChecker';
export { SupabaseTenantResolver } from './auth/SupabaseTenantResolver';
export { SupabaseCacheProvider, RedisCacheProvider } from './cache/SupabaseCacheProvider';
export { CacheKeyBuilder } from './cache/CacheKeyBuilder';

/** 适配器工厂函数 */
import { WmsSupabaseClient } from './SupabaseClient';
import { SupabaseRpcClient } from './rpc/SupabaseRpcClient';
import { SupabaseTenantRepository } from './repositories/SupabaseTenantRepository';
import { SupabaseProductRepository } from './repositories/SupabaseProductRepository';
import { SupabaseInventoryRepository } from './repositories/SupabaseInventoryRepository';
import { SupabaseOrderRepository } from './repositories/SupabaseOrderRepository';
import { SupabaseWorkOrderRepository } from './repositories/SupabaseWorkOrderRepository';
// Phase 1
import { SupabaseLocationRepository } from './repositories/SupabaseLocationRepository';
import { SupabaseContainerRepository } from './repositories/SupabaseContainerRepository';
import { SupabaseWaveRepository } from './repositories/SupabaseWaveRepository';
import { SupabaseCrossDockJobRepository } from './repositories/SupabaseCrossDockJobRepository';
import { SupabasePackingTaskRepository } from './repositories/SupabasePackingTaskRepository';
import { SupabaseSortingTaskRepository } from './repositories/SupabaseSortingTaskRepository';
import { SupabaseLoadingTaskRepository } from './repositories/SupabaseLoadingTaskRepository';
import { SupabaseDeviceRepository } from './repositories/SupabaseDeviceRepository';
import { SupabaseInventoryLockRepository } from './repositories/SupabaseInventoryLockRepository';
import { SupabaseInventoryReservationRepository } from './repositories/SupabaseInventoryReservationRepository';
import { SupabaseInboundReceiptRepository } from './repositories/SupabaseInboundReceiptRepository';
import { SupabaseProductConstraintRepository } from './repositories/SupabaseProductConstraintRepository';
import { SupabaseRoleRepository } from './repositories/SupabaseRoleRepository';
// Phase 2
import { SupabaseVehicleRepository } from './repositories/SupabaseVehicleRepository';
import { SupabasePackageSpecRepository } from './repositories/SupabasePackageSpecRepository';
import { SupabaseLabelTemplateRepository } from './repositories/SupabaseLabelTemplateRepository';
import { SupabaseQualityInspectionRepository } from './repositories/SupabaseQualityInspectionRepository';
import { SupabaseVerificationRuleRepository } from './repositories/SupabaseVerificationRuleRepository';
import { SupabaseConsumableUsageRepository } from './repositories/SupabaseConsumableUsageRepository';
import { SupabaseShippingDocumentRepository } from './repositories/SupabaseShippingDocumentRepository';
import { SupabaseSortingChuteRepository } from './repositories/SupabaseSortingChuteRepository';
// Phase 3
import { SupabaseBillingRuleRepository } from './repositories/SupabaseBillingRuleRepository';
import { SupabaseBillingTransactionRepository } from './repositories/SupabaseBillingTransactionRepository';
import { SupabaseUserRepository } from './repositories/SupabaseUserRepository';
import { SupabaseAsnRepository } from './repositories/SupabaseAsnRepository';

// Phase 5: Layer 2
import { SupabaseTaskClaimRepository } from './repositories/SupabaseTaskClaimRepository';
import { SupabaseSyncPolicyRepository } from './repositories/SupabaseSyncPolicyRepository';
import { SupabaseDeviceSyncStateRepository } from './repositories/SupabaseDeviceSyncStateRepository';
import { SupabaseSyncEventRepository } from './repositories/SupabaseSyncEventRepository';
import { SupabaseExceptionRepository } from './repositories/SupabaseExceptionRepository';

import { SupabaseAuthProvider } from './auth/SupabaseAuthProvider';
import { SupabasePermissionChecker } from './auth/SupabasePermissionChecker';
import { SupabaseTenantResolver } from './auth/SupabaseTenantResolver';
import { SupabaseCacheProvider, CacheKeyBuilder } from './cache/SupabaseCacheProvider';
import type { Database } from '../../types/database';
import { WorkflowEngine } from '../../core/workflows/WorkflowEngine';
import { TaskRegistry, InMemoryDefinitionStore, InMemoryInstanceStore, InMemoryExecutionStore } from '../../core/workflows/WorkflowEngine';

export interface SupabaseAdapters {
  client: WmsSupabaseClient;
  rpc: SupabaseRpcClient;
  repositories: {
    tenants: SupabaseTenantRepository;
    products: SupabaseProductRepository;
    inventory: SupabaseInventoryRepository;
    orders: SupabaseOrderRepository;
    workOrders: SupabaseWorkOrderRepository;
    // Phase 1
    locations: SupabaseLocationRepository;
    containers: SupabaseContainerRepository;
    waves: SupabaseWaveRepository;
    crossDockJobs: SupabaseCrossDockJobRepository;
    packingTasks: SupabasePackingTaskRepository;
    sortingTasks: SupabaseSortingTaskRepository;
    loadingTasks: SupabaseLoadingTaskRepository;
    devices: SupabaseDeviceRepository;
    inventoryLocks: SupabaseInventoryLockRepository;
    inventoryReservations: SupabaseInventoryReservationRepository;
    inboundReceipts: SupabaseInboundReceiptRepository;
    productConstraints: SupabaseProductConstraintRepository;
    roles: SupabaseRoleRepository;
    // Phase 2
    vehicles: SupabaseVehicleRepository;
    packageSpecs: SupabasePackageSpecRepository;
    labelTemplates: SupabaseLabelTemplateRepository;
    qualityInspections: SupabaseQualityInspectionRepository;
    verificationRules: SupabaseVerificationRuleRepository;
    consumableUsages: SupabaseConsumableUsageRepository;
    shippingDocuments: SupabaseShippingDocumentRepository;
    sortingChutes: SupabaseSortingChuteRepository;
    // Phase 3
    billingRules: SupabaseBillingRuleRepository;
    billingTransactions: SupabaseBillingTransactionRepository;
    users: SupabaseUserRepository;
    asn: SupabaseAsnRepository;
    // Phase 5: Layer 2
    taskClaims: SupabaseTaskClaimRepository;
    syncPolicies: SupabaseSyncPolicyRepository;
    deviceSyncStates: SupabaseDeviceSyncStateRepository;
    syncEvents: SupabaseSyncEventRepository;
    exceptions: SupabaseExceptionRepository;
  };
  auth: {
    provider: SupabaseAuthProvider;
    permissionChecker: SupabasePermissionChecker;
    tenantResolver: SupabaseTenantResolver;
  };
  cache: {
    provider: SupabaseCacheProvider;
    keyBuilder: CacheKeyBuilder;
  };
  workflowEngine: WorkflowEngine;
}

/**
 * 创建所有 Supabase 适配器实例
 * 用于应用启动时的依赖注入
 */
export function createSupabaseAdapters(config: {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}): SupabaseAdapters {
  const client = WmsSupabaseClient.getInstance({ url: config.url, anonKey: config.anonKey, serviceRoleKey: config.serviceRoleKey });
  const rpc = new SupabaseRpcClient(client);

  // 创建工作流引擎所需的存储实例
  const taskRegistry = new TaskRegistry();
  const definitionStore = new InMemoryDefinitionStore();
  const instanceStore = new InMemoryInstanceStore();
  const executionStore = new InMemoryExecutionStore();
  const workflowEngine = new WorkflowEngine(taskRegistry, definitionStore, instanceStore, executionStore);

  return {
    client,
    rpc,
    repositories: {
      tenants: new SupabaseTenantRepository(client),
      products: new SupabaseProductRepository(client),
      inventory: new SupabaseInventoryRepository(client),
      orders: new SupabaseOrderRepository(client),
      workOrders: new SupabaseWorkOrderRepository(client),
      // Phase 1
      locations: new SupabaseLocationRepository(client),
      containers: new SupabaseContainerRepository(client),
      waves: new SupabaseWaveRepository(client),
      crossDockJobs: new SupabaseCrossDockJobRepository(client),
      packingTasks: new SupabasePackingTaskRepository(client),
      sortingTasks: new SupabaseSortingTaskRepository(client),
      loadingTasks: new SupabaseLoadingTaskRepository(client),
      devices: new SupabaseDeviceRepository(client),
      inventoryLocks: new SupabaseInventoryLockRepository(client),
      inventoryReservations: new SupabaseInventoryReservationRepository(client),
      inboundReceipts: new SupabaseInboundReceiptRepository(client),
      productConstraints: new SupabaseProductConstraintRepository(client),
      roles: new SupabaseRoleRepository(client),
      // Phase 2
      vehicles: new SupabaseVehicleRepository(client),
      packageSpecs: new SupabasePackageSpecRepository(client),
      labelTemplates: new SupabaseLabelTemplateRepository(client),
      qualityInspections: new SupabaseQualityInspectionRepository(client),
      verificationRules: new SupabaseVerificationRuleRepository(client),
      consumableUsages: new SupabaseConsumableUsageRepository(client),
      shippingDocuments: new SupabaseShippingDocumentRepository(client),
      sortingChutes: new SupabaseSortingChuteRepository(client),
      // Phase 3
      billingRules: new SupabaseBillingRuleRepository(client),
      billingTransactions: new SupabaseBillingTransactionRepository(client),
      users: new SupabaseUserRepository(client),
      asn: new SupabaseAsnRepository(client),
      // Phase 5: Layer 2
      taskClaims: new SupabaseTaskClaimRepository(client, rpc),
      syncPolicies: new SupabaseSyncPolicyRepository(client, rpc),
      deviceSyncStates: new SupabaseDeviceSyncStateRepository(client),
      syncEvents: new SupabaseSyncEventRepository(client, rpc),
      exceptions: new SupabaseExceptionRepository(client, rpc),
    },
    auth: {
      provider: new SupabaseAuthProvider(client.getClient(), config.serviceRoleKey ? client.getAdminClient() : null),
      permissionChecker: new SupabasePermissionChecker(client),
      tenantResolver: new SupabaseTenantResolver(
        client,
        // permissionChecker 需要在创建后注入，这里简化处理
        { checkUserPermission: async () => false } as any
      ),
    },
    cache: {
      provider: new SupabaseCacheProvider(),
      keyBuilder: new CacheKeyBuilder(),
    },
    workflowEngine,
  };
}