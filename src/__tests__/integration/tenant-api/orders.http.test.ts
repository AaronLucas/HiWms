/**
 * Tenant API 订单端点 HTTP 契约测试（Sprint 2.2 / 2.7）
 * 覆盖 GET/POST /api/orders、GET /api/orders/:id 的 happy path + error path。
 *
 * 只挂载 createTenantApiRouter 本身，不经过真实的 authenticate()/resolveTenant()
 * 中间件（那部分是 ExpressMiddlewareFactory 的通用逻辑，已有独立测试覆盖）——
 * 用一个测试专用中间件直接注入 req.context，聚焦测试路由层的校验/序列化/租户隔离契约。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- orders.http
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';
import { createTenantApiRouter } from '../../../apps/tenant-api/routes';
import type { TenantApiDependencies } from '../../../apps/tenant-api/di';
import { ExpressMiddlewareFactory } from '../../../adapters/express/ExpressMiddlewareFactory';
import { createTestUser } from '../helpers/createTestUser';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('tenant-api /api/orders HTTP 契约', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let adapters: SupabaseAdapters;
  let app: Express;
  let tenantId: string;
  let otherTenantId: string;
  let productId: string;
  let userId: string;

  // 固定的真实测试用户（Sprint 4 RBAC 接入后必须有真实 user_roles/role_permissions 数据，
  // 不能像此前那样每次请求随手生成一个 randomUUID()——那样的 id 在 user_roles 里查不到
  // 任何权限，会被 requirePermission() 恒 403。isSystemUser 特意保持 false：用它绕过 RBAC
  // 会连带绕过应用层的跨租户防御性检查（同一个标志位耦合了两件事），不是本文件想要的。
  const injectContext = (tid: string) => (req: Request, _res: Response, next: NextFunction) => {
    req.context = {
      user: { id: userId, tenantId: tid, isSystemUser: false, roles: [], permissions: [] },
      tenantId: tid,
      correlationId: `test-${Date.now()}`,
    };
    next();
  };

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    adapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = adapters.client.getAdminClient();

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-tenant-api-orders-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: otherTenant, error: otherTenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-tenant-api-orders-other-${Date.now()}` })
      .select()
      .single();
    if (otherTenantErr) throw otherTenantErr;
    otherTenantId = otherTenant.id;

    const { data: product, error: productErr } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: 'TENANT-API-ORDERS-SKU', name: 'Tenant API Orders Test Product' })
      .select()
      .single();
    if (productErr) throw productErr;
    productId = product.id;

    const user = await createTestUser(client, { tenantId, username: `ecc-tenant-api-orders-user-${Date.now()}` });
    userId = user.id;

    const { data: role, error: roleErr } = await client
      .from('roles')
      .insert({ tenant_id: tenantId, name: `ecc-tenant-api-orders-role-${Date.now()}` })
      .select()
      .single();
    if (roleErr) throw roleErr;

    for (const { resource, action } of [
      { resource: 'orders', action: 'READ' },
      { resource: 'orders', action: 'CREATE' },
      { resource: 'orders', action: 'UPDATE' },
    ]) {
      const { data: permission, error: permErr } = await client
        .from('permissions')
        .upsert({ resource, action }, { onConflict: 'resource,action' })
        .select()
        .single();
      if (permErr) throw permErr;

      const { error: rolePermErr } = await client
        .from('role_permissions')
        .insert({ role_id: role.id, permission_id: permission.id });
      if (rolePermErr) throw rolePermErr;
    }

    const { error: userRoleErr } = await client
      .from('user_roles')
      .insert({ user_id: userId, role_id: role.id, scope: 'tenant' });
    if (userRoleErr) throw userRoleErr;

    const middlewareFactory = new ExpressMiddlewareFactory(
      adapters.auth.provider,
      adapters.auth.permissionChecker,
      adapters.auth.tenantResolver,
      adapters.cache.provider,
      adapters.cache.keyBuilder
    );
    const deps = { supabaseAdapters: adapters, middlewareFactory } as unknown as TenantApiDependencies;
    app = express();
    app.use(express.json());
    app.use(injectContext(tenantId));
    app.use('/api', createTenantApiRouter(deps));
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
    if (otherTenantId) await client.from('tenants').delete().eq('id', otherTenantId);
  });

  test('POST /api/orders：合法请求应创建订单+明细并返回 201', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        externalOrderId: `EXT-${Date.now()}`,
        orderType: 'outbound',
        lines: [{ productId, qty: 3 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orderId).toBeTypeOf('string');

    const { data: row } = await client.from('orders').select('status, tenant_id').eq('id', res.body.data.orderId).single();
    expect(row!.status).toBe('PENDING');
    expect(row!.tenant_id).toBe(tenantId);
  });

  test('POST /api/orders：缺少 lines 应返回 422', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ externalOrderId: `EXT-${Date.now()}`, orderType: 'outbound', lines: [] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Validation failed');
  });

  test('GET /api/orders：应返回当前租户订单列表', async () => {
    const res = await request(app).get('/api/orders');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.every((o: { tenant_id: string }) => o.tenant_id === tenantId)).toBe(true);
  });

  test('GET /api/orders：非法 status 枚举值应返回 422', async () => {
    const res = await request(app).get('/api/orders').query({ status: 'NOT_A_REAL_STATUS' });

    expect(res.status).toBe(422);
  });

  test('GET /api/orders/:id：应返回订单及明细', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .send({ externalOrderId: `EXT-${Date.now()}`, orderType: 'outbound', lines: [{ productId, qty: 1 }] });
    const orderId = createRes.body.data.orderId;

    const res = await request(app).get(`/api/orders/${orderId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.order.id).toBe(orderId);
    expect(res.body.data.lines).toHaveLength(1);
  });

  test('GET /api/orders/:id：不存在的订单应返回 404', async () => {
    const res = await request(app).get(`/api/orders/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/orders/:id：跨租户访问他人订单应返回 404（应用层防御性隔离）', async () => {
    const { data: otherOrder, error } = await client
      .from('orders')
      .insert({ tenant_id: otherTenantId, external_order_id: `OTHER-${Date.now()}`, order_type: 'outbound', status: 'PENDING' })
      .select('id')
      .single();
    if (error) throw error;

    const res = await request(app).get(`/api/orders/${otherOrder.id}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/orders：没有 orders:READ 权限的普通用户应返回 403（Sprint 4 #4.5 新接的 RBAC 校验）', async () => {
    const noPermApp = express();
    noPermApp.use(express.json());
    noPermApp.use((req: Request, _res: Response, next: NextFunction) => {
      req.context = {
        user: { id: randomUUID(), tenantId, isSystemUser: false, roles: [], permissions: [] },
        tenantId,
        correlationId: `test-${Date.now()}`,
      };
      next();
    });
    const middlewareFactory = new ExpressMiddlewareFactory(
      adapters.auth.provider,
      adapters.auth.permissionChecker,
      adapters.auth.tenantResolver,
      adapters.cache.provider,
      adapters.cache.keyBuilder
    );
    noPermApp.use('/api', createTenantApiRouter({ supabaseAdapters: adapters, middlewareFactory } as unknown as TenantApiDependencies));

    const res = await request(noPermApp).get('/api/orders');
    expect(res.status).toBe(403);
  });
});
