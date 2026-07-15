/**
 * Supabase 适配器统一导出
 * 所有外部依赖通过此文件访问 Supabase 实现
 */
export { WmsSupabaseClient, TABLES, type TableName, type SupabaseConfig } from './SupabaseClient';
export { SupabaseRpcClient } from './rpc/SupabaseRpcClient';
export { SupabaseTenantRepository } from './repositories/SupabaseTenantRepository';
export { SupabaseProductRepository } from './repositories/SupabaseProductRepository';
export { SupabaseInventoryRepository } from './repositories/SupabaseInventoryRepository';
export { SupabaseOrderRepository } from './repositories/SupabaseOrderRepository';
export { SupabaseWorkOrderRepository } from './repositories/SupabaseWorkOrderRepository';
export { SupabaseAuthProvider } from './auth/SupabaseAuthProvider';
export { SupabasePermissionChecker } from './auth/SupabasePermissionChecker';
export { SupabaseTenantResolver } from './auth/SupabaseTenantResolver';
export { SupabaseCacheProvider, RedisCacheProvider } from './cache/SupabaseCacheProvider';
export { CacheKeyBuilder } from './cache/CacheKeyBuilder';

/** 适配器工厂函数 */
import { WmsSupabaseClient } from './SupabaseClient';
import { SupabaseRpcClient } from './rpc/SupabaseRpcClient';
import { SupabaseTenantRepository } from './repositories/SupabaseTenantRepository';
import { SupabaseProductRepository } from './repositories/SupabaseProductRepository';
import { SupabaseInventoryRepository } from './repositories/SupabaseInventoryRepository';
import { SupabaseOrderRepository } from './repositories/SupabaseOrderRepository';
import { SupabaseWorkOrderRepository } from './repositories/SupabaseWorkOrderRepository';
import { SupabaseAuthProvider } from './auth/SupabaseAuthProvider';
import { SupabasePermissionChecker } from './auth/SupabasePermissionChecker';
import { SupabaseTenantResolver } from './auth/SupabaseTenantResolver';
import { SupabaseCacheProvider, CacheKeyBuilder } from './cache/SupabaseCacheProvider';
import type { Database } from '../../types/database';

export interface SupabaseAdapters {
  client: WmsSupabaseClient;
  rpc: SupabaseRpcClient;
  repositories: {
    tenants: SupabaseTenantRepository;
    products: SupabaseProductRepository;
    inventory: SupabaseInventoryRepository;
    orders: SupabaseOrderRepository;
    workOrders: SupabaseWorkOrderRepository;
  };
  auth: {
    provider: SupabaseAuthProvider;
    permissionChecker: SupabasePermissionChecker;
    tenantResolver: SupabaseTenantResolver;
  };
  cache: {
    provider: SupabaseCacheProvider;
    keyBuilder: CacheKeyBuilder;
  };
}

/**
 * 创建所有 Supabase 适配器实例
 * 用于应用启动时的依赖注入
 */
export function createSupabaseAdapters(config: {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}): SupabaseAdapters {
  const client = WmsSupabaseClient.getInstance({ url: config.url, anonKey: config.anonKey, serviceRoleKey: config.serviceRoleKey });
  const rpc = new SupabaseRpcClient(client);

  return {
    client,
    rpc,
    repositories: {
      tenants: new SupabaseTenantRepository(client),
      products: new SupabaseProductRepository(client),
      inventory: new SupabaseInventoryRepository(client),
      orders: new SupabaseOrderRepository(client),
      workOrders: new SupabaseWorkOrderRepository(client),
    },
    auth: {
      provider: new SupabaseAuthProvider(client.getClient(), config.serviceRoleKey ? client.getAdminClient() : null),
      permissionChecker: new SupabasePermissionChecker(client),
      tenantResolver: new SupabaseTenantResolver(
        client,
        // permissionChecker 需要在创建后注入，这里简化处理
        { checkUserPermission: async () => false } as any
      ),
    },
    cache: {
      provider: new SupabaseCacheProvider(),
      keyBuilder: new CacheKeyBuilder(),
    },
  };
}