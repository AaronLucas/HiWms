/**
 * Cloudflare Worker 入口
 * 边缘缓存 + 只读查询 + 轻量权限校验
 * 路由：GET /api/cache/*
 */
import { createCloudflareAdapters } from '../../adapters/cloudflare/CloudflareAdapters';

interface CloudflareEnv {
  KV_CACHE: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  RPC_ENDPOINT: string; // 调用 Supabase RPC 的边缘函数或 HTTP 端点
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 初始化适配器
    const adapters = createCloudflareAdapters({
      KV_CACHE: env.KV_CACHE,
      RPC_CLIENT: createRpcClient(env),
    });

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 健康检查
    if (path === '/health') {
      return jsonResponse({ status: 'ok', service: 'cf-worker', timestamp: new Date().toISOString() });
    }

    // 缓存查询：GET /api/cache/*
    if (path.startsWith('/api/cache/') && request.method === 'GET') {
      return handleCacheRequest(request, adapters);
    }

    // 权限检查代理
    if (path === '/api/auth/check-permission' && request.method === 'POST') {
      return handlePermissionCheck(request, adapters);
    }

    // 租户信息查询
    if (path.startsWith('/api/tenants/') && request.method === 'GET') {
      return handleTenantQuery(request, adapters);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

async function handleCacheRequest(request: Request, adapters: any): Promise<Response> {
  const url = new URL(request.url);
  const cacheKey = url.pathname.slice('/api/cache/'.length); // 移除前缀
  const tenantId = request.headers.get('x-tenant-id');

  if (!tenantId) {
    return jsonResponse({ error: 'x-tenant-id header required' }, 400);
  }

  const fullKey = adapters.cache.keyBuilder.buildTenant(tenantId, cacheKey);

  // 尝试从 KV 获取
  const cached = await adapters.cache.provider.get(fullKey);
  if (cached) {
    return jsonResponse(cached, 200, { 'X-Cache': 'HIT', 'X-Cache-Key': fullKey });
  }

  // 缓存未命中：调用 RPC 获取数据（或返回 404 让客户端回源）
  // 这里简化：返回 404，客户端可回源到主 API
  return jsonResponse({ error: 'Cache miss', key: fullKey }, 404, { 'X-Cache': 'MISS' });
}

async function handlePermissionCheck(request: Request, adapters: any): Promise<Response> {
  try {
    const body = await request.json();
    const { userId, resource, action, scope } = body;

    if (!userId || !resource || !action) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const hasPermission = await adapters.auth.permissionChecker.check({
      userId,
      resource,
      action,
      scope,
    });

    return jsonResponse({ hasPermission });
  } catch (error) {
    return jsonResponse({ error: 'Permission check failed' }, 500);
  }
}

async function handleTenantQuery(request: Request, adapters: any): Promise<Response> {
  const url = new URL(request.url);
  const tenantId = url.pathname.split('/api/tenants/')[1];

  if (!tenantId) {
    return jsonResponse({ error: 'Tenant ID required' }, 400);
  }

  const cacheKey = adapters.cache.keyBuilder.buildTenant(tenantId, 'info');
  let tenant = await adapters.cache.provider.get(cacheKey);

  if (!tenant) {
    // 从 RPC 获取（简化）
    tenant = await adapters.rpc.repositories.tenants.findById(tenantId);
    if (tenant) {
      await adapters.cache.provider.set(cacheKey, tenant, 300); // 5分钟缓存
    }
  }

  if (!tenant) {
    return jsonResponse({ error: 'Tenant not found' }, 404);
  }

  return jsonResponse(tenant, 200, { 'X-Cache': tenant ? 'HIT' : 'MISS' });
}

function createRpcClient(env: CloudflareEnv) {
  // 返回一个实现 IRpcClient 接口的对象，通过 HTTP 调用 Supabase Edge Functions
  return {
    stockAllocation: {
      allocate: async (params: any) => {
        const resp = await fetch(`${env.RPC_ENDPOINT}/fn_logic_stock_allocation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
          body: JSON.stringify(params),
        });
        return resp.json();
      },
    },
    crossDock: {
      match: async (params: any) => {
        const resp = await fetch(`${env.RPC_ENDPOINT}/fn_match_cross_dock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
          body: JSON.stringify(params),
        });
        return resp.json();
      },
    },
    weightVerification: {
      verify: async (params: any) => {
        const resp = await fetch(`${env.RPC_ENDPOINT}/fn_verify_weight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
          body: JSON.stringify(params),
        });
        return resp.json();
      },
    },
    billingRule: {
      getActive: async (params: any) => {
        const resp = await fetch(`${env.RPC_ENDPOINT}/fn_get_active_billing_rule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
          body: JSON.stringify(params),
        });
        return resp.json();
      },
    },
    permissionCheck: {
      check: async (params: any) => {
        const resp = await fetch(`${env.RPC_ENDPOINT}/check_user_permission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
          body: JSON.stringify(params),
        });
        return resp.json();
      },
    },
    currentTenant: {
      getCurrentTenantId: async () => {
        const resp = await fetch(`${env.RPC_ENDPOINT}/fn_current_tenant_id`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
          body: JSON.stringify({}),
        });
        return resp.json();
      },
    },
    repositories: {
      tenants: {
        findById: async (id: string) => {
          const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/tenants?id=eq.${id}`, {
            headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
          });
          const data = await resp.json();
          return data[0] || null;
        },
      },
    },
  };
}

function jsonResponse(data: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    },
  });
}