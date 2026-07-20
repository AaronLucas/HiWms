/**
 * Supabase 序列号（一货一码）持久化追踪仓储实现
 * 对应表：inventory_units；序列号定位视图：v_serial_lookup
 * 只读为主，写入路径见 IInventoryUnitRepository 顶部注释
 */
import { IInventoryUnitRepository, InventoryUnitRow, SerialLookupRow } from '@core/ports/db/IInventoryUnitRepository';
import { WmsSupabaseClient } from '../SupabaseClient';

export class SupabaseInventoryUnitRepository implements IInventoryUnitRepository {
  constructor(private supabase: WmsSupabaseClient) {}

  private getClient(): ReturnType<WmsSupabaseClient['getClient']> {
    return this.supabase.getClient();
  }

  async findBySerial(tenantId: string, productId: string, serial: string): Promise<InventoryUnitRow | null> {
    const { data, error } = await this.getClient()
      .from('inventory_units')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .eq('serial_number', serial)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as InventoryUnitRow;
  }

  async findByLocation(locationId: string): Promise<InventoryUnitRow[]> {
    const { data, error } = await this.getClient()
      .from('inventory_units')
      .select('*')
      .eq('location_id', locationId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryUnitRow[]) || [];
  }

  async findByStatus(tenantId: string, status: string): Promise<InventoryUnitRow[]> {
    const { data, error } = await this.getClient()
      .from('inventory_units')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', status)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryUnitRow[]) || [];
  }

  async findByOrderLine(orderLineId: string): Promise<InventoryUnitRow[]> {
    const { data, error } = await this.getClient()
      .from('inventory_units')
      .select('*')
      .eq('order_line_id', orderLineId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryUnitRow[]) || [];
  }

  async serialLookup(tenantId: string, serial: string): Promise<SerialLookupRow | null> {
    const { data, error } = await this.getClient()
      .from('v_serial_lookup')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('serial_number', serial)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as SerialLookupRow;
  }
}
