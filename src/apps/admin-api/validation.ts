/**
 * Admin API 请求验证 Schemas
 */
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// ========== POST /auth/login ==========

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  captchaToken: z.string().optional(),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

// ========== POST /tenants ==========

export const createTenantBodySchema = z.object({
  name: z.string().min(1).max(200),
  billing_strategy: z.record(z.string(), z.unknown()).optional(),
});

export type CreateTenantBody = z.infer<typeof createTenantBodySchema>;

// ========== PATCH /tenants/:id ==========

export const updateTenantBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
  billing_strategy: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateTenantBody = z.infer<typeof updateTenantBodySchema>;

// ========== PATCH /users/:id/password ==========

export const resetPasswordBodySchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

// ========== 验证中间件 ==========

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    next();
  };
}
