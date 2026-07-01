/**
 * 认证与授权拦截器（用于 Cloudflare Worker）
 * 检查租户身份、用户角色以及资源权限
 */
export class AuthMiddleware {
    constructor(roleManager, env) {
        this.roleManager = roleManager;
        this.supabaseUrl = env.SUPABASE_URL;
        this.supabaseAnonKey = env.SUPABASE_ANON_KEY;
    }
    /**
     * 主拦截函数，供 Cloudflare Worker 调用
     */
    async handle(request) {
        try {
            // 1️⃣ 解析租户与用户凭证
            const url = new URL(request.url);
            const tenantId = url.searchParams.get('tenant_id') || request.headers.get('x-tenant-id');
            if (!tenantId) {
                return new Response(JSON.stringify({ error: 'Missing tenant_id' }), { status: 400 });
            }
            // 2️⃣ 从请求头获取认证信息（如 JWT）
            const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return new Response(JSON.stringify({ error: 'Missing Bearer token' }), { status: 401 });
            }
            const token = authHeader.slice('Bearer '.length);
            // 3️⃣ 校验 token（这里简化，实际应使用 JWT 验证）
            let userId = null;
            try {
                const payload = JSON.parse(atob(token.split('.')[1])); // 简易 Base64 解码
                userId = payload.sub;
            }
            catch (e) {
                return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
            }
            if (!userId) {
                return new Response(JSON.stringify({ error: 'User not identified' }), { status: 401 });
            }
            // 4️⃣ 检查租户隔离（所有查询必须绑定 tenant_id）
            // 5️⃣ 如请求需要权限验证（如读取特定资源），执行权限检查
            const action = request.method; // 例如 'GET', 'POST', 'PUT', 'DELETE'
            const resource = url.pathname.slice(1); // 假设路径形如 '/products'
            // 6️⃣ 权限检查（示例：仅允许有 READ 权限的操作）
            const hasPerm = await this.roleManager.hasPermission(userId, resource, action);
            if (!hasPerm) {
                return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403 });
            }
            // 7️⃣ 前往实际业务逻辑（这里仅转发请求给 Supabase）
            const targetUrl = `${this.supabaseUrl}/rest/v1/${resource}?tenant_id=eq.${tenantId}`;
            const supabaseResp = await fetch(targetUrl, {
                method: request.method,
                headers: {
                    apikey: this.supabaseAnonKey,
                    Authorization: `Bearer ${this.supabaseAnonKey}`,
                    ...Object.fromEntries(request.headers.entries())
                }
            });
            // 8️⃣ 返回后端响应
            const responseText = await supabaseResp.text();
            // Create safe headers copy to avoid TypeScript errors
            const headersObj = {};
            supabaseResp.headers.forEach((value, key) => {
                headersObj[key] = value;
            });
            return new Response(responseText, {
                status: supabaseResp.status,
                headers: headersObj
            });
        }
        catch (err) {
            console.error('AuthMiddleware error:', err);
            return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
        }
    }
}
