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
  protected tableName = 'waves' as const;
  protected idColumn = 'id';

  async findByWaveNo(waveNo: string, tenantId: string): Promise<WaveRow | null> {
    const { data, error } = await (this.getClient() as any)
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
    let query = (this.getClient() as any)
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
    const { data: wave, error: waveError } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('id', waveId)
      .single();

    if (waveError) {
      if (waveError.code === 'PGRST116') return null;
      throw waveError;
    }

    const { data: orders, error: ordersError } = await (this.getClient() as any)
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
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'IN_PROGRESS')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as WaveRow[]) || [];
  }

  async findPendingRelease(tenantId: string): Promise<WaveRow[]> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'PLANNING')
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

    const { data, error } = await (this.getClient() as any)
      .from('wave_order_mapping')
      .insert(mappings as any)
      .select();

    if (error) throw error;
    return (data as WaveOrderMappingRow[]) || [];
  }

  async removeOrdersFromWave(waveId: string, orderIds: string[]): Promise<void> {
    const { error } = await (this.getClient() as any)
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
    // NOTE: wave_order_mapping 表本身没有 status 列（只有 id/wave_id/order_id），原代码 .select('order_id, status')
    // 会因为引用不存在的列在真实 Postgrest 请求中报错。status 实际来自关联的 orders 表，改为通过
    // FK (order_id -> orders.id) 内联查询 orders.status。
    const { data, error } = await (this.getClient() as any)
      .from('wave_order_mapping')
      .select('order_id, orders!inner(status)')
      .eq('wave_id', waveId);

    if (error) throw error;
    const mappings = data as { order_id: string; orders: { status: string } | null }[];

    // orders.status 约束为 PENDING/CONFIRMED/ALLOCATED/PICKING/PACKED/SHIPPED/CANCELLED/EXCEPTION（无 'PICKED'）。
    // "pickedOrders" 映射为 PICKING（分拣进行中，schema 中没有单独的"已完成分拣"态）。
    return {
      totalOrders: mappings.length,
      allocatedOrders: mappings.filter(m => m.orders?.status === 'ALLOCATED').length,
      pickedOrders: mappings.filter(m => m.orders?.status === 'PICKING').length,
      packedOrders: mappings.filter(m => m.orders?.status === 'PACKED').length,
      shippedOrders: mappings.filter(m => m.orders?.status === 'SHIPPED').length,
    };
  }

  async getStrategyStats(tenantId: string): Promise<Array<{
    strategyType: string;
    waveCount: number;
    totalOrders: number;
  }>> {
    const { data, error } = await (this.getClient() as any)
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