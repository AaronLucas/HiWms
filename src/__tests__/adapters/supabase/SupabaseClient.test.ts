/**
 * P1-1 修复验证测试：getAuthenticatedClient + rawWithAuth
 * 验证 per-request Supabase client 正确注入用户 JWT，使 auth.uid() 返回真实用户 ID
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { createClient } from '@supabase/supabase-js';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);

describe('WmsSupabaseClient - P1-1 getAuthenticatedClient', () => {
  let supabase: WmsSupabaseClient;
  let mockAuthedClient: any;
  const config = {
    url: 'https://test.supabase.co',
    anonKey: 'test-anon-key',
    serviceRoleKey: 'test-service-role-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockReset();

    // 重置单例
    (WmsSupabaseClient as any).instance = null;

    // 创建 mock authenticated client
    mockAuthedClient = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: 'test-result', error: null }),
    } as any;

    // 先返回 admin client（getInstance 调用），再返回 authed client
    mockCreateClient
      .mockReturnValueOnce({ from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) } as any) // getInstance 调用
      .mockReturnValue(mockAuthedClient); // getAuthenticatedClient 调用

    supabase = WmsSupabaseClient.getInstance(config);
  });

  describe('getAuthenticatedClient()', () => {
    it('should create new Supabase client with user JWT in Authorization header', () => {
      const userToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.user-jwt-token';

      const client = supabase.getAuthenticatedClient(userToken);

      // 验证 createClient 被正确调用（第 2 次调用是 getAuthenticatedClient）
      expect(createClient).toHaveBeenCalledTimes(2);
      expect(createClient).toHaveBeenNthCalledWith(
        2,
        config.url,
        config.anonKey,
        expect.objectContaining({
          auth: { persistSession: false },
          db: { schema: 'public' },
          global: {
            headers: {
              Authorization: `Bearer ${userToken}`,
            },
          },
        })
      );
      expect(client).toBe(mockAuthedClient);
    });

    it('should NOT cache client - each call returns new instance', () => {
      const userToken = 'test-token';
      // 重置 mock 以便新的调用
      mockCreateClient.mockReset();
      mockCreateClient
        .mockReturnValueOnce({ from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }) // getInstance
        .mockReturnValueOnce({ id: 'client-1' as any }) // 第 1 次 getAuthenticatedClient
        .mockReturnValueOnce({ id: 'client-2' as any }); // 第 2 次 getAuthenticatedClient

      (WmsSupabaseClient as any).instance = null;
      supabase = WmsSupabaseClient.getInstance(config);

      const client1 = supabase.getAuthenticatedClient(userToken);
      const client2 = supabase.getAuthenticatedClient(userToken);

      expect(createClient).toHaveBeenCalledTimes(3); // 1 getInstance + 2 getAuthenticatedClient
      expect(client1).not.toBe(client2);
    });

    it('should use anonKey (not serviceRoleKey) for authenticated client', () => {
      const userToken = 'test-token';

      supabase.getAuthenticatedClient(userToken);

      // 第 2 次调用是 getAuthenticatedClient
      expect(createClient).toHaveBeenNthCalledWith(
        2,
        config.url,
        config.anonKey, // 关键：用 anonKey，配合 Bearer token 实现用户身份
        expect.any(Object)
      );
    });
  });

  describe('getAdminClient() - regression', () => {
    it('should still work with serviceRoleKey', () => {
      const adminClient = supabase.getAdminClient();
      expect(adminClient).toBeDefined();
    });
  });
});

describe('SupabaseRpcClient - P1-1 rawWithAuth', () => {
  let supabase: WmsSupabaseClient;
  let rpcClient: SupabaseRpcClient;
  let mockAuthedClient: any;
  const config = {
    url: 'https://test.supabase.co',
    anonKey: 'test-anon-key',
    serviceRoleKey: 'test-service-role-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockReset();

    (WmsSupabaseClient as any).instance = null;

    mockAuthedClient = {
      rpc: vi.fn().mockResolvedValue({ data: 'test-result', error: null }),
    };
    mockCreateClient.mockReturnValue(mockAuthedClient);

    supabase = WmsSupabaseClient.getInstance(config);
    rpcClient = new SupabaseRpcClient(supabase);
  });

  describe('rawWithAuth()', () => {
    it('should call getAuthenticatedClient with userToken and invoke RPC', async () => {
      const userToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.user-jwt';
      const functionName = 'fn_resolve_exception';
      const args = { p_exception_id: '123', p_resolver_user_id: '456' } as any;

      const result = await rpcClient.rawWithAuth(userToken, functionName, args);

      // 验证 getAuthenticatedClient 被正确调用
      expect(createClient).toHaveBeenCalledWith(
        config.url,
        config.anonKey,
        expect.objectContaining({
          global: {
            headers: {
              Authorization: `Bearer ${userToken}`,
            },
          },
        })
      );

      // 验证 RPC 被正确调用（带自动注入的 tenant_id）
      expect(mockAuthedClient.rpc).toHaveBeenCalledWith(
        functionName,
        expect.objectContaining({
          p_exception_id: '123',
          p_resolver_user_id: '456',
        }),
        undefined // 无 options 时 rpcOptions 为 undefined
      );

      expect(result).toBe('test-result');
    });

    it('should inject tenant_id when provided in options', async () => {
      const userToken = 'test-token';
      const functionName = 'fn_resolve_exception';
      // Include p_tenant_id in args so the injection logic finds the key
      const args = { p_exception_id: '123', p_tenant_id: undefined } as any;
      const tenantId = 'tenant-456';

      await rpcClient.rawWithAuth(userToken, functionName, args, { tenantId });

      // 注意：options 被传递后，rpcOptions 会包含从 options 提取的 head/get/count
      // 这里 options = { tenantId: 'tenant-456' }，所以 head/get/count 都是 undefined
      expect(mockAuthedClient.rpc).toHaveBeenCalledWith(
        functionName,
        expect.objectContaining({
          p_exception_id: '123',
          p_tenant_id: tenantId, // 自动注入
        }),
        expect.objectContaining({
          head: undefined,
          get: undefined,
          count: undefined,
        })
      );
    });

    it('should NOT inject tenant_id when injectTenantId: false', async () => {
      const userToken = 'test-token';
      const functionName = 'fn_resolve_exception';
      const args = { p_exception_id: '123' } as any;

      await rpcClient.rawWithAuth(userToken, functionName, args, { injectTenantId: false });

      expect(mockAuthedClient.rpc).toHaveBeenCalledWith(
        functionName,
        expect.not.objectContaining({ p_tenant_id: expect.any(String) }),
        expect.objectContaining({
          head: undefined,
          get: undefined,
          count: undefined,
        })
      );
    });

    it('should throw RpcError on RPC error', async () => {
      mockAuthedClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST301', message: 'Function not found', details: '', hint: '' },
      });

      await expect(
        rpcClient.rawWithAuth('token', 'fn_resolve_exception', {})
      ).rejects.toThrow('Function not found');
    });
  });

  describe('raw() - regression (still works with admin/client)', () => {
    it('should use admin client when useAdmin: true', async () => {
      const mockAdminClient = { rpc: vi.fn().mockResolvedValue({ data: 'admin-result', error: null }) };
      // 重置 mock
      mockCreateClient.mockReset();
      mockCreateClient
        .mockReturnValueOnce({ from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }) // getInstance
        .mockReturnValueOnce(mockAdminClient); // useAdmin = true 时走 admin client

      (WmsSupabaseClient as any).instance = null;
      supabase = WmsSupabaseClient.getInstance(config);
      rpcClient = new SupabaseRpcClient(supabase);

      const result = await rpcClient.raw('fn_resolve_exception', { p_exception_id: '123' } as any, { useAdmin: true });

      expect(result).toBe('admin-result');
    });
  });
});