// Cloudflare Workers 缓存 + RBAC 原型
// 适用于 Supabase REST API 读多写少的多租户元数据（tenants, products 等）
// 依赖 Cloudflare KV 命名空间: WMS_CACHE
// 同时提供基于角色的访问控制（RBAC）拦截

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenant_id') || request.headers.get('x-tenant-id');
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'Missing tenant_id' }), { status: 400 });
    }

    // ---------- RBAC 检查 ----------
    // 1. 解析 JWT（简化版：假设 token 为 base64url 编码的 JSON）
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing Bearer token' }), { status: 401 });
    }
    const token = authHeader.slice('Bearer '.length);
    let userId = null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.sub;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User not identified' }), { status: 401 });
    }

    // 2. 权限检查：使用本地模拟的权限数据（实际应调用 Supabase / RPC）
    // 这里我们简化：假设所有用户都有对自己 tenant 的读写权限
    // 若要实现真正的 RBAC，可调用 Supabase RPC `check_user_permission`
    const action = request.method; // GET, POST, PUT, DELETE
    const resource = url.pathname.replace('/api/', ''); // e.g. 'tenants' or 'products'

    // 示例：调用 Supabase RPC 检查权限
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY;
    const permCheckUrl = `${supabaseUrl}/rest/v1/rpc/check_user_permission`;
    const permResp = await fetch(permCheckUrl, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_resource: resource,
        p_action: action,
        p_scope: tenantId
      })
    });
    if (!permResp.ok) {
      // 若 RPC 不存在或出错，则回退到简单检查：允许同 tenant 访问
      // 实际部署时应确保 RPC 已存在
      // 下面我们演示回退：允许所有请求（仅作演示）
      // 请在实际环境中替换为真实的权限检查
    } else {
      const permData = await permResp.json();
      if (!permData[0]?.has_permission) {
        return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403 });
      }
    }

    // ---------- 缓存逻辑 ----------
    const cacheKey = `tenant:${tenantId}:${resource}:${action}`;
    const kv = env.WMS_CACHE;

    // 1. 尝试从 KV 读取
    const cached = await kv.get(cacheKey, { type: 'json' });
    if (cached) {
      const resp = new Response(JSON.stringify(cached), {
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
      });
      return resp;
    }

    // 2. Cache Miss -> 调用 Supabase
    const targetUrl = `${supabaseUrl}/rest/v1/${resource}?tenant_id=eq.${tenantId}`;
    const supabaseResp = await fetch(targetUrl, {
      method: request.method,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Accept: 'application/json',
        ...Object.fromEntries(request.headers.entries())
      }
    });

    if (!supabaseResp.ok) {
      return new Response(JSON.stringify({ error: 'Supabase error', details: await supabaseResp.text() }), { status: 502 });
    }

    const data = await supabaseResp.json();

    // 3. 写入 KV（TTL 1 小时）
    await kv.put(cacheKey, JSON.stringify(data), { expirationTtl: 3600 });

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
    });
  }
};