import { SupabaseClient as SupabaseJsClient, PostgrestError, PostgrestSingleResponse, PostgrestResponse, PostgrestQueryBuilder } from '@supabase/supabase-js';
import { RetryableTask } from 'wms-workflow-engine';
/**
 * Custom error classes for Supabase operations
 */
export declare class SupabaseError extends Error {
    readonly code: string;
    readonly originalError?: Error | undefined;
    constructor(message: string, code: string, originalError?: Error | undefined);
}
export declare class SupabaseConnectionError extends SupabaseError {
    constructor(message: string, originalError?: Error);
}
export declare class SupabaseQueryError extends SupabaseError {
    readonly table: string;
    constructor(message: string, table: string, originalError?: Error);
}
export declare class SupabaseMutationError extends SupabaseError {
    readonly table: string;
    readonly operation: 'insert' | 'update' | 'upsert' | 'delete';
    constructor(message: string, table: string, operation: 'insert' | 'update' | 'upsert' | 'delete', originalError?: Error);
}
export declare class SupabaseRPCError extends SupabaseError {
    readonly functionName: string;
    constructor(message: string, functionName: string, originalError?: Error);
}
export declare class SupabaseTenantError extends SupabaseError {
    readonly tenantId: string;
    constructor(message: string, tenantId: string);
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
export declare class SupabaseClient {
    private client;
    private tenantId;
    private retryableTask;
    constructor(config?: SupabaseClientConfig);
    /**
     * Set tenant context for subsequent operations
     */
    setTenantId(tenantId: string): void;
    /**
     * Get current tenant ID
     */
    getTenantId(): string | null;
    /**
     * Clear tenant context
     */
    clearTenantId(): void;
    /**
     * Get the underlying Supabase client for advanced operations
     */
    getClient(): SupabaseJsClient;
    /**
     * Direct access to the underlying Supabase query builder
     */
    from(tableName: string): any;
    /**
     * Build a type-safe query with automatic tenant filtering
     */
    private buildQuery;
    /**
     * Execute a query with optional retry logic and tenant filtering
     */
    query<T = any>(tableName: string, queryFunction: (query: any) => Promise<any>, options?: {
        useRetry?: boolean;
    }): Promise<PostgrestResponse<any>>;
    /**
     * Select data with type safety
     */
    select<T = any>(tableName: string, columns?: string, options?: {
        useRetry?: boolean;
    }): Promise<PostgrestResponse<any>>;
    /**
     * Select single row by ID
     */
    selectById<T = any>(tableName: string, id: string | number, columns?: string): Promise<PostgrestSingleResponse<any>>;
    /**
     * Select with filters
     */
    selectWhere<T = any>(tableName: string, filters: Record<string, any>, columns?: string, options?: {
        useRetry?: boolean;
    }): Promise<PostgrestResponse<any>>;
    /**
     * Insert records
     */
    insert<T = any>(tableName: string, records: Partial<T> | Partial<T>[], options?: {
        returning?: string;
        useRetry?: boolean;
    }): Promise<PostgrestResponse<any>>;
    /**
     * Upsert records (insert or update on conflict)
     */
    upsert<T = any>(tableName: string, records: Partial<T> | Partial<T>[], conflictColumns?: string | string[], options?: {
        returning?: string;
        useRetry?: boolean;
    }): Promise<PostgrestResponse<any>>;
    /**
     * Update records
     */
    update<T = any>(tableName: string, updates: Partial<T>, filters: Record<string, any>, options?: {
        returning?: string;
        useRetry?: boolean;
    }): Promise<PostgrestResponse<any>>;
    /**
     * Delete records with tenant isolation
     */
    delete(tableName: string, filters: Record<string, any>, options?: {
        useRetry?: boolean;
    }): Promise<PostgrestResponse<any>>;
    /**
     * Execute RPC call with optional retry
     */
    rpc<T = any>(functionName: string, params?: Record<string, any>, options?: {
        useRetry?: boolean;
    }): Promise<PostgrestSingleResponse<any>>;
    /**
     * Get retryable task instance for custom retry logic
     */
    getRetryableTask(): RetryableTask;
    /**
     * Update retry configuration
     */
    setRetryConfig(maxAttempts: number, delayMs: number): void;
}
/**
 * Factory function to create a configured SupabaseClient
 */
export declare function createSupabaseClient(config: SupabaseClientConfig): SupabaseClient;
/**
 * Create client from environment variables
 */
export declare function createSupabaseClientFromEnv(defaultTenantId?: string): SupabaseClient;
