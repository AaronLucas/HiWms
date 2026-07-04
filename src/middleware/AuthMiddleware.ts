import { Request, Response, NextFunction } from 'express';
import { RoleManager } from '../services/RoleManager';
import { createSupabaseClientFromEnv } from '../supabase/SupabaseClient';

export class AuthMiddleware {
  private roleManager: RoleManager;
  private supabaseUrl: string;
  private supabaseAnonKey: string;

  constructor(roleManager: RoleManager, env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }) {
    this.roleManager = roleManager;
    this.supabaseUrl = env.SUPABASE_URL;
    this.supabaseAnonKey = env.SUPABASE_ANON_KEY;
  }

  /**
   * Express 中间件：认证与授权拦截
   */
  handle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1️⃣ 解析租户与用户凭证
      const tenantId = req.headers['x-tenant-id'] as string || req.query.tenant_id as string;
      if (!tenantId) {
        res.status(400).json({ error: 'Missing tenant_id' });
        return;
      }

      // 2️⃣ 从请求头获取认证信息（如 JWT）
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing Bearer token' });
        return;
      }
      const token = authHeader.slice('Bearer '.length);

      // 3️⃣ 校验 token（这里简化，实际应使用 JWT 验证）
      let userId: string | null = null;
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        const userId = payload.sub;
        if (!userId) {
          res.status(401).json({ error: 'User not identified' });
          return;
        }
        // 将 userId 挂载到 request 上供后续使用
        (req as any).userId = userId;
        (req as any).tenantId = tenantId;
      } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      // 4️⃣ 权限检查
      const action = req.method;
      const resource = req.path.replace(/^\/api\//, '').split('/')[0]; // 如 /api/products -> products

      const hasPerm = await this.roleManager.hasPermission(
        (req as any).userId,
        resource,
        req.method
      );

      if (!hasPerm) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      // 将 tenantId 挂载到 request 供后续使用
      (req as any).tenantId = tenantId;

      next();
    } catch (err) {
      console.error('AuthMiddleware error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}