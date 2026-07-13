/**
 * Supabase 滑道仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ISortingChuteRepository } from '@core/ports/db/ISortingChuteRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type SortingChuteRow = Tables<'sorting_chutes'>;
type SortingChuteInsert = TablesInsert<'sorting_chutes'>;
type SortingChuteUpdate = TablesUpdate<'sorting_chutes'>;

export class SupabaseSortingChuteRepository extends SupabaseBaseRepository<
  SortingChuteRow,
  SortingChuteInsert,
  SortingChuteUpdate,
  string
> implements ISortingChuteRepository {
  protected tableName = 'sorting_chutes';
  protected idColumn = 'id';

  async findByWave(waveId: string): Promise<SortingChuteRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('wave_id', waveId)
      .order('sort_sequence', { ascending: true });

    if (error) throw error;
    return (data as SortingChuteRow[]) || [];
  }

  async findByTarget(targetId: string, targetType: string): Promise<SortingChuteRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('target_id', targetId)
      .eq('target_type', targetType);

    if (error) throw error;
    return (data as SortingChuteRow[]) || [];
  }

  async findAvailable(
    tenantId: string,
    waveId?: string,
    options?: { targetType?: string; minCapacity?: number }
  ): Promise<SortingChuteRow[]> {
    const { targetType, minCapacity } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .gt('capacity', 0);

    if (waveId) query = query.eq('wave_id', waveId);
    if (targetType) query = query.eq('target_type', targetType);
    if (minCapacity) query = query.gte('capacity', minCapacity);

    const { data, error } = await query;
    if (error) throw error;
    return (data as SortingChuteRow[]) || [];
  }

  async updateCurrentQty(chuteId: string, currentQty: number): Promise<SortingChuteRow> {
    return this.update(chuteId, { current_qty: currentQty } as SortingChuteUpdate);
  }

  async updateStatus(chuteId: string, status: string): Promise<SortingChuteRow> {
    return this.update(chuteId, { status } as SortingChuteUpdate);
  }

  async createBatch(chutes: SortingChuteInsert[]): Promise<SortingChuteRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .insert(chutes as any)
      .select();

    if (error) throw error;
    return (data as SortingChuteRow[]) || [];
  }

  async getUtilizationStats(tenantId: string, waveId?: string): Promise<Array<{
    chuteId: string;
    chuteCode: string;
    capacity: number;
    currentQty: number;
    utilizationPct: number;
    targetId: string | null;
    targetType: string;
  }>> {
    let query = this.getClient()
      .from(this.tableName)
      .select('id, chute_code, capacity, current_qty, target_id, target_type, wave_id')
      .eq('tenant_id', tenantId);

    if (waveId) query = query.eq('wave_id', waveId);

    const { data, error } = await query;
    if (error) throw error;

    return ((data as SortingChuteRow[]) || []).map(row => ({
      chuteId: row.id,
      chuteCode: row.chute_code,
      capacity: row.capacity || 0,
      currentQty: row.current_qty || 0,
      utilizationPct: row.capacity && row.capacity > 0 ? Math.round((row.current_qty || 0) / row.capacity * 100) : 0,
      targetId: row.target_id,
      targetType: row.target_type,
    }));
  }
}