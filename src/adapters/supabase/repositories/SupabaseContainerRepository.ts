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
      .eq('code', code)
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
      .order('code', { ascending: true })
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
    const { minVolume, minWeight } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_sealed', false)
      .gt('remaining_volume', 0)
      .gt('remaining_weight', 0);

    if (minVolume !== undefined) query = query.gte('max_volume', minVolume);
    if (minWeight !== undefined) query = query.gte('max_weight', minWeight);

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
    const updateData: Partial<ContainerUpdate> = {};
    if (capacity.maxVolume !== undefined) updateData.max_volume = capacity.maxVolume;
    if (capacity.maxWeight !== undefined) updateData.max_weight = capacity.maxWeight;
    if (capacity.currentVolume !== undefined) {
      updateData.current_volume = capacity.currentVolume;
      updateData.remaining_volume = (await this.findById(containerId))!.max_volume - capacity.currentVolume;
    }
    if (capacity.currentWeight !== undefined) {
      updateData.current_weight = capacity.currentWeight;
      updateData.remaining_weight = (await this.findById(containerId))!.max_weight - capacity.currentWeight;
    }
    return this.update(containerId, updateData as ContainerUpdate);
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
      .select('id, code, current_volume, current_weight, max_volume, max_weight')
      .eq('tenant_id', tenantId)
      .eq('is_sealed', false);

    if (error) throw error;
    return ((data as ContainerRow[]) || []).map(row => ({
      containerId: row.id,
      code: row.code,
      currentVolume: row.current_volume || 0,
      currentWeight: row.current_weight || 0,
      maxVolume: row.max_volume || 0,
      maxWeight: row.max_weight || 0,
      utilizationPct: row.max_volume && row.max_volume > 0
        ? Math.round((row.current_volume || 0) / row.max_volume * 100)
        : 0,
    }));
  }
}