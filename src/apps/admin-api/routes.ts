/**
 * Admin API 路由定义
 *
 * RBAC 策略（ROADMAP 4.9 方案 B）：
 * - strict 模式：每个路由独立 requirePermission(resource, action, 'platform')
 * - compat 模式（默认）：沿用 isSystemUser 兼容期，DBA 种子数据就绪后切换
 */
import { Router, Request, Response, NextFunction } from 'express';
import type { AdminApiDependencies } from './di';
import {
  loginBodySchema,
  createTenantBodySchema,
  updateTenantBodySchema,
  resetPasswordBodySchema,
  validateBody,
  type LoginBody,
  type CreateTenantBody,
  type UpdateTenantBody,
  type ResetPasswordBody,
} from './validation';

export function createAdminRouter(deps: AdminApiDependencies): Router {
  const { supabaseAdapters: a, middlewareFactory: mf, config } = deps;
  const router = Router();

  // ===== 登录（无需认证） =====
  router.post(
    '/auth/login',
    mf.rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 5 }),
    validateBody(loginBodySchema),
    async (req: Request, res: Response) => {
      try {
        const { email, password, captchaToken } = req.body as LoginBody;
        const result = await a.auth.provider.signIn(email, password, captchaToken);
        if (!result) {
          return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        const isAdmin = await a.auth.tenantResolver.isPlatformAdmin(result.user.id);
        if (!isAdmin) {
          return res.status(403).json({ success: false, error: 'Admin access required' });
        }
        res.json({ success: true, data: result });
      } catch (error) {
        console.error('admin-api login failed:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
      }
    }
  );

  // ===== 受保护路由：认证 + RBAC =====
  const protectedRouter = Router();
  protectedRouter.use(mf.authenticate());

  // RBAC 门禁：strict 模式走 requirePermission，compat 走 isSystemUser
  if (config.rbacMode === 'strict') {
    // strict: 每个路由独立 requirePermission —— 由各路由单独挂载
    // 此中间件仅做认证后的 context 注入，不做全局 RBAC 放行
  } else {
    // compat: 沿用 isSystemUser 兼容期
    protectedRouter.use((req: Request, res: Response, next: NextFunction) => {
      if (!req.context?.user?.isSystemUser) {
        return res.status(403).json({ success: false, error: 'Platform admin required' });
      }
      next();
    });
  }

  /** strict 模式下的权限检查快捷方式 */
  const permit = (resource: string, action: string) =>
    config.rbacMode === 'strict'
      ? mf.requirePermission(resource, action, 'platform')
      : (_req: Request, _res: Response, next: NextFunction) => next();

  // ===== 租户管理 =====
  protectedRouter.get('/tenants', permit('tenants', 'READ'), async (req: Request, res: Response) => {
    try {
      const tenants = await a.repositories.tenants.findActive();
      res.json({ success: true, data: tenants });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch tenants' });
    }
  });

  protectedRouter.post(
    '/tenants',
    permit('tenants', 'CREATE'),
    validateBody(createTenantBodySchema),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as CreateTenantBody;
        const tenant = await a.repositories.tenants.create(body as unknown as Parameters<typeof a.repositories.tenants.create>[0]);

        // 建租户后初始化默认 ADMIN 角色 + RBAC 权限（迁移 024）
        const { error: provisionError } = await a.client
          .getAdminClient()
          .rpc('fn_provision_tenant_defaults', { p_tenant_id: tenant.id });
        if (provisionError) {
          console.error(`租户 ${tenant.id} 创建成功但默认角色/权限初始化失败:`, provisionError);
        }

        res.status(201).json({ success: true, data: tenant });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to create tenant' });
      }
    }
  );

  protectedRouter.get('/tenants/:id', permit('tenants', 'READ'), async (req: Request, res: Response) => {
    try {
      const tenant = await a.repositories.tenants.findById(req.params.id);
      if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });
      res.json({ success: true, data: tenant });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch tenant' });
    }
  });

  protectedRouter.patch(
    '/tenants/:id',
    permit('tenants', 'UPDATE'),
    validateBody(updateTenantBodySchema),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as UpdateTenantBody;
        const tenant = await a.repositories.tenants.update(req.params.id, body as Record<string, unknown>);
        res.json({ success: true, data: tenant });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to update tenant' });
      }
    }
  );

  // ===== 用户管理（跨租户，admin client 查询） =====
  protectedRouter.get('/users', permit('users_platform', 'READ'), async (req: Request, res: Response) => {
    try {
      const { data, error } = await a.client.getAdminClient()
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
  });

  // 管理员重置成员密码（ROADMAP 5.4）
  protectedRouter.patch(
    '/users/:id/password',
    permit('users_platform', 'UPDATE'),
    validateBody(resetPasswordBodySchema),
    async (req: Request, res: Response) => {
      try {
        const { newPassword } = req.body as ResetPasswordBody;
        await a.auth.provider.changePassword(req.params.id, newPassword);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to reset password' });
      }
    }
  );

  // ===== 计费管理 =====
  protectedRouter.get('/billing/rules', permit('billing_rules', 'READ'), async (req: Request, res: Response) => {
    try {
      const { data, error } = await a.client.getAdminClient()
        .from('billing_rules')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch billing rules' });
    }
  });

  // ===== 系统监控 =====
  protectedRouter.get(
    '/monitoring/stats',
    permit('platform_config', 'READ'),
    async (req: Request, res: Response) => {
      try {
        const { data: tenants } = await a.client.getAdminClient()
          .from('tenants')
          .select('id, name, is_active');

        const active = tenants?.filter((t: { is_active: boolean | null }) => t.is_active === true).length || 0;
        res.json({ success: true, data: { tenants: tenants?.length || 0, active } });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
      }
    }
  );

  router.use('/', protectedRouter);

  return router;
}
