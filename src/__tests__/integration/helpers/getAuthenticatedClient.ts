/**
 * 测试辅助：为测试用户生成有效的 JWT token 并返回认证客户端
 *
 * 流程：
 * 1. 创建测试用户（带 app_metadata.tenant_id）
 * 2. 用 anonKey 客户端调用 signInWithPassword 获取 access_token
 * 3. 返回带该 token 的认证客户端
 *
 * 注意：每个测试用户需要独立调用此函数，因为 token 是每次登录新生成的。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import { createTestUser } from './createTestUser';

export interface AuthenticatedClientResult {
  client: SupabaseClient<Database>;
  accessToken: string;
  userId: string;
  email: string;
  tenantId: string;
}

export async function getAuthenticatedClient(
  adminClient: SupabaseClient<Database>,
  supabaseUrl: string,
  anonKey: string,
  opts: {
    tenantId?: string;
    password?: string;
  } = {}
): Promise<AuthenticatedClientResult> {
  const password = opts.password ?? 'Ecc-Test-Password-2026!';

  // 1. 创建测试用户，如果指定了 tenantId，它会拥有该租户
  const user = await createTestUser(adminClient, {
    tenantId: opts.tenantId,
    password,
  });

  console.log('✓ 测试用户创建:', {
    userId: user.id,
    email: user.email,
    tenantId: user.tenant_id,
  });

  // 2. 用 anonKey 创建专门用于登录的客户端（不污染 adminClient 的会话）
  const anonClient = createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    db: { schema: 'public' },
  });

  // 3. 登录获取 token
  const { data: signIn, error } = await anonClient.auth.signInWithPassword({
    email: user.email!,
    password,
  });

  if (error || !signIn.session) {
    throw error ?? new Error(`signInWithPassword 失败（邮箱 ${user.email}）`);
  }

  const accessToken = signIn.session.access_token;

  // 检查 JWT 中的 app_metadata
  const decoded = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
  console.log('✓ JWT app_metadata:', {
    tenant_id: decoded.app_metadata?.tenant_id,
    sub: decoded.sub,
  });

  // 4. 创建认证客户端（使用 global.headers 方式）
  // 注：setSession() 在本地 Docker 环境中可能不能正确传递 Authorization header，
  // 所以改用 global.headers 直接传入 Bearer token。这确保每个请求都包含认证信息。
  const authenticatedClient = createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    db: { schema: 'public' },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  return {
    client: authenticatedClient,
    accessToken,
    userId: user.id,
    email: user.email!,
    tenantId: user.tenant_id,
  };
}
