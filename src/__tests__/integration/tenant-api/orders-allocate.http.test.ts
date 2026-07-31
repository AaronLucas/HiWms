/**
 * Tenant API 订单分配端点 HTTP 契约测试（Sprint 2.6 / 2.7）
 * 覆盖 POST /api/orders/:id/allocate 的 happy path + error path。
 *
 * 复用已有的 AllocateOrderUseCase（订单级、多明细行分配），调用真实的
 * fn_logic_stock_allocation RPC（SECURITY INVOKER，经 psql 确认依赖调用方
 * 角色的 RLS），因此需要真实库存数据才能验证分配结果非空。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- orders-allocate.http
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';
import { createTenantApiRouter } from '../../../apps/tenant-api/routes';
import { ExpressMiddlewareFactory } from '../../../adapters/express/ExpressMiddlewareFactory';
import { createTestUser } from '../helpers/createTestUser';
import type { TenantApiDependencies } from '../../../apps/tenant-api/di';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('tenant-api POST /api/orders/:id/allocate HTTP 契约', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let adapters: SupabaseAdapters;
  let app: Express;
  let tenantId: string;
  let otherTenantId: string;
  let productId: string;
  let userId: string;

  // 固定真实测试用户 + 播种权限（Sprint 4 RBAC 接入后必须有真实 user_roles 数据）。
  // isSystemUser 保持 false：用它绕过 RBAC 会连带绕过应用层跨租户防御检查。
  const injectContext = (tid: string) => (req: Request, _res: Response, next: NextFunction) => {
    req.context = {
      user: { id: userId, tenantId: tid, isSystemUser: false, roles: [], permissions: [] },
      tenantId: tid,
      correlationId: `test-${Date.now()}`,
    };
    next();
  };

  const createOrderWithLine = async (qty: number): Promise<string> => {
    const { data: order, error: orderErr } = await client
      .from('orders').insert({ tenant_id: tenantId, external_order_id: `ALLOC-${Date.now()}-${Math.random()}`, order_type: 'outbound', status: 'PENDING' }).select().single();
    if (orderErr) throw orderErr;

    const { error: lineErr } = await client
      .from('order_lines').insert({ order_id: order.id, product_id: productId, qty, status: 'PENDING' });
    if (lineErr) throw lineErr;

    return order.id;
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
      .from('tenants').insert({ name: `ecc-tenant-api-alloc-${Date.now()}` }).select().single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: otherTenant, error: otherErr } = await client
      .from('tenants').insert({ name: `ecc-tenant-api-alloc-other-${Date.now()}` }).select().single();
    if (otherErr) throw otherErr;
    otherTenantId = otherTenant.id;

    const { data: product, error: productErr } = await client
      .from('products').insert({ tenant_id: tenantId, sku: 'TENANT-API-ALLOC-SKU', name: 'Tenant API Allocate Test Product' }).select().single();
    if (productErr) throw productErr;
    productId = product.id;

    const { data: location, error: locationErr } = await client
      .from('locations').insert({ tenant_id: tenantId, code: `p2-alloc-loc-${Date.now()}`, is_active: true }).select().single();
    if (locationErr) throw locationErr;

    const { data: container, error: containerErr } = await client
      .from('containers').insert({ lpn_code: `p2-alloc-lpn-${Date.now()}`, current_location_id: location.id }).select().single();
    if (containerErr) throw containerErr;

    const { error: invErr } = await client
      .from('inventory').insert({ tenant_id: tenantId, product_id: productId, location_id: location.id, container_id: container.id, quantity: 20 });
    if (invErr) throw invErr;

    const user = await createTestUser(client, { tenantId, username: `ecc-tenant-api-alloc-user-${Date.now()}` });
    userId = user.id;

    const { data: role, error: roleErr } = await client
      .from('roles')
      .insert({ tenant_id: tenantId, name: `ecc-tenant-api-alloc-role-${Date.now()}` })
      .select()
      .single();
    if (roleErr) throw roleErr;

    for (const { resource, action } of [
      { resource: 'orders', action: 'READ' },
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

  test('POST /api/orders/:id/allocate：库存充足时应分配成功并把订单状态推进到 ALLOCATED', async () => {
    const orderId = await createOrderWithLine(5);

    const res = await request(app).post(`/api/orders/${orderId}/allocate`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.allocations.length).toBeGreaterThan(0);
    expect(res.body.data.allocations[0]).toMatchObject({ allocQty: 5 });

    const { data: row } = await client.from('orders').select('status').eq('id', orderId).single();
    expect(row!.status).toBe('ALLOCATED');
  });

  test('POST /api/orders/:id/allocate：不存在的订单应返回 404', async () => {
    const res = await request(app).post(`/api/orders/${randomUUID()}/allocate`);
    expect(res.status).toBe(404);
  });

  test('POST /api/orders/:id/allocate：跨租户访问应返回 404（应用层防御性隔离）', async () => {
    const { data: otherOrder, error } = await client
      .from('orders').insert({ tenant_id: otherTenantId, external_order_id: `OTHER-ALLOC-${Date.now()}`, order_type: 'outbound', status: 'PENDING' }).select().single();
    if (error) throw error;

    const res = await request(app).post(`/api/orders/${otherOrder.id}/allocate`);
    expect(res.status).toBe(404);
  });
});
