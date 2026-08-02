/**
 * Tenant API 请求验证 Schemas
 */
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { ORDER_STATUS, WAVE_STATUS } from '../../core/constants/status';

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
