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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';

const RUN_INTEGRATION_TESTS = process.env.RUN_DB_INTEGRATION_TESTS === '1';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

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
      user_metadata: { company_name: 'Test Tenant A' },
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
      user_metadata: { company_name: 'Test Tenant B' },
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
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
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
      // RLS 的 USING 子句会让这条 UPDATE 的 WHERE 匹配不到任何行（而不是报错）——
      // PostgREST 对此返回 error: null、0 行受影响，真正的验证要靠 service_role
      // 回查目标行是否真的没被改动。
      await tenantAClient.from('tenants').update({ name: 'Hacked' }).eq('id', tenantBId);

      const { data } = await adminClient.from('tenants').select('name').eq('id', tenantBId).single();
      expect(data!.name).not.toBe('Hacked');
    });

    it('租户 A 无法删除租户 B 的记录', async () => {
      await tenantAClient.from('tenants').delete().eq('id', tenantBId);

      const { data } = await adminClient.from('tenants').select('id').eq('id', tenantBId).single();
      expect(data).not.toBeNull();
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
      // 与 tenants 表同理：RLS 的 USING 让 WHERE 匹配不到行，error 为 null，
      // 需要用 service_role 回查确认目标行真的没被改动。
      await tenantAClient.from('products').update({ name: 'Hacked' }).eq('id', productBId);

      const { data } = await adminClient.from('products').select('name').eq('id', productBId).single();
      expect(data!.name).not.toBe('Hacked');
    });
  });

  describe('租户隔离：库存表 (inventory)', () => {
    let locationAId: string;
    let locationBId: string;
    let productAId: string;
    let productBId: string;

    beforeAll(async () => {
      // 创建库位（code 全局唯一，需带时间戳避免重复跑测试时撞车）
      const suffix = Date.now();
      const { data: locA } = await tenantAClient
        .from('locations')
        .insert({ tenant_id: tenantAId, code: `LOC-A-${suffix}`, name: 'Loc A' })
        .select()
        .single();
      locationAId = locA!.id;

      const { data: locB } = await tenantBClient
        .from('locations')
        .insert({ tenant_id: tenantBId, code: `LOC-B-${suffix}`, name: 'Loc B' })
        .select()
        .single();
      locationBId = locB!.id;

      // 创建商品
      const { data: prodA } = await tenantAClient
        .from('products')
        .insert({ tenant_id: tenantAId, sku: 'INV-A-001', name: 'Inv A' })
        .select()
        .single();
      productAId = prodA!.id;

      const { data: prodB } = await tenantBClient
        .from('products')
        .insert({ tenant_id: tenantBId, sku: 'INV-B-001', name: 'Inv B' })
        .select()
        .single();
      productBId = prodB!.id;

      // 创建库存
      await tenantAClient.from('inventory').insert({
        tenant_id: tenantAId,
        product_id: productAId,
        location_id: locationAId,
        quantity: 100,
      });

      await tenantBClient.from('inventory').insert({
        tenant_id: tenantBId,
        product_id: productBId,
        location_id: locationBId,
        quantity: 200,
      });
    });

    it('租户 A 只能看到自己的库存', async () => {
      const { data, error } = await tenantAClient.from('inventory').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].quantity).toBe(100);
    });

    it('租户 B 只能看到自己的库存', async () => {
      const { data, error } = await tenantBClient.from('inventory').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].quantity).toBe(200);
    });

    it('租户 A 无法通过 RPC 修改租户 B 的库存', async () => {
      // fn_adjust_inventory_at_location 不是 SECURITY DEFINER，以调用者身份运行，
      // 内部 SELECT ... FOR UPDATE 受 RLS 约束，租户 A 根本看不到租户 B 的库存行——
      // p_delta 为负时函数直接返回空结果（不建负库存），不是报错，而是"安全地无操作"。
      const { data, error } = await tenantAClient.rpc('fn_adjust_inventory_at_location', {
        p_tenant_id: tenantAId,
        p_location_id: locationBId,
        p_product_id: productBId,
        p_delta: -50,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      const { data: inv } = await adminClient
        .from('inventory')
        .select('quantity')
        .eq('product_id', productBId)
        .eq('location_id', locationBId)
        .single();
      expect(inv!.quantity).toBe(200);
    });
  });

  describe('租户隔离：订单表 (orders)', () => {
    let orderAId: string;
    let orderBId: string;

    // external_order_id 全局唯一，需带时间戳避免重复跑测试时撞车
    const orderAExternalId = `ORD-A-${Date.now()}`;
    const orderBExternalId = `ORD-B-${Date.now()}`;

    beforeAll(async () => {
      const { data: orderA } = await tenantAClient
        .from('orders')
        .insert({ tenant_id: tenantAId, external_order_id: orderAExternalId, status: 'PENDING', order_type: 'outbound' })
        .select()
        .single();
      orderAId = orderA!.id;

      const { data: orderB } = await tenantBClient
        .from('orders')
        .insert({ tenant_id: tenantBId, external_order_id: orderBExternalId, status: 'PENDING', order_type: 'outbound' })
        .select()
        .single();
      orderBId = orderB!.id;
    });

    it('租户 A 只能看到自己的订单', async () => {
      const { data, error } = await tenantAClient.from('orders').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].external_order_id).toBe(orderAExternalId);
    });

    it('租户 B 只能看到自己的订单', async () => {
      const { data, error } = await tenantBClient.from('orders').select('*');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].external_order_id).toBe(orderBExternalId);
    });

    it('租户 A 无法创建属于租户 B 的订单', async () => {
      const { error } = await tenantAClient.from('orders').insert({
        tenant_id: tenantBId, // 尝试伪造 tenant_id
        external_order_id: 'ORD-FAKE',
        status: 'PENDING',
        order_type: 'outbound',
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

      // 无效 JWT 会被 PostgREST 在鉴权阶段直接拒绝（401），data 是 null 而不是空数组。
      const { data, error } = await invalidClient.from('tenants').select('*');
      expect(error).toBeTruthy();
      expect(data).toBeNull();
    });
  });
});