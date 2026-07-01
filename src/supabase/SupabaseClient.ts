/**
 * Supabase client wrapper
 * Provides client instance with proper error handling and tenant context
 */
export class SupabaseClient {
  private client: any;
  private tenantId: string | null = null;

  constructor(tenantId?: string) {
    this.tenantId = tenantId;
    this.client = supabase.createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
  }

  /**
   * Execute a query with tenant_id filtering automatically applied
   * @param tableName string - Supabase table name
   * @param queryFunction function that receives knex-like query builder
   * @returns Promise of query result
   */
  async query<T = any>(tableName: string, queryFunction: (q: any) => Promise<T>): Promise<T> {
    try {
      const query = this.client.from(tableName).select('*');

      // Apply tenant filter if tenantId is set
      if (this.tenantId) {
        query.eq('tenant_id', this.tenantId);
      }

      // Apply the provided query function to extend the query
      return await queryFunction(query);
    } catch (error) {
      console.error('Supabase query error:', error);
      throw new Error(`Supabase query failed for table ${tableName}: ${error.message}`);
    }
  }

  /**
   * Upsert operation with tenant isolation
   */
  async upsert<T = any>(tableName: string, records: T[], tenantId: string): Promise<T[]> {
    try {
      const query = this.client.from(tableName).upsert(records, { onConflict: 'tenant_id' });

      if (tenantId) {
        query.eq('tenant_id', tenantId);
      }

      const { data, error } = await query.select('*');
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Supabase upsert error:', error);
      throw new Error(`Supabase upsert failed on table ${tableName}: ${error.message}`);
    }
  }

  /**
   * Delete operation with tenant isolation
   */
  async delete(tableName: string, tenantId: string, condition?: Record<string, any>): Promise<void> {
    try {
      let query = this.client.from(tableName).delete().eq('tenant_id', tenantId);

      if (condition) {
        Object.entries(condition).forEach(([key, value]) => {
          query.eq(key, value);
        });
      }

      const { error } = await query;
      if (error) throw error;
    } catch (error) {
      console.error('Supabase delete error:', error);
      throw new Error(`Supabase delete failed on table ${tableName}: ${error.message}`);
    }
  }

  /**
   * RPC call execution
   */
  async rpc<T = any>(functionName: string, params: Record<string, any> = {}): Promise<T> {
    try {
      const response = await this.client.rpc(functionName, params);
      if (response.error) throw new Error(response.error.message);
      return response.data as T;
    } catch (error) {
      console.error(`RPC call ${functionName} failed: ${error.message}`);
      throw new Error(`RPC call failed: ${error.message}`);
    }
  }
}