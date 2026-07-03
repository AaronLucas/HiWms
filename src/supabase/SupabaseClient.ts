import {
  createClient,
  SupabaseClient as SupabaseJsClient,
  PostgrestError,
  PostgrestSingleResponse,
  PostgrestResponse,
  PostgrestQueryBuilder,
} from '@supabase/supabase-js';
import { RetryableTask } from 'wms-workflow-engine';

/**
 * Custom error classes for Supabase operations
 */
export class SupabaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'SupabaseError';
  }
}

export class SupabaseConnectionError extends SupabaseError {
  constructor(message: string, originalError?: Error) {
    super(message, 'CONNECTION_ERROR', originalError);
    this.name = 'SupabaseConnectionError';
  }
}

export class SupabaseQueryError extends SupabaseError {
  constructor(
    message: string,
    public readonly table: string,
    originalError?: Error
  ) {
    super(message, 'QUERY_ERROR', originalError);
    this.name = 'SupabaseQueryError';
  }
}

export class SupabaseMutationError extends SupabaseError {
  constructor(
    message: string,
    public readonly table: string,
    public readonly operation: 'insert' | 'update' | 'upsert' | 'delete',
    originalError?: Error
  ) {
    super(message, 'MUTATION_ERROR', originalError);
    this.name = 'SupabaseMutationError';
  }
}

export class SupabaseRPCError extends SupabaseError {
  constructor(
    message: string,
    public readonly functionName: string,
    originalError?: Error
  ) {
    super(message, 'RPC_ERROR', originalError);
    this.name = 'SupabaseRPCError';
  }
}

export class SupabaseTenantError extends SupabaseError {
  constructor(message: string, public readonly tenantId: string) {
    super(message, 'TENANT_ERROR');
    this.name = 'SupabaseTenantError';
  }
}

/**
 * Configuration for SupabaseClient
 */
export interface SupabaseClientConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
  defaultTenantId?: string;
  retryConfig?: {
    maxAttempts: number;
    baseDelayMs: number;
  };
}

/**
 * Type-safe query builder wrapper
 */
export interface QueryFilter {
  eq: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  neq: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  gt: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  gte: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  lt: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  lte: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  like: (column: string, pattern: string) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  ilike: (column: string, pattern: string) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  in: (column: string, values: any[]) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  contains: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  containedBy: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  is: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
  not: (column: string, value: any) => PostgrestQueryBuilder<any, any, any, string, unknown>;
}

/**
 * Generic query result types
 */
export interface QueryResult<T> {
  data: T[] | null;
  error: PostgrestError | null;
  count: number | null;
}

export interface SingleResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

export interface MutationResult<T> {
  data: T[] | null;
  error: PostgrestError | null;
}

/**
 * Supabase client wrapper with enhanced type safety, error handling, and retry logic
 */
export class SupabaseClient {
  private client: SupabaseJsClient;
  private tenantId: string | null = null;
  private retryableTask: RetryableTask;

  constructor(config?: SupabaseClientConfig) {
    const url = config?.url || process.env.SUPABASE_URL;
    const anonKey = config?.anonKey || process.env.SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new SupabaseTenantError(
        'Supabase URL and anon key are required',
        config?.defaultTenantId || 'unknown'
      );
    }

    this.tenantId = config?.defaultTenantId || null;

    this.client = createClient(
      config?.url || process.env.SUPABASE_URL!,
      config?.anonKey || process.env.SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
        },
      }
    );

    // Initialize retryable task for automatic retries
    this.retryableTask = new RetryableTask(config?.retryConfig?.maxAttempts ?? 3, config?.retryConfig?.baseDelayMs ?? 1000);
  }

  /**
   * Set tenant context for subsequent operations
   */
  setTenantId(tenantId: string): void {
    this.tenantId = tenantId;
  }

  /**
   * Get current tenant ID
   */
  getTenantId(): string | null {
    return this.tenantId;
  }

  /**
   * Clear tenant context
   */
  clearTenantId(): void {
    this.tenantId = null;
  }

  /**
   * Get the underlying Supabase client for advanced operations
   */
  getClient(): SupabaseJsClient {
    return this.client;
  }

  /**
   * Build a type-safe query with automatic tenant filtering
   */
  private buildQuery(tableName: string): any {
    let query: any = this.client.from(tableName);

    if (this.tenantId) {
      query = query.eq('tenant_id', this.tenantId);
    }

    return query;
  }

  /**
   * Execute a query with optional retry logic and tenant filtering
   */
  async query<T = any>(
    tableName: string,
    queryFunction: (query: any) => Promise<any>,
    options?: { useRetry?: boolean }
  ): Promise<PostgrestResponse<any>> {
    const executeQuery = async (): Promise<PostgrestResponse<any>> => {
      const query = this.buildQuery(tableName);
      return await queryFunction(query);
    };

    try {
      if (options?.useRetry) {
        return await this.retryableTask.execute(() => executeQuery());
      }
      return await executeQuery();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SupabaseQueryError(
        `Query failed for table ${tableName}: ${message}`,
        tableName,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Select data with type safety
   */
  async select<T = any>(
    tableName: string,
    columns: string = '*',
    options?: { useRetry?: boolean }
  ): Promise<PostgrestResponse<any>> {
    return this.query(tableName, (query) => query.select(columns), { useRetry: true });
  }

  /**
   * Select single row by ID
   */
  async selectById<T = any>(
    tableName: string,
    id: string | number,
    columns: string = '*'
  ): Promise<PostgrestSingleResponse<any>> {
    return this.query(tableName, (query) => query.select(columns).eq('id', id).single());
  }

  /**
   * Select with filters
   */
  async selectWhere<T = any>(
    tableName: string,
    filters: Record<string, any>,
    columns: string = '*',
    options?: { useRetry?: boolean }
  ): Promise<PostgrestResponse<any>> {
    return this.query(tableName, (query) => {
      let q = query.select(columns);
      Object.entries(filters).forEach(([key, value]) => {
        q = q.eq(key, value);
      });
      return q;
    }, options);
  }

  /**
   * Insert records
   */
  async insert<T = any>(
    tableName: string,
    records: Partial<T> | Partial<T>[],
    options?: { returning?: string; useRetry?: boolean }
  ): Promise<PostgrestResponse<any>> {
    const recordsArray = Array.isArray(records) ? records : [records];

    // Add tenant_id to each record if tenant context exists
    const recordsWithTenant = recordsArray.map((record) => ({
      ...record,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    }));

    return this.query(
      tableName,
      (query) => {
        let q = query.insert(recordsArray as any, {
          returning: options?.returning || 'representation',
        });
        return q;
      },
      { useRetry: options?.useRetry ?? true }
    );
  }

  /**
   * Upsert records (insert or update on conflict)
   */
  async upsert<T = any>(
    tableName: string,
    records: Partial<T> | Partial<T>[],
    conflictColumns: string | string[] = 'id',
    options?: { returning?: string; useRetry?: boolean }
  ): Promise<PostgrestResponse<any>> {
    const recordsArray = Array.isArray(records) ? records : [records];

    // Add tenant_id to each record if tenant context exists
    const recordsWithTenant = recordsArray.map((record) => ({
      ...record,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    }));

    return this.query(
      tableName,
      (query) =>
        query.upsert(recordsWithTenant as any, {
          onConflict: Array.isArray(conflictColumns) ? conflictColumns.join(',') : conflictColumns,
          returning: options?.returning || 'representation',
        }),
      { useRetry: options?.useRetry ?? true }
    );
  }

  /**
   * Update records
   */
  async update<T = any>(
    tableName: string,
    updates: Partial<T>,
    filters: Record<string, any>,
    options?: { returning?: string; useRetry?: boolean }
  ): Promise<PostgrestResponse<any>> {
    // Ensure tenant isolation for updates
    const filtersWithTenant = {
      ...filters,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    };

    return this.query(
      tableName,
      (query) =>
        query.update(updates as any, {
          returning: options?.returning || 'representation',
        }).match(filtersWithTenant),
      { useRetry: options?.useRetry ?? true }
    );
  }

  /**
   * Delete records with tenant isolation
   */
  async delete(
    tableName: string,
    filters: Record<string, any>,
    options?: { useRetry?: boolean }
  ): Promise<PostgrestResponse<any>> {
    const filtersWithTenant = {
      ...filters,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
    };

    return this.query(
      tableName,
      (query) => query.delete().match(filtersWithTenant),
      { useRetry: options?.useRetry ?? true }
    );
  }

  /**
   * Execute RPC call with optional retry
   */
  async rpc<T = any>(
    functionName: string,
    params: Record<string, any> = {},
    options?: { useRetry?: boolean }
  ): Promise<PostgrestSingleResponse<any>> {
    const executeRpc = async (): Promise<PostgrestSingleResponse<any>> => {
      const { data, error } = await this.client.rpc(functionName, params);
      if (error) throw error;
      return { data, error: null } as PostgrestSingleResponse<any>;
    };

    try {
      if (options?.useRetry) {
        return await this.retryableTask.execute(() => executeRpc());
      }
      return await executeRpc();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SupabaseRPCError(
        `RPC call ${functionName} failed: ${message}`,
        functionName,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get retryable task instance for custom retry logic
   */
  getRetryableTask(): RetryableTask {
    return this.retryableTask;
  }

  /**
   * Update retry configuration
   */
  setRetryConfig(maxAttempts: number, delayMs: number): void {
    this.retryableTask = new RetryableTask(maxAttempts, delayMs);
  }
}

/**
 * Factory function to create a configured SupabaseClient
 */
export function createSupabaseClient(config: SupabaseClientConfig): SupabaseClient {
  return new SupabaseClient(config);
}

/**
 * Create client from environment variables
 */
export function createSupabaseClientFromEnv(defaultTenantId?: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new SupabaseTenantError(
      'SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required',
      defaultTenantId || 'unknown'
    );
  }

  return new SupabaseClient({
    url,
    anonKey: anonKey,
    defaultTenantId,
    retryConfig: {
      maxAttempts: 3,
      baseDelayMs: 1000,
    },
  });
}