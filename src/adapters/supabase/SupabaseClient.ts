/**
 * 统一 Supabase 客户端封装
 * 合并原有的 SupabaseClient.ts 和 rpc.ts，提供单例、重试、租户上下文、类型安全
 */
import { createClient, PostgrestError, SupabaseClient as SupabaseJsClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { RpcOptions, RpcError } from '../../core/ports/rpc/IRpcClient';

/** 表名常量 - 单一真相源 */
export const TABLES = {
  TENANTS: 'tenants',
  USERS: 'users',
  ROLES: 'roles',
  PERMISSIONS: 'permissions',
  ROLE_PERMISSIONS: 'role_permissions',
  USER_ROLES: 'user_roles',
  PRODUCTS: 'products',
  PRODUCT_CONSTRAINTS: 'product_constraints',
  LOCATIONS: 'locations',
  INVENTORY: 'inventory',
  INVENTORY_HISTORY: 'inventory_history',
  INVENTORY_LOCKS: 'inventory_locks',
  INVENTORY_RESERVATIONS: 'inventory_reservations',
  ORDERS: 'orders',
  ORDER_LINES: 'order_lines',
  WAVES: 'waves',
  WAVE_ORDER_MAPPING: 'wave_order_mapping',
  WORK_ORDERS: 'work_orders',
  WO_ACTION_LOGS: 'wo_action_logs',
  INBOUND_RECEIPTS: 'inbound_receipts',
  QUALITY_INSPECTIONS: 'quality_inspections',
  INSPECTION_ITEMS: 'inspection_items',
  CROSS_DOCK_JOBS: 'cross_dock_jobs',
  SORTING_TASKS: 'sorting_tasks',
  SORTING_CHUTES: 'sorting_chutes',
  SORTING_WAVES: 'sorting_waves',
  PACKING_TASKS: 'packing_tasks',
  PACKAGE_SPECS: 'package_specs',
  CONSUMABLE_USAGES: 'consumable_usages',
  LOADING_TASKS: 'loading_tasks',
  VEHICLES: 'vehicles',
  CONTAINERS: 'containers',
  BARCODE_MAPPINGS: 'barcode_mappings',
  DEVICES: 'devices',
  BILLING_RULES: 'billing_rules',
  BILLING_RULE_TIERS: 'billing_rule_tiers',
  BILLING_TRANSACTIONS: 'billing_transactions',
  VAS_BOMS: 'vas_boms',
  VAS_BOM_ITEMS: 'vas_bom_items',
  VERIFICATION_RULES: 'verification_rules',
  LABEL_TEMPLATES: 'label_templates',
  SHIPPING_DOCUMENTS: 'shipping_documents',

  // Phase 5: PDA 离线同步专用表
  SYNC_QUEUE: 'sync_queue',
  SYNC_SESSIONS: 'sync_sessions',
  SYNC_CONFLICTS: 'sync_conflicts',
  SYNC_CURSORS: 'sync_cursors',
  PENDING_UPLOADS: 'pending_uploads',
  DEVICE_STATES: 'device_states',

  // 分拣相关缺失表
  CONTAINER_SORTING_TARGETS: 'container_sorting_targets',
} as const;

export type TableName = typeof TABLES[keyof typeof TABLES];

/** Supabase 客户端配置 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
  defaultTenantId?: string;
  /** 重试配置 */
  retry?: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
}

/** 统一 Supabase 客户端类 */
export class WmsSupabaseClient {
  private static instance: WmsSupabaseClient | null = null;
  private client: SupabaseClient<Database>;
  private adminClient: SupabaseClient<Database> | null = null;
  private defaultTenantId: string | null = null;
  private config: SupabaseConfig;

  private constructor(config: SupabaseConfig) {
    this.config = config;
    this.client = createClient<Database>(config.url, config.anonKey, {
      auth: { persistSession: false },
      db: { schema: 'public' },
    });
  }

  /** 获取单例实例 */
  static getInstance(config?: SupabaseConfig): WmsSupabaseClient {
    if (!WmsSupabaseClient.instance) {
      if (!config) {
        throw new Error('WmsSupabaseClient not initialized. Provide config on first call.');
      }
      WmsSupabaseClient.instance = new WmsSupabaseClient(config);
    } else if (config) {
      // 更新配置（如 tenantId）
      WmsSupabaseClient.instance.updateConfig(config);
    }
    return WmsSupabaseClient.instance;
  }

  /** 重置单例（测试用） */
  static reset() {
    WmsSupabaseClient.instance = null;
  }

  private updateConfig(config: Partial<SupabaseConfig>) {
    this.config = { ...this.config, ...config };
  }

  /** 获取普通客户端（带 RLS） */
  getClient(): SupabaseClient<Database> {
    return this.client;
  }

  /** 获取管理员客户端（绕过 RLS，需 service_role key） */
  getAdminClient(): SupabaseClient<Database> {
    if (!this.adminClient && this.config.serviceRoleKey) {
      this.adminClient = createClient<Database>(this.config.url, this.config.serviceRoleKey, {
        auth: { persistSession: false },
        db: { schema: 'public' },
      });
    }
    if (!this.adminClient) {
      throw new Error('Service role key not configured. Cannot create admin client.');
    }
    return this.adminClient;
  }

  /** 设置默认租户 ID（用于 RLS 上下文注入） */
  setTenantId(tenantId: string) {
    this.defaultTenantId = tenantId;
  }

  /** 清除默认租户 ID */
  clearTenantId() {
    this.defaultTenantId = null;
  }

  /** 获取当前租户 ID */
  getTenantId(): string | null {
    return this.defaultTenantId;
  }

  /** 执行带重试的查询 */
  async executeWithRetry<T>(
    operation: () => Promise<{ data: T | null; error: PostgrestError | null }>,
    options: { maxRetries?: number; baseDelayMs?: number } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? this.config.retry?.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? this.config.retry?.baseDelayMs ?? 100;
    const maxDelayMs = this.config.retry?.maxDelayMs ?? 5000;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const { data, error } = await operation();

      if (!error) {
        return data as T;
      }

      lastError = new Error(error.message);

      // 只在特定错误码下重试
      const retryableCodes = ['PGRST301', 'PGRST302', '57014', '08006', '40001'];
      if (!retryableCodes.includes(error.code) || attempt === maxRetries) {
        break;
      }

      // 指数退避 + 抖动
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 100,
        maxDelayMs
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    throw lastError;
  }

  /** 构建带租户上下文的查询 */
  from(table: string, useAdmin = false) {
    const client = useAdmin ? this.getAdminClient() : this.getClient();
    return (client as any).from(table);
  }

  /** 执行 RPC 调用（类型安全） */
  async rpc<F extends keyof Database['public']['Functions']>(
    functionName: F,
    args: Database['public']['Functions'][F]['Args'],
    options: RpcOptions = {}
  ): Promise<Database['public']['Functions'][F]['Returns']> {
    const client = options.useAdmin ? this.getAdminClient() : this.getClient();

    // 自动注入 tenant_id
    const finalArgs = { ...args } as Record<string, unknown>;
    if (options.injectTenantId !== false) {
      const tenantId = options.tenantId ?? this.defaultTenantId;
      if (tenantId) {
        const tenantKey = Object.keys(finalArgs).find(k => k.includes('tenant_id'));
        if (tenantKey && !finalArgs[tenantKey]) {
          finalArgs[tenantKey] = tenantId;
        }
      }
    }

    const { data, error } = await client.rpc(functionName, finalArgs);

    if (error) {
      throw new RpcError(
        error.code,
        error.message,
        { details: error.details, hint: error.hint },
        functionName as string
      );
    }

    return data as Database['public']['Functions'][F]['Returns'];
  }

  /** 事务执行器 */
  async transaction<T>(
    callback: (client: SupabaseClient<Database>) => Promise<T>,
    useAdmin = false
  ): Promise<T> {
    // Supabase JS 客户端不直接支持事务
    // 需要使用 RPC 调用 PostgreSQL 函数或使用 pg_transaction 扩展
    // 这里提供一个简化版本，实际项目中可能需要自定义 RPC 实现事务
    const client = useAdmin ? this.getAdminClient() : this.getClient();
    return callback(client);
  }

  /** 健康检查 */
  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.client.from(TABLES.TENANTS).select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  }
}

export type SupabaseClient<Database> = import('@supabase/supabase-js').SupabaseClient<Database>;
export type TypedSupabaseClient = SupabaseClient<Database>;