/**
 * Supabase 库存预留仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IInventoryReservationRepository } from '@core/ports/db/IInventoryReservationRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type InventoryReservationRow = Tables<'inventory_reservations'>;
type InventoryReservationInsert = TablesInsert<'inventory_reservations'>;
type InventoryReservationUpdate = TablesUpdate<'inventory_reservations'>;

export class SupabaseInventoryReservationRepository extends SupabaseBaseRepository<
  InventoryReservationRow,
  InventoryReservationInsert,
  InventoryReservationUpdate,
  string
> implements IInventoryReservationRepository {
  protected tableName = 'inventory_reservations';
  protected idColumn = 'id';

  async findByInventory(inventoryId: string): Promise<InventoryReservationRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('inventory_id', inventoryId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryReservationRow[]) || [];
  }

  async findByOrder(orderId: string): Promise<InventoryReservationRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryReservationRow[]) || [];
  }

  async findActiveByTenant(tenantId: string): Promise<InventoryReservationRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryReservationRow[]) || [];
  }

  async createReservation(data: InventoryReservationInsert): Promise<InventoryReservationRow> {
    return this.create(data);
  }

  async releaseReservation(reservationId: string): Promise<void> {
    await this.update(reservationId, { is_active: false, released_at: new Date().toISOString() } as InventoryReservationUpdate);
  }

  async releaseExpiredReservations(): Promise<number> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .update({ is_active: false, released_at: new Date().toISOString() })
      .eq('is_active', true)
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) throw error;
    return (data as { id: string }[]).length;
  }

  async getReservationStats(tenantId: string): Promise<{
    totalReservations: number;
    activeReservations: number;
    expiredReservations: number;
    reservedQuantity: number;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('quantity, is_active, expires_at')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const reservations = data as { quantity: number; is_active: boolean; expires_at: string | null }[];

    let totalReservations = 0, activeReservations = 0, expiredReservations = 0, reservedQuantity = 0;

    for (const r of reservations) {
      totalReservations++;
      if (r.is_active && (!r.expires_at || new Date(r.expires_at) > new Date())) {
        activeReservations++;
        reservedQuantity += r.quantity;
      } else if (r.expires_at && new Date(r.expires_at) <= new Date()) {
        expiredReservations++;
      }
    }

    return { totalReservations, activeReservations, expiredReservations, reservedQuantity };
  }
}