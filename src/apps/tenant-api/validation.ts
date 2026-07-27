/**
 * Tenant API 请求验证 Schemas
 */
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { ORDER_STATUS } from '../../core/constants/status';

// ========== 通用类型 ==========

export const uuidSchema = z.string().uuid({ message: 'Must be a valid UUID' });
export const isoDateTimeSchema = z.string().datetime({ offset: true, message: 'Must be a valid ISO 8601 datetime' });
export const positiveIntSchema = z.number().int().positive();
export const nonNegativeIntSchema = z.number().int().nonnegative();

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
