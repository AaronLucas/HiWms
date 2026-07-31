/**
 * Tenant API 库存端点 HTTP 契约测试（Sprint 2.3 / 2.7）
 * 覆盖 GET /api/inventory、GET /api/inventory/:id 的 happy path + error path。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- inventory.http
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

describe.skipIf(!RUN)('tenant-api /api/inventory HTTP 契约', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let adapters: SupabaseAdapters;
  let app: Express;
  let tenantId: string;
  let otherTenantId: string;
  let productId: string;
  let locationId: string;
  let inventoryId: string;
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

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    adapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = adapters.client.getAdminClient();

    const { data: tenant, error: tenantErr } = await client
      .from('tenants').insert({ name: `ecc-tenant-api-inv-${Date.now()}` }).select().single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: otherTenant, error: otherErr } = await client
      .from('tenants').insert({ name: `ecc-tenant-api-inv-other-${Date.now()}` }).select().single();
    if (otherErr) throw otherErr;
    otherTenantId = otherTenant.id;

    const { data: product, error: productErr } = await client
      .from('products').insert({ tenant_id: tenantId, sku: 'TENANT-API-INV-SKU', name: 'Tenant API Inventory Test Product' }).select().single();
    if (productErr) throw productErr;
    productId = product.id;

    const { data: location, error: locationErr } = await client
      .from('locations').insert({ tenant_id: tenantId, code: `p2-inv-loc-${Date.now()}`, is_active: true }).select().single();
    if (locationErr) throw locationErr;
    locationId = location.id;

    const { data: inv, error: invErr } = await client
      .from('inventory').insert({ tenant_id: tenantId, product_id: productId, location_id: locationId, quantity: 10 }).select().single();
    if (invErr) throw invErr;
    inventoryId = inv.id;

    const user = await createTestUser(client, { tenantId, username: `ecc-tenant-api-inv-user-${Date.now()}` });
    userId = user.id;

    const { data: role, error: roleErr } = await client
      .from('roles')
      .insert({ tenant_id: tenantId, name: `ecc-tenant-api-inv-role-${Date.now()}` })
      .select()
      .single();
    if (roleErr) throw roleErr;

    const { data: permission, error: permErr } = await client
      .from('permissions')
      .upsert({ resource: 'inventory', action: 'READ' }, { onConflict: 'resource,action' })
      .select()
      .single();
    if (permErr) throw permErr;

    const { error: rolePermErr } = await client
      .from('role_permissions')
      .insert({ role_id: role.id, permission_id: permission.id });
    if (rolePermErr) throw rolePermErr;

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

  test('GET /api/inventory：应返回当前租户库存列表', async () => {
    const res = await request(app).get('/api/inventory');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.some((r: { id: string }) => r.id === inventoryId)).toBe(true);
  });

  test('GET /api/inventory：非法 productId（非 UUID）应返回 422', async () => {
    const res = await request(app).get('/api/inventory').query({ productId: 'not-a-uuid' });
    expect(res.status).toBe(422);
  });

  test('GET /api/inventory/:id：应返回单条库存记录', async () => {
    const res = await request(app).get(`/api/inventory/${inventoryId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(inventoryId);
  });

  test('GET /api/inventory/:id：不存在的记录应返回 404', async () => {
    const res = await request(app).get(`/api/inventory/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/inventory/:id：跨租户访问应返回 404（应用层防御性隔离）', async () => {
    const { data: otherProduct, error: otherProductErr } = await client
      .from('products').insert({ tenant_id: otherTenantId, sku: 'OTHER-TENANT-SKU', name: 'Other Tenant Product' }).select().single();
    if (otherProductErr) throw otherProductErr;

    const { data: otherInv, error: otherInvErr } = await client
      .from('inventory').insert({ tenant_id: otherTenantId, product_id: otherProduct.id, quantity: 5 }).select().single();
    if (otherInvErr) throw otherInvErr;

    const res = await request(app).get(`/api/inventory/${otherInv.id}`);
    expect(res.status).toBe(404);
  });
});
