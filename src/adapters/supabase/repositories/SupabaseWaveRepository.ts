/**
 * Supabase 波次仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IWaveRepository } from '@core/ports/db/IWaveRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type WaveRow = Tables<'waves'>;
type WaveInsert = TablesInsert<'waves'>;
type WaveUpdate = TablesUpdate<'waves'>;

type WaveOrderMappingRow = Tables<'wave_order_mapping'>;
type WaveOrderMappingInsert = TablesInsert<'wave_order_mapping'>;
type WaveOrderMappingUpdate = TablesUpdate<'wave_order_mapping'>;

export class SupabaseWaveRepository extends SupabaseBaseRepository<
  WaveRow,
  WaveInsert,
  WaveUpdate,
  string
> implements IWaveRepository {
  protected tableName = 'waves';
  protected idColumn = 'id';

  async findByWaveNo(waveNo: string, tenantId: string): Promise<WaveRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('wave_no', waveNo)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as WaveRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; strategyType?: string }
  ): Promise<WaveRow[]> {
    const { limit = 100, offset = 0, status, strategyType } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (strategyType) query = query.eq('strategy_type', strategyType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as WaveRow[]) || [];
  }

  async findWithOrders(waveId: string): Promise<{
    wave: WaveRow;
    orders: WaveOrderMappingRow[];
  } | null> {
    const { data: wave, error: waveError } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('id', waveId)
      .single();

    if (waveError) {
      if (waveError.code === 'PGRST116') return null;
      throw waveError;
    }

    const { data: orders, error: ordersError } = await this.getClient()
      .from('wave_order_mapping')
      .select('*')
      .eq('wave_id', waveId)
      .order('created_at', { ascending: true });

    if (ordersError) throw ordersError;

    return {
      wave: wave as WaveRow,
      orders: (orders as WaveOrderMappingRow[]) || [],
    };
  }

  async findInProgress(tenantId: string): Promise<WaveRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .in('status', ['created', 'allocated', 'picking', 'packing', 'loading'])
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as WaveRow[]) || [];
  }

  async findPendingRelease(tenantId: string): Promise<WaveRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_release')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as WaveRow[]) || [];
  }

  async updateStatus(waveId: string, status: string): Promise<WaveRow> {
    return this.update(waveId, { status } as WaveUpdate);
  }

  async addOrdersToWave(waveId: string, orderIds: string[]): Promise<WaveOrderMappingRow[]> {
    const mappings = orderIds.map((orderId, index) => ({
      wave_id: waveId,
      order_id: orderId,
      sequence: index + 1,
    }));

    const { data, error } = await this.getClient()
      .from('wave_order_mapping')
      .insert(mappings as any)
      .select();

    if (error) throw error;
    return (data as WaveOrderMappingRow[]) || [];
  }

  async removeOrdersFromWave(waveId: string, orderIds: string[]): Promise<void> {
    const { error } = await this.getClient()
      .from('wave_order_mapping')
      .delete()
      .eq('wave_id', waveId)
      .in('order_id', orderIds);

    if (error) throw error;
  }

  async getProgress(waveId: string): Promise<{
    totalOrders: number;
    allocatedOrders: number;
    pickedOrders: number;
    packedOrders: number;
    shippedOrders: number;
  }> {
    const { data, error } = await this.getClient()
      .from('wave_order_mapping')
      .select('order_id, status')
      .eq('wave_id', waveId);

    if (error) throw error;
    const mappings = data as { status: string }[];

    return {
      totalOrders: mappings.length,
      allocatedOrders: mappings.filter(m => m.status === 'allocated').length,
      pickedOrders: mappings.filter(m => m.status === 'picked').length,
      packedOrders: mappings.filter(m => m.status === 'packed').length,
      shippedOrders: mappings.filter(m => m.status === 'shipped').length,
    };
  }

  async getStrategyStats(tenantId: string): Promise<Array<{
    strategyType: string;
    waveCount: number;
    totalOrders: number;
  }>> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('strategy_type, id')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const rows = data as { strategy_type: string }[];

    const stats = new Map<string, { count: number; totalOrders: number }>();
    for (const row of rows) {
      const existing = stats.get(row.strategy_type) || { count: 0, totalOrders: 0 };
      existing.count++;
      stats.set(row.strategy_type, existing);
    }

    return Array.from(stats.entries()).map(([strategyType, { count, totalOrders }]) => ({
      strategyType,
      waveCount: count,
      totalOrders,
    }));
  }
}