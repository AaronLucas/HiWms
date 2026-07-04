import { createClient, } from '@supabase/supabase-js';
import { RetryableTask } from 'wms-workflow-engine';
/**
 * Custom error classes for Supabase operations
 */
export class SupabaseError extends Error {
    constructor(message, code, originalError) {
        super(message);
        this.code = code;
        this.originalError = originalError;
        this.name = 'SupabaseError';
    }
}
export class SupabaseConnectionError extends SupabaseError {
    constructor(message, originalError) {
        super(message, 'CONNECTION_ERROR', originalError);
        this.name = 'SupabaseConnectionError';
    }
}
export class SupabaseQueryError extends SupabaseError {
    constructor(message, table, originalError) {
        super(message, 'QUERY_ERROR', originalError);
        this.table = table;
        this.name = 'SupabaseQueryError';
    }
}
export class SupabaseMutationError extends SupabaseError {
    constructor(message, table, operation, originalError) {
        super(message, 'MUTATION_ERROR', originalError);
        this.table = table;
        this.operation = operation;
        this.name = 'SupabaseMutationError';
    }
}
export class SupabaseRPCError extends SupabaseError {
    constructor(message, functionName, originalError) {
        super(message, 'RPC_ERROR', originalError);
        this.functionName = functionName;
        this.name = 'SupabaseRPCError';
    }
}
export class SupabaseTenantError extends SupabaseError {
    constructor(message, tenantId) {
        super(message, 'TENANT_ERROR');
        this.tenantId = tenantId;
        this.name = 'SupabaseTenantError';
    }
}
/**
 * Supabase client wrapper with enhanced type safety, error handling, and retry logic
 */
export class SupabaseClient {
    constructor(config) {
        this.tenantId = null;
        const url = config?.url || process.env.SUPABASE_URL;
        const anonKey = config?.anonKey || process.env.SUPABASE_ANON_KEY;
        if (!url || !anonKey) {
            throw new SupabaseTenantError('Supabase URL and anon key are required', config?.defaultTenantId || 'unknown');
        }
        this.tenantId = config?.defaultTenantId || null;
        this.client = createClient(config?.url || process.env.SUPABASE_URL, config?.anonKey || process.env.SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
            },
        });
        // Initialize retryable task for automatic retries
        this.retryableTask = new RetryableTask(config?.retryConfig?.maxAttempts ?? 3, config?.retryConfig?.baseDelayMs ?? 1000);
    }
    /**
     * Set tenant context for subsequent operations
     */
    setTenantId(tenantId) {
        this.tenantId = tenantId;
    }
    /**
     * Get current tenant ID
     */
    getTenantId() {
        return this.tenantId;
    }
    /**
     * Clear tenant context
     */
    clearTenantId() {
        this.tenantId = null;
    }
    /**
     * Get the underlying Supabase client for advanced operations
     */
    getClient() {
        return this.client;
    }
    /**
     * Direct access to the underlying Supabase query builder
     */
    from(tableName) {
        return this.client.from(tableName);
    }
    /**
     * Build a type-safe query with automatic tenant filtering
     */
    buildQuery(tableName) {
        let query = this.client.from(tableName);
        if (this.tenantId) {
            query = query.eq('tenant_id', this.tenantId);
        }
        return query;
    }
    /**
     * Execute a query with optional retry logic and tenant filtering
     */
    async query(tableName, queryFunction, options) {
        const executeQuery = async () => {
            const query = this.buildQuery(tableName);
            return await queryFunction(query);
        };
        try {
            if (options?.useRetry) {
                return await this.retryableTask.execute(() => executeQuery());
            }
            return await executeQuery();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new SupabaseQueryError(`Query failed for table ${tableName}: ${message}`, tableName, error instanceof Error ? error : undefined);
        }
    }
    /**
     * Select data with type safety
     */
    async select(tableName, columns = '*', options) {
        return this.query(tableName, (query) => query.select(columns), { useRetry: true });
    }
    /**
     * Select single row by ID
     */
    async selectById(tableName, id, columns = '*') {
        return this.query(tableName, (query) => query.select(columns).eq('id', id).single());
    }
    /**
     * Select with filters
     */
    async selectWhere(tableName, filters, columns = '*', options) {
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
    async insert(tableName, records, options) {
        const recordsArray = Array.isArray(records) ? records : [records];
        // Add tenant_id to each record if tenant context exists
        const recordsWithTenant = recordsArray.map((record) => ({
            ...record,
            ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
        }));
        return this.query(tableName, (query) => {
            let q = query.insert(recordsArray, {
                returning: options?.returning || 'representation',
            });
            return q;
        }, { useRetry: options?.useRetry ?? true });
    }
    /**
     * Upsert records (insert or update on conflict)
     */
    async upsert(tableName, records, conflictColumns = 'id', options) {
        const recordsArray = Array.isArray(records) ? records : [records];
        // Add tenant_id to each record if tenant context exists
        const recordsWithTenant = recordsArray.map((record) => ({
            ...record,
            ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
        }));
        return this.query(tableName, (query) => query.upsert(recordsWithTenant, {
            onConflict: Array.isArray(conflictColumns) ? conflictColumns.join(',') : conflictColumns,
            returning: options?.returning || 'representation',
        }), { useRetry: options?.useRetry ?? true });
    }
    /**
     * Update records
     */
    async update(tableName, updates, filters, options) {
        // Ensure tenant isolation for updates
        const filtersWithTenant = {
            ...filters,
            ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
        };
        return this.query(tableName, (query) => query.update(updates, {
            returning: options?.returning || 'representation',
        }).match(filtersWithTenant), { useRetry: options?.useRetry ?? true });
    }
    /**
     * Delete records with tenant isolation
     */
    async delete(tableName, filters, options) {
        const filtersWithTenant = {
            ...filters,
            ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
        };
        return this.query(tableName, (query) => query.delete().match(filtersWithTenant), { useRetry: options?.useRetry ?? true });
    }
    /**
     * Execute RPC call with optional retry
     */
    async rpc(functionName, params = {}, options) {
        const executeRpc = async () => {
            const { data, error } = await this.client.rpc(functionName, params);
            if (error)
                throw error;
            return { data, error: null };
        };
        try {
            if (options?.useRetry) {
                return await this.retryableTask.execute(() => executeRpc());
            }
            return await executeRpc();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new SupabaseRPCError(`RPC call ${functionName} failed: ${message}`, functionName, error instanceof Error ? error : undefined);
        }
    }
    /**
     * Get retryable task instance for custom retry logic
     */
    getRetryableTask() {
        return this.retryableTask;
    }
    /**
     * Update retry configuration
     */
    setRetryConfig(maxAttempts, delayMs) {
        this.retryableTask = new RetryableTask(maxAttempts, delayMs);
    }
}
/**
 * Factory function to create a configured SupabaseClient
 */
export function createSupabaseClient(config) {
    return new SupabaseClient(config);
}
/**
 * Create client from environment variables
 */
export function createSupabaseClientFromEnv(defaultTenantId) {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        throw new SupabaseTenantError('SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required', defaultTenantId || 'unknown');
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
