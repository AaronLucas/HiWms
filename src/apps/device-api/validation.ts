/**
 * Device API 请求验证 Schemas
 * 基于 SYNC_API_CONTRACT.md 和 DEVICE_PROTOCOL_SPEC.md 定义
 */

import { z } from 'zod';

// ========== 通用类型 ==========

/** UUID 格式验证 */
export const uuidSchema = z.string().uuid({ message: 'Must be a valid UUID' });

/** ISO 8601 日期时间字符串 */
export const isoDateTimeSchema = z.string().datetime({ offset: true, message: 'Must be a valid ISO 8601 datetime' });

/** 正整数 */
export const positiveIntSchema = z.number().int().positive();

/** 非负整数 */
export const nonNegativeIntSchema = z.number().int().nonnegative();

// ========== /sync/events ==========

/** 单个同步事件 */
export const syncEventSchema = z.object({
  /** 幂等键，PDA 生成 UUID */
  id: uuidSchema,
  /** 设备 ID */
  device_id: uuidSchema,
  /** 设备端单调递增序号 */
  device_seq: positiveIntSchema,
  /** 动作类型：PICK | PUTAWAY | COUNT | PACK */
  action_type: z.enum(['PICK', 'PUTAWAY', 'COUNT', 'PACK']),
  /** 结构化业务动作参数 */
  payload: z.record(z.string(), z.unknown()),
  /** 设备本地捕获时间 */
  captured_at: isoDateTimeSchema,
});

/** POST /sync/events 请求体 */
export const syncEventsRequestSchema = z.object({
  events: z.array(syncEventSchema).min(1, 'At least one event required'),
});

export type SyncEventRequest = z.infer<typeof syncEventSchema>;
export type SyncEventsRequest = z.infer<typeof syncEventsRequestSchema>;

// ========== /sync/pull ==========

/** GET /sync/pull 查询参数 */
export const syncPullQuerySchema = z.object({
  /** 游标：拉取 device_seq > since_seq 的已应用事件 */
  since_seq: z.coerce.number().int().nonnegative().default(0),
  /** 单次拉取最大条数 */
  limit: z.coerce.number().int().positive().max(1000).default(100),
});

export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

// ========== /sync/policy ==========

/** GET /sync/policy 查询参数 */
export const syncPolicyQuerySchema = z.object({
  /** 任务类型：PICK | PUTAWAY | COUNT | PACK | RECEIVE | LOAD | INVENTORY */
  task_type: z.enum(['PICK', 'PUTAWAY', 'COUNT', 'PACK', 'RECEIVE', 'LOAD', 'INVENTORY']).optional(),
  /** 库位类型：PICK | BULK | CROSS_DOCK | STAGING | COLD | HAZMAT */
  zone_type: z.enum(['PICK', 'BULK', 'CROSS_DOCK', 'STAGING', 'COLD', 'HAZMAT']).optional(),
});

export type SyncPolicyQuery = z.infer<typeof syncPolicyQuerySchema>;

// ========== /tasks/:id/claim ==========

/** POST /tasks/:id/claim 请求体 */
export const taskClaimRequestSchema = z.object({
  /** 操作员用户 ID */
  user_id: uuidSchema,
  /** 设备 ID */
  device_id: uuidSchema,
  /** 租约时长（秒），默认 300 秒 */
  lease_seconds: z.coerce.number().int().positive().max(3600).default(300),
});

/** 路径参数 */
export const taskClaimParamsSchema = z.object({
  id: uuidSchema,
});

export type TaskClaimRequest = z.infer<typeof taskClaimRequestSchema>;
export type TaskClaimParams = z.infer<typeof taskClaimParamsSchema>;

// ========== /tasks/claims/:id/release ==========

/** 路径参数 */
export const taskClaimReleaseParamsSchema = z.object({
  id: uuidSchema,
});

export type TaskClaimReleaseParams = z.infer<typeof taskClaimReleaseParamsSchema>;

// ========== /exceptions ==========

/** 异常状态枚举 */
export const exceptionStatusSchema = z.enum([
  'PENDING_REVIEW',
  'CONFLICT',
  'RESOLVED',
  'DISMISSED',
]);

/** 异常领域枚举 */
export const exceptionDomainSchema = z.enum([
  'INVENTORY',
  'SYNC',
  'COMPLIANCE',
  'TASK',
  'FULFILLMENT',
  'BILLING',
  'OTHER',
]);

/** 异常严重度枚举 */
export const exceptionSeveritySchema = z.enum([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

/** GET /exceptions 查询参数 */
export const exceptionsQuerySchema = z.object({
  status: exceptionStatusSchema.optional(),
  domain: exceptionDomainSchema.optional(),
  severity: exceptionSeveritySchema.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type ExceptionsQuery = z.infer<typeof exceptionsQuerySchema>;

// ========== /exceptions/:id ==========

/** 路径参数 */
export const exceptionParamsSchema = z.object({
  id: uuidSchema,
});

export type ExceptionParams = z.infer<typeof exceptionParamsSchema>;

// ========== 验证中间件工厂 ==========

import type { Request, Response, NextFunction } from 'express';

/**
 * 创建请求体验证中间件
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * 创建查询参数验证中间件
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    req.query = result.data as any;
    next();
  };
}

/**
 * 创建路径参数验证中间件
 */
export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    req.params = result.data as any;
    next();
  };
}

/**
 * 组合验证中间件
 */
export function validateRequest(options: {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}) {
  const middlewares: Array<(req: Request, res: Response, next: NextFunction) => void> = [];

  if (options.body) middlewares.push(validateBody(options.body));
  if (options.query) middlewares.push(validateQuery(options.query));
  if (options.params) middlewares.push(validateParams(options.params));

  return (req: Request, res: Response, next: NextFunction) => {
    let index = 0;
    const runMiddleware = () => {
      if (index >= middlewares.length) {
        return next();
      }
      const middleware = middlewares[index++];
      middleware(req, res, (err) => {
        if (err) return next(err);
        runMiddleware();
      });
    };
    runMiddleware();
  };
}