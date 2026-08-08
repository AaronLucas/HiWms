/**
 * Tenant API 请求验证 Schemas
 */
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { ORDER_STATUS, WAVE_STATUS, INBOUND_RECEIPT_STATUS, QUALITY_INSPECTION_RESULT } from '../../core/constants/status';

// ========== 通用类型 ==========

export const uuidSchema = z.string().uuid({ message: 'Must be a valid UUID' });
export const isoDateTimeSchema = z.string().datetime({ offset: true, message: 'Must be a valid ISO 8601 datetime' });
export const positiveIntSchema = z.number().int().positive();
export const nonNegativeIntSchema = z.number().int().nonnegative();

// ========== POST /auth/login ==========

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  captchaToken: z.string().optional(),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

// ========== PATCH /api/users/me/password ==========

export const changePasswordBodySchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

const orderStatusValues = Object.values(ORDER_STATUS) as [string, ...string[]];

// ========== POST /api/orders ==========

export const createOrderLineSchema = z.object({
  productId: uuidSchema,
  qty: positiveIntSchema,
});

/** tenantId 不由客户端提供，由认证中间件解析的 req.context.tenantId 注入，避免跨租户伪造 */
export const createOrderBodySchema = z.object({
  externalOrderId: z.string().min(1),
  orderType: z.enum(['outbound', 'inbound', 'transfer']),
  lines: z.array(createOrderLineSchema).min(1, 'At least one order line required'),
  cutoffTime: isoDateTimeSchema.optional(),
  platformPriority: nonNegativeIntSchema.optional(),
});

export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;

// ========== GET /api/orders ==========

export const listOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(orderStatusValues).optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// ========== GET /api/orders/:id ==========

export const orderIdParamsSchema = z.object({
  id: uuidSchema,
});

export type OrderIdParams = z.infer<typeof orderIdParamsSchema>;

// ========== GET /api/inventory ==========

export const listInventoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  productId: uuidSchema.optional(),
  locationId: uuidSchema.optional(),
});

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

// ========== GET /api/inventory/:id ==========

export const inventoryIdParamsSchema = z.object({ id: uuidSchema });
export type InventoryIdParams = z.infer<typeof inventoryIdParamsSchema>;

// ========== GET /api/products ==========

export const listProductsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  /**
   * SupabaseProductRepository.search() 把 q 原样拼进 PostgREST 的 .or() 过滤字符串
   * （`name.ilike.%${q}%,sku.ilike.%${q}%`），逗号/括号是该语法的分隔符，不能放行，
   * 否则可以在 or() 过滤条件里注入额外的逻辑分支。限制为常见搜索字符集。
   */
  q: z.string().min(1).max(100).regex(/^[\p{L}\p{N} _-]+$/u, 'Search query contains unsupported characters').optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

// ========== GET /api/products/:id ==========

export const productIdParamsSchema = z.object({ id: uuidSchema });
export type ProductIdParams = z.infer<typeof productIdParamsSchema>;

// ========== GET /api/waves ==========

const waveStatusValues = Object.values(WAVE_STATUS) as [string, ...string[]];

/** waves.strategy_type 存的是大写值（GenerateWaveUseCase 写入前会 toUpperCase()），过滤条件需要匹配同样的大小写 */
const waveStrategyTypeValues = ['BATCH', 'ZONE', 'CLUSTER', 'WAVE'] as const;

export const listWavesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(waveStatusValues).optional(),
  strategyType: z.enum(waveStrategyTypeValues).optional(),
});

export type ListWavesQuery = z.infer<typeof listWavesQuerySchema>;

// ========== POST /api/waves/generate ==========

export const generateWaveBodySchema = z.object({
  strategyType: z.enum(['batch', 'zone', 'cluster', 'wave']),
  orderIds: z.array(uuidSchema).min(1, 'At least one order id required'),
  config: z.object({
    maxOrders: positiveIntSchema.optional(),
    maxLines: positiveIntSchema.optional(),
    maxQty: positiveIntSchema.optional(),
    zoneSequence: z.array(z.string()).optional(),
  }).optional(),
});

export type GenerateWaveBody = z.infer<typeof generateWaveBodySchema>;

// ========== 验证中间件 ==========

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({ error: 'Validation failed', details: result.error.flatten().fieldErrors });
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(422).json({ error: 'Validation failed', details: result.error.flatten().fieldErrors });
    }
    req.query = result.data as any;
    next();
  };
}

export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(422).json({ error: 'Validation failed', details: result.error.flatten().fieldErrors });
    }
    req.params = result.data as any;
    next();
  };
}

// ========== Sprint 4: 出库闭环 ==========

export const updateOrderStatusBodySchema = z.object({
  status: z.enum(['PENDING', 'ALLOCATED', 'PICKING', 'PACKING', 'SORTING', 'LOADING', 'SHIPPED', 'CANCELLED']),
});
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusBodySchema>;

export const createShippingDocBodySchema = z.object({
  orderIds: z.array(uuidSchema).min(1),
  carrierId: uuidSchema.optional(),
  trackingNumber: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateShippingDocBody = z.infer<typeof createShippingDocBodySchema>;

export const handoverShippingBodySchema = z.object({
  carrierName: z.string().min(1),
  driverName: z.string().optional(),
  vehiclePlate: z.string().optional(),
  signedBy: z.string().optional(),
});
export type HandoverShippingBody = z.infer<typeof handoverShippingBodySchema>;

export const createVehicleBodySchema = z.object({
  plateNumber: z.string().min(1),
  vehicleType: z.string().optional(),
  carrierName: z.string().optional(),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
});
export type CreateVehicleBody = z.infer<typeof createVehicleBodySchema>;

export const createWorkOrderBodySchema = z.object({
  orderId: uuidSchema,
  type: z.enum(['picking', 'packing', 'sorting', 'loading', 'putaway', 'count']),
  assignedTo: uuidSchema.optional(),
  priority: z.number().int().min(0).max(100).optional(),
  notes: z.string().optional(),
});
export type CreateWorkOrderBody = z.infer<typeof createWorkOrderBodySchema>;

export const assignWorkOrderBodySchema = z.object({
  assigneeId: uuidSchema,
});
export type AssignWorkOrderBody = z.infer<typeof assignWorkOrderBodySchema>;

export const updateWorkOrderStatusBodySchema = z.object({
  status: z.enum(['pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'blocked']),
  notes: z.string().optional(),
});
export type UpdateWorkOrderStatusBody = z.infer<typeof updateWorkOrderStatusBodySchema>;

export const updateWaveStatusBodySchema = z.object({
  status: z.enum(['PENDING', 'RELEASED', 'ALLOCATING', 'ALLOCATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
});
export type UpdateWaveStatusBody = z.infer<typeof updateWaveStatusBodySchema>;

export const addOrdersToWaveBodySchema = z.object({
  orderIds: z.array(uuidSchema).min(1, 'At least one order id required'),
});
export type AddOrdersToWaveBody = z.infer<typeof addOrdersToWaveBodySchema>;

export const waveIdParamsSchema = z.object({ id: uuidSchema });
export type WaveIdParams = z.infer<typeof waveIdParamsSchema>;

export const workOrderIdParamsSchema = z.object({ id: uuidSchema });
export type WorkOrderIdParams = z.infer<typeof workOrderIdParamsSchema>;

export const shippingDocIdParamsSchema = z.object({ id: uuidSchema });
export type ShippingDocIdParams = z.infer<typeof shippingDocIdParamsSchema>;

export const vehicleIdParamsSchema = z.object({ id: uuidSchema });
export type VehicleIdParams = z.infer<typeof vehicleIdParamsSchema>;

export const listWorkOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(['pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'blocked']).optional(),
  type: z.enum(['picking', 'packing', 'sorting', 'loading', 'putaway', 'count']).optional(),
});
export type ListWorkOrdersQuery = z.infer<typeof listWorkOrdersQuerySchema>;

export const listVehiclesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;

export const listShippingDocsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(['draft', 'issued', 'in_transit', 'delivered', 'cancelled']).optional(),
});
export type ListShippingDocsQuery = z.infer<typeof listShippingDocsQuerySchema>;

// ===== Sprint 5: 入库全链路（ASN→收货→质检→上架） =====

const inboundReceiptStatusValues = Object.values(INBOUND_RECEIPT_STATUS) as [string, ...string[]];
const qualityInspectionResultValues = Object.values(QUALITY_INSPECTION_RESULT) as [string, ...string[]];

// --- ASN ---
export const createAsnBodySchema = z.object({
  receiptNo: z.string().min(1),
  supplierName: z.string().min(1).optional(),
  expectedAt: isoDateTimeSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAsnBody = z.infer<typeof createAsnBodySchema>;

export const listAsnQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(inboundReceiptStatusValues).optional(),
  supplierName: z.string().optional(),
});
export type ListAsnQuery = z.infer<typeof listAsnQuerySchema>;

export const asnIdParamsSchema = z.object({ id: uuidSchema });
export type AsnIdParams = z.infer<typeof asnIdParamsSchema>;

// --- 入库单 ---
export const createInboundReceiptBodySchema = z.object({
  receiptNo: z.string().min(1),
  supplierName: z.string().min(1).optional(),
  expectedAt: isoDateTimeSchema.optional(),
  waveId: uuidSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateInboundReceiptBody = z.infer<typeof createInboundReceiptBodySchema>;

export const listInboundReceiptsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(inboundReceiptStatusValues).optional(),
  supplierName: z.string().optional(),
});
export type ListInboundReceiptsQuery = z.infer<typeof listInboundReceiptsQuerySchema>;

export const inboundReceiptIdParamsSchema = z.object({ id: uuidSchema });
export type InboundReceiptIdParams = z.infer<typeof inboundReceiptIdParamsSchema>;

export const updateInboundReceiptStatusBodySchema = z.object({
  status: z.enum(inboundReceiptStatusValues),
});
export type UpdateInboundReceiptStatusBody = z.infer<typeof updateInboundReceiptStatusBodySchema>;

export const receiveInboundReceiptBodySchema = z.object({
  receivedAt: isoDateTimeSchema.optional(),
});
export type ReceiveInboundReceiptBody = z.infer<typeof receiveInboundReceiptBodySchema>;

export const putawayInboundReceiptBodySchema = z.object({
  assignedUserId: uuidSchema.optional(),
});
export type PutawayInboundReceiptBody = z.infer<typeof putawayInboundReceiptBodySchema>;

// --- 质检单 ---
export const createQualityInspectionBodySchema = z.object({
  inspectionNo: z.string().min(1),
  orderId: uuidSchema.optional(),
  waveId: uuidSchema.optional(),
  skuId: uuidSchema.optional(),
  inspectorId: uuidSchema.optional(),
  deviceId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateQualityInspectionBody = z.infer<typeof createQualityInspectionBodySchema>;

export const listQualityInspectionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.string().optional(),
  result: z.enum(qualityInspectionResultValues).optional(),
  orderId: uuidSchema.optional(),
  waveId: uuidSchema.optional(),
});
export type ListQualityInspectionsQuery = z.infer<typeof listQualityInspectionsQuerySchema>;

export const qualityInspectionIdParamsSchema = z.object({ id: uuidSchema });
export type QualityInspectionIdParams = z.infer<typeof qualityInspectionIdParamsSchema>;

export const inspectionItemSchema = z.object({
  checkType: z.string().min(1),
  expectedValue: z.unknown().optional(),
  tolerancePct: z.number().optional(),
  notes: z.string().optional(),
});

export const addInspectionItemsBodySchema = z.object({
  items: z.array(inspectionItemSchema).min(1, 'At least one inspection item required'),
});
export type AddInspectionItemsBody = z.infer<typeof addInspectionItemsBodySchema>;

export const recordInspectionResultBodySchema = z.object({
  result: z.enum(qualityInspectionResultValues),
  discrepancyDetails: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
});
export type RecordInspectionResultBody = z.infer<typeof recordInspectionResultBodySchema>;

// ===== Sprint 6: 库存操作 + 主数据（库位/容器/商品写） =====

// --- 库存写操作 ---
export const adjustInventoryBodySchema = z.object({
  productId: uuidSchema,
  locationId: uuidSchema,
  quantityDelta: z.number().int(),
  reason: z.string().min(1),
  referenceId: uuidSchema.optional(),
  referenceType: z.enum(['manual', 'return', 'damage', 'found', 'correction']).optional(),
});
export type AdjustInventoryBody = z.infer<typeof adjustInventoryBodySchema>;

export const transferInventoryBodySchema = z.object({
  productId: uuidSchema,
  fromLocationId: uuidSchema,
  toLocationId: uuidSchema,
  quantity: positiveIntSchema,
  reason: z.string().min(1),
  referenceId: uuidSchema.optional(),
});
export type TransferInventoryBody = z.infer<typeof transferInventoryBodySchema>;

export const reserveInventoryBodySchema = z.object({
  productId: uuidSchema,
  locationId: uuidSchema,
  quantity: positiveIntSchema,
  orderId: uuidSchema.optional(),
  workOrderId: uuidSchema.optional(),
  expiresAt: isoDateTimeSchema.optional(),
});
export type ReserveInventoryBody = z.infer<typeof reserveInventoryBodySchema>;

export const lockInventoryBodySchema = z.object({
  productId: uuidSchema,
  locationId: uuidSchema,
  quantity: positiveIntSchema,
  reason: z.string().min(1),
  lockedBy: uuidSchema.optional(),
  expiresAt: isoDateTimeSchema.optional(),
});
export type LockInventoryBody = z.infer<typeof lockInventoryBodySchema>;

export const inventoryIdParamsSchema = z.object({ id: uuidSchema });
export type InventoryIdParams = z.infer<typeof inventoryIdParamsSchema>;

export const listInventoryHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  productId: uuidSchema.optional(),
  locationId: uuidSchema.optional(),
  startDate: isoDateTimeSchema.optional(),
  endDate: isoDateTimeSchema.optional(),
});
export type ListInventoryHistoryQuery = z.infer<typeof listInventoryHistoryQuerySchema>;

export const getAvailableInventoryQuerySchema = z.object({
  productId: uuidSchema,
  locationId: uuidSchema.optional(),
  excludeReserved: z.coerce.boolean().default(true),
  excludeLocked: z.coerce.boolean().default(true),
});
export type GetAvailableInventoryQuery = z.infer<typeof getAvailableInventoryQuerySchema>;

// --- 库位 CRUD + 状态/容量/利用率 ---
export const createLocationBodySchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().max(100).optional(),
  zoneId: uuidSchema.optional(),
  zoneType: z.enum(['picking', 'storage', 'staging', 'receiving', 'shipping', 'cold', 'dangerous', 'value_added']).optional(),
  aisle: z.string().max(20).optional(),
  rack: z.string().max(20).optional(),
  level: z.string().max(20).optional(),
  position: z.string().max(20).optional(),
  maxVolumeCapacity: z.number().nonnegative().optional(),
  maxWeightCapacity: z.number().nonnegative().optional(),
  pickingMaxQty: z.number().int().positive().optional(),
  pickingThresholdPct: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().default(true),
  isFrozen: z.boolean().default(false),
  forceUniqueTracking: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateLocationBody = z.infer<typeof createLocationBodySchema>;

export const updateLocationBodySchema = z.object({
  name: z.string().max(100).optional(),
  zoneId: uuidSchema.optional(),
  zoneType: z.enum(['picking', 'storage', 'staging', 'receiving', 'shipping', 'cold', 'dangerous', 'value_added']).optional(),
  aisle: z.string().max(20).optional(),
  rack: z.string().max(20).optional(),
  level: z.string().max(20).optional(),
  position: z.string().max(20).optional(),
  maxVolumeCapacity: z.number().nonnegative().optional(),
  maxWeightCapacity: z.number().nonnegative().optional(),
  pickingMaxQty: z.number().int().positive().optional(),
  pickingThresholdPct: z.number().int().min(0).max(100).optional(),
  forceUniqueTracking: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateLocationBody = z.infer<typeof updateLocationBodySchema>;

export const listLocationsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  zoneId: uuidSchema.optional(),
  zoneType: z.enum(['picking', 'storage', 'staging', 'receiving', 'shipping', 'cold', 'dangerous', 'value_added']).optional(),
  isActive: z.coerce.boolean().optional(),
  isFrozen: z.coerce.boolean().optional(),
});
export type ListLocationsQuery = z.infer<typeof listLocationsQuerySchema>;

export const locationIdParamsSchema = z.object({ id: uuidSchema });
export type LocationIdParams = z.infer<typeof locationIdParamsSchema>;

export const updateLocationStatusBodySchema = z.object({
  isActive: z.boolean(),
  isFrozen: z.boolean().optional(),
});
export type UpdateLocationStatusBody = z.infer<typeof updateLocationStatusBodySchema>;

export const updateLocationCapacityBodySchema = z.object({
  maxVolume: z.number().nonnegative().optional(),
  maxWeight: z.number().nonnegative().optional(),
  pickingMaxQty: z.number().int().positive().optional(),
  pickingThresholdPct: z.number().int().min(0).max(100).optional(),
});
export type UpdateLocationCapacityBody = z.infer<typeof updateLocationCapacityBodySchema>;

// --- 容器 CRUD + 封箱/移动/内容物/层级树/LPN ---
export const createContainerBodySchema = z.object({
  lpnCode: z.string().min(1).max(50),
  containerType: z.enum(['pallet', 'box', 'tote', 'carton', 'bin', 'case']).optional(),
  parentContainerId: uuidSchema.optional(),
  maxVolume: z.number().nonnegative().optional(),
  maxWeight: z.number().nonnegative().optional(),
  status: z.enum(['IDLE', 'IN_USE', 'SEALED', 'SHIPPED', 'RECEIVED', 'DISPOSED']).default('IDLE'),
  isSealed: z.boolean().default(false),
  lpnSource: z.enum(['client', 'internal', 'generated']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateContainerBody = z.infer<typeof createContainerBodySchema>;

export const updateContainerBodySchema = z.object({
  containerType: z.enum(['pallet', 'box', 'tote', 'carton', 'bin', 'case']).optional(),
  parentContainerId: uuidSchema.optional(),
  maxVolume: z.number().nonnegative().optional(),
  maxWeight: z.number().nonnegative().optional(),
  lpnSource: z.enum(['client', 'internal', 'generated']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateContainerBody = z.infer<typeof updateContainerBodySchema>;

export const listContainersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(['IDLE', 'IN_USE', 'SEALED', 'SHIPPED', 'RECEIVED', 'DISPOSED']).optional(),
  containerType: z.enum(['pallet', 'box', 'tote', 'carton', 'bin', 'case']).optional(),
});
export type ListContainersQuery = z.infer<typeof listContainersQuerySchema>;

export const containerIdParamsSchema = z.object({ id: uuidSchema });
export type ContainerIdParams = z.infer<typeof containerIdParamsSchema>;

export const sealContainerBodySchema = z.object({
  isSealed: z.boolean(),
});
export type SealContainerBody = z.infer<typeof sealContainerBodySchema>;

export const moveContainerBodySchema = z.object({
  parentContainerId: uuidSchema.nullable(),
});
export type MoveContainerBody = z.infer<typeof moveContainerBodySchema>;

export const containerContentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  includeNested: z.coerce.boolean().default(false),
});
export type ContainerContentsQuery = z.infer<typeof containerContentsQuerySchema>;

export const lpnQueryParamsSchema = z.object({
  lpnCode: z.string().min(1),
});
export type LpnQueryParams = z.infer<typeof lpnQueryParamsSchema>;

// --- 商品写操作 CRUD + 条码/约束/ABC分类 ---
export const createProductBodySchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  baseUom: z.string().min(1).max(20).default('PCS'),
  abcClass: z.enum(['A', 'B', 'C']).default('C'),
  volumePerUnit: z.number().nonnegative().optional(),
  weightPerUnit: z.number().nonnegative().optional(),
  shelfLifeDays: z.number().int().positive().optional(),
  requiresUniqueTracking: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateProductBody = z.infer<typeof createProductBodySchema>;

export const updateProductBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  baseUom: z.string().min(1).max(20).optional(),
  abcClass: z.enum(['A', 'B', 'C']).optional(),
  volumePerUnit: z.number().nonnegative().optional(),
  weightPerUnit: z.number().nonnegative().optional(),
  shelfLifeDays: z.number().int().positive().optional(),
  requiresUniqueTracking: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

export const addProductBarcodeBodySchema = z.object({
  barcode: z.string().min(1).max(100),
  targetType: z.enum(['product', 'sku', 'batch', 'serial']),
  targetSubtype: z.string().optional(),
  isPrimary: z.boolean().default(false),
});
export type AddProductBarcodeBody = z.infer<typeof addProductBarcodeBodySchema>;

export const listProductBarcodesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListProductBarcodesQuery = z.infer<typeof listProductBarcodesQuerySchema>;

export const productConstraintBodySchema = z.object({
  constraintType: z.enum(['location_type', 'temperature', 'hazardous', 'segregation']),
  constraintValue: z.string().min(1),
  severity: z.enum(['error', 'warning']).default('error'),
});
export type ProductConstraintBody = z.infer<typeof productConstraintBodySchema>;

export const updateProductAbcClassBodySchema = z.object({
  abcClass: z.enum(['A', 'B', 'C']),
});
export type UpdateProductAbcClassBody = z.infer<typeof updateProductAbcClassBodySchema>;
