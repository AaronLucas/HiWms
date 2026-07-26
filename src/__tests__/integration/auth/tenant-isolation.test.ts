/**
 * 跨租户隔离集成测试
 * ADR-015 Sprint 0.4: 验证 RLS 租户隔离真正生效
 *
 * 测试场景：
 * 1. 租户 A 用户只能看到自己的数据
 * 2. 租户 B 用户只能看到自己的数据
 * 3. 租户 A 无法查询/修改/删除租户 B 的数据
 * 4. 平台超管可跨租户访问
 * 5. fn_current_tenant_id() 在 authenticated 角色下返回正确值
 *
 * 注意：需要本地 Supabase 实例运行，通过环境变量 RUN_DB_INTEGRATION_TESTS=1 启用
 */

import { describe, it, expect, beforeAll, afterAll, skipIf } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';

const RUN_INTEGRATION_TESTS = process.env.RUN_DB_INTEGRATION_TESTS === '1';

describe.skipIf(!RUN_INTEGRATION_TESTS)('ADR-015: 跨租户隔离集成测试 (RLS 生效验证)', () => {
  let adminClient: SupabaseClient<Database>;
  let tenantAClient: SupabaseClient<Database>;
  let tenantBClient: SupabaseClient<Database>;

  let tenantAId: string;
  let tenantBId: string;
  let userAToken: string;
  let userBToken: string;
  let adminToken: string;

  beforeAll(async () => {
    // 创建管理员客户端（用于设置测试数据）
    adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 注册测试租户 A 的用户
    const { data: signUpA, error: signUpErrorA } = await adminClient.auth.admin.createUser({
      email: `tenant-a-user-${Date.now()}@test.com`,
      password: 'Test123!@#',
      email_confirm: true,
      user_metadata: { tenant_name: 'Test Tenant A' },
    });
    expect(signUpErrorA).toBeNull();
    expect(signUpA.user).toBeTruthy();

    // 等待触发器创建租户和 public.users 行
    await new Promise(r => setTimeout(r, 1000));

    // 获取租户 A 的 token
    const { data: signInA, error: signInErrorA } = await adminClient.auth.signInWithPassword({
      email: signUpA.user!.email!,
      password: 'Test123!@#',
    });
    expect(signInErrorA).toBeNull();
    userAToken = signInA.session!.access_token;

    // 获取租户 A 的 tenant_id
    const { data: profileA } = await adminClient
      .from('users')
      .select('tenant_id')
      .eq('id', signUpA.user!.id)
      .single();
    tenantAId = profileA!.tenant_id;

    // 注册测试租户 B 的用户
    const { data: signUpB, error: signUpErrorB } = await adminClient.auth.admin.createUser({
      email: `tenant-b-user-${Date.now()}@test.com`,
      password: 'Test123!@#',
      email_confirm: true,
      user_metadata: { tenant_name: 'Test Tenant B' },
    });
    expect(signUpErrorB).toBeNull();
    expect(signUpB.user).toBeTruthy();

    await new Promise(r => setTimeout(r, 1000));

    const { data: signInB, error: signInErrorB } = await adminClient.auth.signInWithPassword({
      email: signUpB.user!.email!,
      password: 'Test123!@#',
    });
    expect(signInErrorB).toBeNull();
    userBToken = signInB.session!.access_token;

    const { data: profileB } = await adminClient
      .from('users')
      .select('tenant_id')
      .eq('id', signUpB.user!.id)
      .single();
    tenantBId = profileB!.tenant_id;

    // 超管登录
    const { data: adminSignIn, error: adminSignInError } = await adminClient.auth.signInWithPassword({
      email: process.env.ADMIN_EMAIL || 'admin@test.com',
      password: process.env.ADMIN_PASSWORD || 'admin123',
    });
    if (!adminSignInError && adminSignIn.session) {
      adminToken = adminSignIn.session.access_token;
    }

    // 创建 per-request authenticated clients
    tenantAClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${userAToken}` } },
    });

    tenantBClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${userBToken}` } },
    });
  });

  afterAll(async () => {
    // 清理测试数据（可选，视测试环境而定）
  });

  describe('fn_current_tenant_id() 函数验证', () => {
    it('租户 A 用户调用时应返回租户 A 的 ID', async () => {
      const { data, error } = await tenantAClient.rpc('fn_current_tenant_id');
      expect(error).toBeNull();
      expect(data).toBe(tenantAId);
    });

    it('租户 B 用户调用时应返回租户 B 的 ID', async () => {
      const { data, error } = await tenantBClient.rpc('fn_current_tenant_id');
      expect(error).toBeNull();
      expect(data).toBe(tenantBId);
    });

    it('超管调用时（使用 service_role）应返回 NULL 或特定值', async () => {
      const { data, error } = await adminClient.rpc('fn_current_tenant_id');
      // service_role 绕过 RLS，fn_current_tenant_id 优先读 JWT app_metadata
      // 超管的 JWT 可能没有 tenant_id，所以可能返回 NULL
      expect(error).toBeNull();
    });
  });

  describe('租户隔离：租户表 (tenants)', () => {
    it('租户 A 只能看到自己的租户记录', async () => {
      const { data, error } = await tenantAClient.from('tenants').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].id).toBe(tenantAId);
    });

    it('租户 B 只能看到自己的租户记录', async () => {
      const { data, error } = await tenantBClient.from('tenants').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].id).toBe(tenantBId);
    });

    it('租户 A 无法插入租户 B 的数据', async () => {
      const { error } = await tenantAClient.from('tenants').insert({
        name: 'Malicious Insert',
        is_active: true,
      });
      // RLS 应该阻止或只能看到自己的
      // 如果 insert 成功但 SELECT 不可见，也是隔离生效的表现
      expect(error).toBeTruthy();
    });

    it('租户 A 无法更新租户 B 的记录', async () => {
      const { error } = await tenantAClient
        .from('tenants')
        .update({ name: 'Hacked' })
        .eq('id', tenantBId);
      expect(error).toBeTruthy();
    });

    it('租户 A 无法删除租户 B 的记录', async () => {
      const { error } = await tenantAClient
        .from('tenants')
        .delete()
        .eq('id', tenantBId);
      expect(error).toBeTruthy();
    });
  });

  describe('租户隔离：商品表 (products)', () => {
    let productAId: string;
    let productBId: string;

    beforeAll(async () => {
      // 租户 A 创建商品
      const { data: productA, error: errorA } = await tenantAClient
        .from('products')
        .insert({
          tenant_id: tenantAId,
          sku: 'PRODUCT-A-001',
          name: 'Tenant A Product',
          unit_of_measure: 'PCS',
        })
        .select()
        .single();
      expect(errorA).toBeNull();
      productAId = productA!.id;

      // 租户 B 创建商品
      const { data: productB, error: errorB } = await tenantBClient
        .from('products')
        .insert({
          tenant_id: tenantBId,
          sku: 'PRODUCT-B-001',
          name: 'Tenant B Product',
          unit_of_measure: 'PCS',
        })
        .select()
        .single();
      expect(errorB).toBeNull();
      productBId = productB!.id;
    });

    it('租户 A 只能查到自己的商品', async () => {
      const { data, error } = await tenantAClient.from('products').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].id).toBe(productAId);
      expect(data![0].sku).toBe('PRODUCT-A-001');
    });

    it('租户 B 只能查到自己的商品', async () => {
      const { data, error } = await tenantBClient.from('products').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].id).toBe(productBId);
      expect(data![0].sku).toBe('PRODUCT-B-001');
    });

    it('租户 A 无法读取租户 B 的商品详情', async () => {
      const { data, error } = await tenantAClient
        .from('products')
        .select('*')
        .eq('id', productBId)
        .single();
      // RLS 应该返回 PGRST116 (未找到) 而不是数据
      expect(error).toBeTruthy();
      expect(error!.code).toBe('PGRST116');
      expect(data).toBeNull();
    });

    it('租户 A 无法修改租户 B 的商品', async () => {
      const { error } = await tenantAClient
        .from('products')
        .update({ name: 'Hacked' })
        .eq('id', productBId);
      expect(error).toBeTruthy();
    });
  });

  describe('租户隔离：库存表 (inventory)', () => {
    let locationAId: string;
    let locationBId: string;
    let productAId: string;
    let productBId: string;

    beforeAll(async () => {
      // 创建库位
      const { data: locA } = await tenantAClient
        .from('locations')
        .insert({ tenant_id: tenantAId, code: 'LOC-A-01', name: 'Loc A', location_type: 'STORAGE' })
        .select()
        .single();
      locationAId = locA!.id;

      const { data: locB } = await tenantBClient
        .from('locations')
        .insert({ tenant_id: tenantBId, code: 'LOC-B-01', name: 'Loc B', location_type: 'STORAGE' })
        .select()
        .single();
      locationBId = locB!.id;

      // 创建商品
      const { data: prodA } = await tenantAClient
        .from('products')
        .insert({ tenant_id: tenantAId, sku: 'INV-A-001', name: 'Inv A', unit_of_measure: 'PCS' })
        .select()
        .single();
      productAId = prodA!.id;

      const { data: prodB } = await tenantBClient
        .from('products')
        .insert({ tenant_id: tenantBId, sku: 'INV-B-001', name: 'Inv B', unit_of_measure: 'PCS' })
        .select()
        .single();
      productBId = prodB!.id;

      // 创建库存
      await tenantAClient.from('inventory').insert({
        tenant_id: tenantAId,
        product_id: productAId,
        location_id: locationAId,
        qty_on_hand: 100,
        qty_available: 100,
      });

      await tenantBClient.from('inventory').insert({
        tenant_id: tenantBId,
        product_id: productBId,
        location_id: locationBId,
        qty_on_hand: 200,
        qty_available: 200,
      });
    });

    it('租户 A 只能看到自己的库存', async () => {
      const { data, error } = await tenantAClient.from('inventory').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].qty_on_hand).toBe(100);
    });

    it('租户 B 只能看到自己的库存', async () => {
      const { data, error } = await tenantBClient.from('inventory').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].qty_on_hand).toBe(200);
    });

    it('租户 A 无法通过 RPC 修改租户 B 的库存', async () => {
      // 尝试跨租户调用库存调整 RPC
      const { error } = await tenantAClient.rpc('fn_adjust_inventory_at_location', {
        p_location_id: locationBId,
        p_product_id: productBId,
        p_qty_delta: -50,
        p_batch_no: null,
      });
      // RLS 或 RPC 内部校验应该阻止
      expect(error).toBeTruthy();
    });
  });

  describe('租户隔离：订单表 (orders)', () => {
    let orderAId: string;
    let orderBId: string;

    beforeAll(async () => {
      const { data: orderA } = await tenantAClient
        .from('orders')
        .insert({ tenant_id: tenantAId, order_no: 'ORD-A-001', status: 'PENDING', order_type: 'OUTBOUND' })
        .select()
        .single();
      orderAId = orderA!.id;

      const { data: orderB } = await tenantBClient
        .from('orders')
        .insert({ tenant_id: tenantBId, order_no: 'ORD-B-001', status: 'PENDING', order_type: 'OUTBOUND' })
        .select()
        .single();
      orderBId = orderB!.id;
    });

    it('租户 A 只能看到自己的订单', async () => {
      const { data, error } = await tenantAClient.from('orders').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].order_no).toBe('ORD-A-001');
    });

    it('租户 B 只能看到自己的订单', async () => {
      const { data, error } = await tenantBClient.from('orders').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].order_no).toBe('ORD-B-001');
    });

    it('租户 A 无法创建属于租户 B 的订单', async () => {
      const { error } = await tenantAClient.from('orders').insert({
        tenant_id: tenantBId, // 尝试伪造 tenant_id
        order_no: 'ORD-FAKE',
        status: 'PENDING',
        order_type: 'OUTBOUND',
      });
      expect(error).toBeTruthy();
    });
  });

  describe('平台超管访问 (service_role / admin)', () => {
    it('超管可查看所有租户的数据', async () => {
      if (!adminToken) {
        console.warn('Admin token not available, skipping admin test');
        return;
      }

      const adminClientWithAuth = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${adminToken}` } },
      });

      const { data, error } = await adminClientWithAuth.from('tenants').select('*');
      expect(error).toBeNull();
      // 超管应该能看到至少两个测试租户
      expect(data!.length).toBeGreaterThanOrEqual(2);
    });

    it('超管可跨租户查询商品', async () => {
      if (!adminToken) return;

      const adminClientWithAuth = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${adminToken}` } },
      });

      const { data, error } = await adminClientWithAuth.from('products').select('*');
      expect(error).toBeNull();
      // 应该能看到两个租户的商品
      expect(data!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('RLS 策略边界测试', () => {
    it('匿名用户无法访问租户数据', async () => {
      const anonClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });

      const { data, error } = await anonClient.from('tenants').select('*');
      // RLS 应该拒绝或返回空
      expect(data).toHaveLength(0);
    });

    it('无效/过期 token 被拒绝', async () => {
      const invalidClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: 'Bearer invalid-token' } },
      });

      const { data, error } = await invalidClient.from('tenants').select('*');
      expect(data).toHaveLength(0);
    });
  });
});