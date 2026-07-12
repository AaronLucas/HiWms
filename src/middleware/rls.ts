/**
 * RLS 兼容中间件
 * Cloudflare Workers / Express 通用
 * 负责从请求中提取 tenant_id 并注入到 Supabase 客户端 / Header
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { RpcClient, getRpcClient, resetRpcClient } from '../supabase/rpc';

/** 请求上下文（框架无关） */
export interface RequestContext {
  /** 租户 ID（从 JWT 或 Header 解析） */
  tenantId?: string;
  /** 用户 ID：请求唯一标识，用于日志追踪 */
  requestId: string;
  /** 原始请求头（用于转发） */
  headers: Record<string, string>;
}

/** 中间件选项 */
export interface RlsMiddlewareOptions {
  /** 是否强制要求 tenant_id（默认 true） */
  requireTenantId?: boolean;
  /** JWT 解析密钥（用于验签，可选） */
  jwtSecret?: string;
  /** 自定义租户提取器 */
  extractTenantId?: (ctx: RequestContext) => string | undefined;
}

/** 默认租户提取器：优先 x-tenant-id Header，其次 JWT app_metadata.tenant_id */
export function defaultExtractTenantId(ctx: RequestContext): string | undefined {
  // 1. 显式 Header（后端 Worker 间调用、测试用）
  if (ctx.headers['x-tenant-id']) {
    return ctx.headers['x-tenant-id'];
  }

  // 2. Authorization Bearer Token (JWT) → 解析 app_metadata.tenant_id
  const auth = ctx.headers['authorization'] ?? ctx.headers['Authorization'];
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.app_metadata?.tenant_id) {
        return payload.app_metadata.tenant_id;
      }
    } catch {
      // JWT 解析失败，忽略
    }
  }

  return undefined;
}

/** 创建带 RLS 上下文的 Supabase 客户端 */
export function createRlsClient(
  ctx: RequestContext,
  options: { useServiceRole?: boolean } = {}
): SupabaseClient<Database> {
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const key = options.useServiceRole
    ? import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    : import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

  if (!url || !key) {
    throw new Error('Missing Supabase env vars');
  }

  const client = createClient<Database>(url, key, {
    global: {
      headers: {
        // 关键：PostgREST 通过此 Header 识别租户，RLS 策略用 auth.jwt() ->> 'tenant_id'
        'x-tenant-id': ctx.tenantId ?? '',
        'x-request-id': ctx.requestId,
      },
    },
  });

  return client;
}

/** 创建带 RLS 上下文的 RPC 客户端 */
export function createRlsRpcClient(ctx: RequestContext): RpcClient {
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

  if (!url || !key) {
    throw new Error('Missing Supabase env vars');
  }

  const rpc = new RpcClient(url, key, ctx.tenantId);
  return rpc;
}

/** 中间件工厂：返回适配不同框架的处理函数 */
export function createRlsMiddleware(options: RlsMiddlewareOptions = {}) {
  const {
    requireTenantId = true,
    extractTenantId = defaultExtractTenantId,
  } = options;

  // Cloudflare Workers 适配
  const handleWorker = async (request: Request, env: Env, ctx: ExecutionContext) => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => headers[k] = v);

    const requestId = headers['x-request-id'] ?? crypto.randomUUID();
    const tenantId = extractTenantId({ tenantId: undefined, requestId, headers });

    const requestCtx: RequestContext = { tenantId, requestId, headers };

    if (requireTenantId && !tenantId) {
      return new Response(JSON.stringify({ error: 'Missing tenant_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 将上下文挂载到 request 上（供后续 handler 使用）
    (request as any).rlsContext = requestCtx;

    // 继续下一个 handler
    return requestCtx;
  };

  // Express/Connect 适配
  const handleExpress = (req: any, res: any, next: () => void) => {
    const headers: Record<string, string> = {};
    Object.keys(req.headers).forEach(k => headers[k] = req.headers[k]);

    const requestId = headers['x-request-id'] ?? crypto.randomUUID();
    const tenantId = extractTenantId({ tenantId: undefined, requestId, headers });

    const requestCtx: RequestContext = { tenantId, requestId, headers };

    if (requireTenantId && !tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    req.rlsContext = requestCtx;
    next();
  };

  // 通用 Fetch 适配（标准 Request/Response）
  const handleFetch = async (request: Request): Promise<RequestContext> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => headers[k] = v);

    const requestId = headers['x-request-id'] ?? crypto.randomUUID();
    const tenantId = extractTenantId({ tenantId: undefined, requestId, headers });

    const requestCtx: RequestContext = { tenantId, requestId, headers };

    if (requireTenantId && !tenantId) {
      throw new Error('Missing tenant_id');
    }

    return requestCtx;
  };

  return {
    handleWorker,
    handleExpress,
    handleFetch,
    createRlsClient,
    createRlsRpcClient,
  };
}

/** 从请求上下文获取 Supabase 客户端（Worker/Express 通用） */
export function getSupabaseFromContext(ctx: RequestContext, useServiceRole = false): SupabaseClient<Database> {
  return createRlsClient(ctx, { useServiceRole });
}

/** 从请求上下文获取 RPC 客户端 */
export function getRpcFromContext(ctx: RequestContext): RpcClient {
  return createRlsRpcClient(ctx);
}

/** 类型导出 */
export type { RequestContext, RlsMiddlewareOptions };
