/**
 * Device API 请求验证 Schemas
 * 基于 SYNC_API_CONTRACT.md 和 DEVICE_PROTOCOL_SPEC.md 定义
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

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
  /** 动作类型：PICK | PUTAWAY | COUNT | PACK | RECEIVE | SHIP | REPLENISH | MOVE | ADJUST */
  action_type: z.enum(['PICK', 'PUTAWAY', 'COUNT', 'PACK', 'RECEIVE', 'SHIP', 'REPLENISH', 'MOVE', 'ADJUST']),
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
  /** 任务类型：PICK | PUTAWAY | COUNT | PACK | RECEIVE | LOAD | INVENTORY | MISSING_LABEL | UNIDENTIFIED */
  task_type: z.enum(['PICK', 'PUTAWAY', 'COUNT', 'PACK', 'RECEIVE', 'LOAD', 'INVENTORY', 'MISSING_LABEL', 'UNIDENTIFIED']).optional(),
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

// ========== Layer 3: PUTAWAY/COUNT/PACK Actions ==========

/**
 * PUTAWAY 动作 payload
 * serial_number（可选）：序列化商品（products.is_serial_required = TRUE）必须提供，
 * 否则 fn_apply_putaway_action 会拒绝并登记异常，见
 * supabase/migrations/007_zone_location_serial_tracking.sql §4。
 * 非序列化商品不受影响，字段留空即可。
 *
 * 注：PICK 动作没有独立的 REST 端点/校验 schema——PDA 端只能通过通用的
 * POST /sync/events（action_type = 'PICK'，payload 为 z.record(...) 任意 JSON）
 * 提交拣货事件，该 payload 本就不做结构限制，serial_number 已经可以随意携带，
 * 不需要在这里补 pickRequestSchema。
 */
export const putawayRequestSchema = z.object({
  /** SKU ID */
  sku_id: uuidSchema,
  /** 库位 ID */
  location_id: uuidSchema,
  /** 数量 */
  qty: positiveIntSchema,
  /** LPN/容器 ID */
  lpn_id: uuidSchema.optional(),
  /** 批次/效期 */
  batch_id: uuidSchema.optional(),
  expiry_date: isoDateTimeSchema.optional(),
  /** 序列号（序列化商品必填，见上方说明） */
  serial_number: z.string().min(1).optional(),
});

/** COUNT 动作 payload */
export const countRequestSchema = z.object({
  /** SKU ID */
  sku_id: uuidSchema,
  /** 库位 ID */
  location_id: uuidSchema,
  /** 实盘数量 */
  actual_qty: z.number().int().nonnegative(),
  /** 单据 ID（可选） */
  count_task_id: uuidSchema.optional(),
});

/** PACK 动作 payload */
export const packRequestSchema = z.object({
  /** 装箱任务 ID */
  packing_task_id: uuidSchema,
  /** 容器/箱 ID */
  container_id: uuidSchema,
  /** SKU 明细 */
  items: z.array(z.object({
    sku_id: uuidSchema,
    qty: positiveIntSchema,
    batch_id: uuidSchema.optional(),
    expiry_date: isoDateTimeSchema.optional(),
  })).min(1),
});

/** RECEIVE 动作 payload */
export const receiveRequestSchema = z.object({
  /** 入库单 ID */
  receipt_id: uuidSchema.optional(),
  /** ASN ID */
  asn_id: uuidSchema.optional(),
  /** 明细 */
  items: z.array(z.object({
    sku_id: uuidSchema,
    qty: positiveIntSchema,
    batch_id: uuidSchema.optional(),
    expiry_date: isoDateTimeSchema.optional(),
    lpn_id: uuidSchema.optional(),
  })).min(1),
});

// ========== Layer 4: Missing Label / Unidentified Goods ==========

/** 生成内部 LPN 请求 */
// 注意：actor_user_id 同 missingLabelConfirmSchema 等，改由 req.context.userId 派生。
export const missingLabelGenerateSchema = z.object({
  /** 异常 ID */
  exception_id: uuidSchema,
});

/** 确认贴标请求 */
// 注意：resolver_user_id 不再作为客户端输入字段——2026-07-23 复核发现如果信任
// 客户端自报的身份，可以伪造成其他用户完成异常处理，审计轨迹被污染。改由
// routes.ts 从 DeviceAuthMiddleware 已验证的 req.context.userId 派生。
export const missingLabelConfirmSchema = z.object({
  /** 异常 ID */
  exception_id: uuidSchema,
  /** 扫描的 LPN 码 */
  scanned_lpn_code: z.string().min(1),
});

/** 接收未识别货物请求 */
// 注意：actor_user_id 同上，改由 req.context.userId 派生（保持可选，纯设备
// 认证场景下 context.userId 本就可能不存在）。
export const unidentifiedReceiveSchema = z.object({
  /** 租户 ID */
  tenant_id: uuidSchema,
  /** 库位 ID */
  location_id: uuidSchema,
  /** 数量 */
  qty: positiveIntSchema,
  /** 备注 */
  note: z.string().optional(),
});

/** 确认未识别货物身份请求 */
// 注意：resolver_user_id 同上，改由 req.context.userId 派生。
export const unidentifiedIdentifySchema = z.object({
  /** 异常 ID */
  exception_id: uuidSchema,
  /** 确认的商品 ID */
  confirmed_product_id: uuidSchema,
});

export type PutawayAction = z.infer<typeof putawayRequestSchema>;
export type CountAction = z.infer<typeof countRequestSchema>;
export type PackAction = z.infer<typeof packRequestSchema>;
export type ReceiveAction = z.infer<typeof receiveRequestSchema>;

export type GenerateInternalLpnRequest = z.infer<typeof missingLabelGenerateSchema>;
export type ConfirmLabelAppliedRequest = z.infer<typeof missingLabelConfirmSchema>;
export type ReceiveUnidentifiedGoodsRequest = z.infer<typeof unidentifiedReceiveSchema>;
export type IdentifyUnidentifiedGoodsRequest = z.infer<typeof unidentifiedIdentifySchema>;

// ========== ADR-019: 设备认证端点 ==========

/** 设备注册请求（租户运营自助配发） */
export const deviceProvisionSchema = z.object({
  /** 设备编码（人类可读，如 PDA-WH-001） */
  device_code: z.string().min(1).max(64),
  /** 设备类型 */
  device_type: z.enum(['PDA', 'SCANNER', 'PRINTER', 'RFID_READER', 'MOUNTED', 'OTHER']),
  /** 备注 */
  note: z.string().optional(),
});

/** 设备登录请求 */
export const deviceLoginSchema = z.object({
  /** 设备 ID */
  device_id: uuidSchema,
  /** API Key: hiwms_dk_<device_id>_<secret> */
  api_key: z.string().min(1).startsWith('hiwms_dk_'),
  /** FCM 推送 token（可选） */
  fcm_token: z.string().optional(),
  /** App 版本 */
  app_version: z.string().optional(),
  /** OS 版本 */
  os_version: z.string().optional(),
  /** 设备型号 */
  device_model: z.string().optional(),
});

/** 刷新 Token 请求 */
export const deviceRefreshSchema = z.object({
  /** Refresh Token */
  refresh_token: z.string().min(1),
});

export type DeviceProvisionRequest = z.infer<typeof deviceProvisionSchema>;
export type DeviceLoginRequest = z.infer<typeof deviceLoginSchema>;
export type DeviceRefreshRequest = z.infer<typeof deviceRefreshSchema>;

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