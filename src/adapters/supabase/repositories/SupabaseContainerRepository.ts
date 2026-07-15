/**
 * Supabase 容器/LPN 仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IContainerRepository } from '@core/ports/db/IContainerRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type ContainerRow = Tables<'containers'>;
type ContainerInsert = TablesInsert<'containers'>;
type ContainerUpdate = TablesUpdate<'containers'>;

export class SupabaseContainerRepository extends SupabaseBaseRepository<
  ContainerRow,
  ContainerInsert,
  ContainerUpdate,
  string
> implements IContainerRepository {
  protected tableName = 'containers';
  protected idColumn = 'id';

  async findByCode(code: string, tenantId: string): Promise<ContainerRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('lpn_code', code)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ContainerRow;
  }

  async findByParent(parentContainerId: string): Promise<ContainerRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('parent_container_id', parentContainerId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; containerType?: string }
  ): Promise<ContainerRow[]> {
    const { limit = 100, offset = 0, status, containerType } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('lpn_code', { ascending: true })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (containerType) query = query.eq('container_type', containerType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }

  async findAvailable(
    tenantId: string,
    options?: { minVolume?: number; minWeight?: number }
  ): Promise<ContainerRow[]> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_sealed', false)
      .eq('status', 'active');

    const { data, error } = await query;
    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }

  async updateSealStatus(containerId: string, isSealed: boolean): Promise<ContainerRow> {
    return this.update(containerId, { is_sealed: isSealed } as ContainerUpdate);
  }

  async updateCapacity(
    containerId: string,
    capacity: { maxVolume?: number; maxWeight?: number; currentVolume?: number; currentWeight?: number }
  ): Promise<ContainerRow> {
    // containers 表没有容量字段，只能更新状态
    // 实际容量管理通过 inventory 表关联实现
    return this.update(containerId, {} as ContainerUpdate);
  }

  async getUtilizationStats(tenantId: string): Promise<Array<{
    containerId: string;
    code: string;
    currentVolume: number;
    currentWeight: number;
    maxVolume: number;
    maxWeight: number;
    utilizationPct: number;
  }>> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('id, lpn_code')
      .eq('tenant_id', tenantId)
      .eq('is_sealed', false);

    if (error) throw error;
    return ((data as ContainerRow[]) || []).map(row => ({
      containerId: row.id,
      code: row.lpn_code,
      currentVolume: 0,
      currentWeight: 0,
      maxVolume: 0,
      maxWeight: 0,
      utilizationPct: 0,
    }));
  }
}