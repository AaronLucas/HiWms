/**
 * 各业务实体状态列的合法取值——统一常量来源。
 *
 * 背景：这些状态列在数据库里是 CHECK 约束的 varchar 列，不是原生 Postgres ENUM，
 * Supabase 类型生成器无法把它们转成 TypeScript 字面量联合类型（`src/types/database.ts`
 * 里这些字段的类型就是普通 `string`）。这导致此前各仓库文件各自手写状态字符串字面量，
 * 大小写和取值多处与真实 CHECK 约束不一致（2026-07-27 审计发现 ~40 处），部分查询/统计
 * 方法在生产环境静默返回空结果。本文件把每张表的合法取值集中定义一次，其余代码统一从
 * 这里引用，而不是各自手写字符串。
 *
 * 取值与 supabase/migrations 对应表的 CHECK 约束逐一核对一致（2026-07-27）；
 * 约束变更需同步更新本文件。
 */

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  ALLOCATED: 'ALLOCATED',
  PICKING: 'PICKING',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  CANCELLED: 'CANCELLED',
  EXCEPTION: 'EXCEPTION',
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const WAVE_STATUS = {
  PLANNING: 'PLANNING',
  RELEASED: 'RELEASED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type WaveStatus = (typeof WAVE_STATUS)[keyof typeof WAVE_STATUS];

export const WORK_ORDER_STATUS = {
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  EXCEPTION: 'EXCEPTION',
  CANCELLED: 'CANCELLED',
} as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUS)[keyof typeof WORK_ORDER_STATUS];

export const CONTAINER_STATUS = {
  IDLE: 'IDLE',
  IN_USE: 'IN_USE',
  STAGED: 'STAGED',
  RETIRED: 'RETIRED',
} as const;
export type ContainerStatus = (typeof CONTAINER_STATUS)[keyof typeof CONTAINER_STATUS];

export const VEHICLE_STATUS = {
  AVAILABLE: 'AVAILABLE',
  LOADING: 'LOADING',
  IN_TRANSIT: 'IN_TRANSIT',
  UNLOADING: 'UNLOADING',
  MAINTENANCE: 'MAINTENANCE',
  RETIRED: 'RETIRED',
} as const;
export type VehicleStatus = (typeof VEHICLE_STATUS)[keyof typeof VEHICLE_STATUS];

export const INBOUND_RECEIPT_STATUS = {
  PENDING: 'PENDING',
  RECEIVING: 'RECEIVING',
  RECEIVED: 'RECEIVED',
  CLOSED: 'CLOSED',
} as const;
export type InboundReceiptStatus = (typeof INBOUND_RECEIPT_STATUS)[keyof typeof INBOUND_RECEIPT_STATUS];

export const LOADING_TASK_STATUS = {
  PLANNING: 'PLANNING',
  LOADING: 'LOADING',
  LOADED: 'LOADED',
  SEALED: 'SEALED',
  DEPARTED: 'DEPARTED',
  EXCEPTION: 'EXCEPTION',
  CANCELLED: 'CANCELLED',
} as const;
export type LoadingTaskStatus = (typeof LOADING_TASK_STATUS)[keyof typeof LOADING_TASK_STATUS];

export const CROSS_DOCK_JOB_STATUS = {
  MATCHED: 'MATCHED',
  STAGING: 'STAGING',
  PICKING: 'PICKING',
  PACKING: 'PACKING',
  LOADING: 'LOADING',
  SHIPPED: 'SHIPPED',
  TIMEOUT: 'TIMEOUT',
  FALLBACK: 'FALLBACK',
  CANCELLED: 'CANCELLED',
} as const;
export type CrossDockJobStatus = (typeof CROSS_DOCK_JOB_STATUS)[keyof typeof CROSS_DOCK_JOB_STATUS];

export const SORTING_TASK_STATUS = {
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  EXCEPTION: 'EXCEPTION',
  CANCELLED: 'CANCELLED',
} as const;
export type SortingTaskStatus = (typeof SORTING_TASK_STATUS)[keyof typeof SORTING_TASK_STATUS];

export const PACKING_TASK_STATUS = {
  PENDING: 'PENDING',
  PACKING: 'PACKING',
  LABEL_PRINTING: 'LABEL_PRINTING',
  SEALING: 'SEALING',
  COMPLETED: 'COMPLETED',
  EXCEPTION: 'EXCEPTION',
  CANCELLED: 'CANCELLED',
} as const;
export type PackingTaskStatus = (typeof PACKING_TASK_STATUS)[keyof typeof PACKING_TASK_STATUS];

export const SORTING_CHUTE_STATUS = {
  ACTIVE: 'ACTIVE',
  FULL: 'FULL',
  CLOSED: 'CLOSED',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type SortingChuteStatus = (typeof SORTING_CHUTE_STATUS)[keyof typeof SORTING_CHUTE_STATUS];

export const QUALITY_INSPECTION_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  QUARANTINE: 'QUARANTINE',
  REWORK: 'REWORK',
  CANCELLED: 'CANCELLED',
} as const;
export type QualityInspectionStatus = (typeof QUALITY_INSPECTION_STATUS)[keyof typeof QUALITY_INSPECTION_STATUS];

export const SHIPPING_DOCUMENT_STATUS = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  SIGNED: 'SIGNED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ShippingDocumentStatus = (typeof SHIPPING_DOCUMENT_STATUS)[keyof typeof SHIPPING_DOCUMENT_STATUS];
