/**
 * 认证与授权拦截器（用于 Cloudflare Worker）
 * 检查租户身份、用户角色以及资源权限
 */
import { RoleManager } from '@/services/RoleManager';
export declare class AuthMiddleware {
    private roleManager;
    private supabaseUrl;
    private supabaseAnonKey;
    constructor(roleManager: RoleManager, env: any);
    /**
     * 主拦截函数，供 Cloudflare Worker 调用
     */
    handle(request: Request): Promise<Response>;
}
