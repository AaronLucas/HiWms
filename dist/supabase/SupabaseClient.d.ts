/**
 * Supabase client wrapper
 * Provides client instance with proper error handling and tenant context
 */
export declare class SupabaseClient {
    private client;
    private tenantId;
    constructor(tenantId?: string);
    /**
     * Execute a query with tenant_id filtering automatically applied
     * @param tableName string - Supabase table name
     * @param queryFunction function that receives knex-like query builder
     * @returns Promise of query result
     */
    query<T = any>(tableName: string, queryFunction: (q: any) => Promise<T>): Promise<T>;
    /**
     * Upsert operation with tenant isolation
     */
    upsert<T = any>(tableName: string, records: T[], tenantId: string): Promise<T[]>;
    /**
     * Delete operation with tenant isolation
     */
    delete(tableName: string, tenantId: string, condition?: Record<string, any>): Promise<void>;
    /**
     * RPC call execution
     */
    rpc<T = any>(functionName: string, params?: Record<string, any>): Promise<T>;
}
