/// <reference types="express" />
/**
 * Express 中间件工厂
 * 为所有 Express 入口复用统一的中间件逻辑
 */
import type { Request, Response, NextFunction } from 'express';
import { IAuthProvider } from '../../core/ports/auth/IAuthProvider';
import { IPermissionChecker } from '../../core/ports/auth/IPermissionChecker';
import { ITenantResolver } from '../../core/ports/auth/ITenantResolver';
import { ICacheProvider } from '../../core/ports/cache/ICacheProvider';
import { ICacheKeyBuilder } from '../../core/ports/cache/ICacheKeyBuilder';

export interface ExpressRequestContext {
  user?: {
    id: string;
    tenantId: string | null;
    isSystemUser: boolean;
    roles: string[];
    permissions: string[];
  };
  tenantId?: string | null;
  correlationId?: string;
}

/** 扩展 Express Request 类型 */
declare global {
  namespace Express {
    interface Request {
      context?: ExpressRequestContext;
    }
  }
}

export class ExpressMiddlewareFactory {
  constructor(
    private authProvider: IAuthProvider,
    private permissionChecker: IPermissionChecker,
    private tenantResolver: ITenantResolver,
    private cacheProvider: ICacheProvider,
    private cacheKeyBuilder: ICacheKeyBuilder
  ) {}

  /** 认证中间件：验证 JWT 并注入用户上下文 */
  authenticate() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const token = authHeader.slice(7);
        const user = await this.authProvider.verifyToken(token);

        if (!user) {
          return res.status(401).json({ error: 'Invalid or expired token' });
        }

        req.context = {
          user: {
            id: user.userId,
            tenantId: user.tenantId,
            isSystemUser: user.isSystemUser,
            roles: user.roles,
            permissions: user.permissions,
          },
          correlationId: (req.headers['x-correlation-id'] as string) || `req-${Date.now()}`,
        };

        next();
      } catch (error) {
        res.status(500).json({ error: 'Authentication error' });
      }
    };
  }

  /** 租户解析中间件：解析并验证租户上下文 */
  resolveTenant() {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!req.context?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      try {
        const tenantId = await this.tenantResolver.resolveFromRequest({
          headers: req.headers as Record<string, string>,
          query: req.query as Record<string, string>,
          user: {
            id: req.context.user.id,
            tenantId: req.context.user.tenantId ?? undefined,
          },
        });

        if (!tenantId && !req.context.user.isSystemUser) {
          return res.status(403).json({ error: 'Tenant context required' });
        }

        // 验证租户有效性
        if (tenantId) {
          const isValid = await this.tenantResolver.validateTenant(tenantId);
          if (!isValid) {
            return res.status(403).json({ error: 'Invalid or inactive tenant' });
          }
        }

        req.context.tenantId = tenantId;
        next();
      } catch (error) {
        res.status(500).json({ error: 'Tenant resolution error' });
      }
    };
  }

  /** 权限检查中间件：基于资源和动作 */
  requirePermission(resource: string, action: string, scope?: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!req.context?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // 系统用户跳过权限检查
      if (req.context.user.isSystemUser) {
        return next();
      }

      try {
        const hasPermission = await this.permissionChecker.check({
          userId: req.context.user.id,
          resource,
          action,
          scope: scope ?? 'tenant',
        });

        if (!hasPermission) {
          return res.status(403).json({
            error: 'Insufficient permissions',
            required: { resource, action, scope: scope ?? 'tenant' },
          });
        }

        next();
      } catch (error) {
        res.status(500).json({ error: 'Permission check failed' });
      }
    };
  }

  /** RLS 上下文注入中间件：为 Supabase 客户端设置租户上下文 */
  injectRlsContext() {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (req.context?.tenantId) {
        // 设置请求级别的 RLS 上下文
        // 实际使用时，在 Supabase 客户端调用前设置
        (req as any).rlsContext = { tenantId: req.context.tenantId };
      }
      next();
    };
  }

  /** 限流中间件 */
  rateLimit(options: {
    windowMs: number;
    maxRequests: number;
    keyGenerator?: (req: Request) => string;
  }) {
    const { windowMs, maxRequests, keyGenerator } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
      const key = keyGenerator
        ? keyGenerator(req)
        : this.cacheKeyBuilder.rateLimit(req.ip ?? 'unknown', `${windowMs}ms`);

      const current = await this.cacheProvider.increment(key);
      if (current === 1) {
        await this.cacheProvider.expire(key, Math.ceil(windowMs / 1000));
      }

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current));

      if (current > maxRequests) {
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil(windowMs / 1000),
        });
      }

      next();
    };
  }

  /** 请求缓存中间件（GET 请求） */
  cache(options: {
    ttlSeconds: number;
    keyGenerator?: (req: Request) => string;
  }) {
    const { ttlSeconds, keyGenerator } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') return next();

      const key = keyGenerator
        ? keyGenerator(req)
        : this.cacheKeyBuilder.build('http', req.path, JSON.stringify(req.query));

      const cached = await this.cacheProvider.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }

      // 拦截 res.json 缓存响应
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (res.statusCode === 200) {
          this.cacheProvider.set(key, body, ttlSeconds);
        }
        return originalJson(body);
      };

      res.setHeader('X-Cache', 'MISS');
      next();
    };
  }

  /** 关联 ID 传播中间件 */
  correlationId() {
    return (req: Request, res: Response, next: NextFunction) => {
      const correlationId = (req.headers['x-correlation-id'] as string) || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      req.context = req.context || {};
      req.context.correlationId = correlationId;
      res.setHeader('X-Correlation-ID', correlationId);
      next();
    };
  }

  /** 错误处理中间件 */
  errorHandler() {
    return (err: Error, req: Request, res: Response, next: NextFunction) => {
      const correlationId = req.context?.correlationId || 'unknown';

      console.error(`[${correlationId}] Error:`, err);

      // 已知错误类型处理
      if (err.name === 'RpcError') {
        return res.status(400).json({
          error: err.message,
          correlationId,
        });
      }

      if (err.name === 'ValidationError') {
        return res.status(422).json({
          error: 'Validation failed',
          details: err.message,
          correlationId,
        });
      }

      // 默认服务器错误
      res.status(500).json({
        error: 'Internal server error',
        correlationId,
      });
    };
  }
}