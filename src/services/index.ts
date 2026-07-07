// Services barrel export
export { StockAllocationService } from './StockAllocationService';
export type { AllocationResult, AllocationRequest } from './StockAllocationService';

export { BlackboxReceivingService } from './BlackboxReceivingService';
export type { BlackboxReceiveRequest, BlackboxReceiveResult } from './BlackboxReceivingService';

export { ProductConstraintService } from './ProductConstraintService';
export type {
  ProductConstraint,
  ComplianceCheckResult,
  ComplianceViolation,
  ComplianceWarning,
  ReceivingCheckRequest,
  PickingCheckRequest,
} from './ProductConstraintService';

export { BillingEngine } from './BillingEngine';
export type {
  BillingStrategy,
  StorageStep,
  LaborRate,
  ConsumableRate,
  VasRate,
  VolumeDiscount,
  BillingContext,
  StorageBillingInput,
  LaborBillingInput,
  ConsumableBillingInput,
  VasBillingInput,
  BillingResult,
  BillingBreakdownItem,
} from './BillingEngine';

export { WorkOrderService } from './WorkOrderService';
export type {
  WorkOrderType,
  WorkOrderStatus,
  WorkOrderInput,
  WorkOrderUpdateInput,
  WorkOrder,
} from './WorkOrderService';

export { ActionLogService } from './ActionLogService';
export type {
  ActionType,
  ActionLogInput,
  ActionLog,
} from './ActionLogService';

export { ReplenishmentScheduler } from './ReplenishmentScheduler';
export type {
  ReplenishmentNeed,
  ReplenishmentRule,
  SchedulerConfig,
  SchedulerResult,
  SchedulerStatus,
} from './ReplenishmentScheduler';

export { RoleManager } from './RoleManager';

// Phase A: 履约/发运服务
export { SortingService } from './SortingService';
// Types are exported from models/fulfillment.ts

export { VerificationService } from './VerificationService';
// Types are exported from models/fulfillment.ts

export { PackingService } from './PackingService';
// Types are exported from models/fulfillment.ts

export { LoadingService } from './LoadingService';
// Types are exported from models/fulfillment.ts

// Re-export fulfillment types for convenience
export type {
  SortingChuteCreate,
  SortingWaveCreate,
  SortingTaskCreate,
  VerificationRuleCreate,
  QualityInspectionCreate,
  InspectionItemCreate,
  PackageSpecCreate,
  LabelTemplateCreate,
  PackingTaskCreate,
  PackedItemInput,
  VehicleCreate,
  LoadingTaskCreate,
  ShippingDocumentCreate,
} from '../models/fulfillment';