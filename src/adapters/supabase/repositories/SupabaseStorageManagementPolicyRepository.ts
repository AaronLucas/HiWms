/**
 * Supabase 存储管理策略仓储实现
 * 对应表：storage_management_policies
 * 封装 fn_get_storage_policy / fn_check_storage_usage / fn_run_storage_maintenance
 *
 * 【重要】写方法（create/update）只能从 admin-api 调用，不能暴露给 device-api，
 * 详见 IStorageManagementPolicyRepository 顶部注释。
 */
import {
  IStorageManagementPolicyRepository,
  StorageManagementPolicyRow,
  StorageManagementPolicyInsert,
  StorageManagementPolicyUpdate,
  StorageUsageStatus,
} from '@core/ports/db/IStorageManagementPolicyRepository';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';
import { WmsSupabaseClient } from '../SupabaseClient';

export class SupabaseStorageManagementPolicyRepository implements IStorageManagementPolicyRepository {
  private readonly tableName = 'storage_management_policies';

  constructor(
    private supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {}

  private getClient(useAdmin = false): ReturnType<WmsSupabaseClient['getClient']> {
    return useAdmin ? this.supabase.getAdminClient() : this.supabase.getClient();
  }

  async getEffectivePolicy(tenantId?: string): Promise<StorageManagementPolicyRow | null> {
    const result = await this.rpcClient.raw(
      'fn_get_storage_policy',
      { p_tenant_id: tenantId },
      { injectTenantId: false }
    );
    return (result as StorageManagementPolicyRow | null) ?? null;
  }

  async checkStorageUsage(): Promise<StorageUsageStatus> {
    const result = await this.rpcClient.raw('fn_check_storage_usage', {} as never, { injectTenantId: false });
    const [row] = (result as Array<{ current_size_bytes: number; used_pct: number; status: string }>) || [];
    return {
      currentSizeBytes: row?.current_size_bytes ?? 0,
      usedPct: row?.used_pct ?? 0,
      status: row?.status ?? 'OK',
    };
  }

  async runMaintenance(): Promise<string> {
    const result = await this.rpcClient.raw('fn_run_storage_maintenance', {} as never, { injectTenantId: false });
    return result as string;
  }

  /** 平台管理员专用写操作，仅限 admin-api 调用 */
  async create(policy: StorageManagementPolicyInsert): Promise<StorageManagementPolicyRow> {
    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .insert(policy as any)
      .select()
      .single();

    if (error) throw error;
    return data as StorageManagementPolicyRow;
  }

  /** 平台管理员专用写操作，仅限 admin-api 调用 */
  async update(id: string, policy: StorageManagementPolicyUpdate): Promise<StorageManagementPolicyRow> {
    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .update(policy as any)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as StorageManagementPolicyRow;
  }

  async findAll(): Promise<StorageManagementPolicyRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .order('tenant_id', { ascending: true, nullsFirst: true });

    if (error) throw error;
    return (data as StorageManagementPolicyRow[]) || [];
  }

  async findByTenant(tenantId: string | null): Promise<StorageManagementPolicyRow | null> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*');

    query = tenantId === null ? query.is('tenant_id', null) : query.eq('tenant_id', tenantId);

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as StorageManagementPolicyRow;
  }
}
