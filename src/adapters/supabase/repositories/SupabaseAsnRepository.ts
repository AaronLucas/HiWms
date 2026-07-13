/**
 * Supabase ASN 仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IAsnRepository } from '@core/ports/db/IAsnRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type AsnRow = Tables<'inbound_receipts'>;
type AsnInsert = TablesInsert<'inbound_receipts'>;
type AsnUpdate = TablesUpdate<'inbound_receipts'>;

export class SupabaseAsnRepository extends SupabaseBaseRepository<
  AsnRow,
  AsnInsert,
  AsnUpdate,
  string
> implements IAsnRepository {
  protected tableName = 'inbound_receipts';
  protected idColumn = 'id';

  async findByAsnNo(asnNo: string, tenantId: string): Promise<AsnRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('receipt_no', asnNo)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as AsnRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; supplierName?: string }
  ): Promise<AsnRow[]> {
    const { limit = 100, offset = 0, status, supplierName } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (supplierName) query = query.ilike('supplier_name', `%${supplierName}%`);

    const { data, error } = await query;
    if (error) throw error;
    return (data as AsnRow[]) || [];
  }

  async findPendingReceipt(tenantId: string): Promise<AsnRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('expected_at', { ascending: true });

    if (error) throw error;
    return (data as AsnRow[]) || [];
  }

  async findCompleted(tenantId: string, options?: { limit?: number; offset?: number }): Promise<AsnRow[]> {
    const { limit = 100, offset = 0 } = options || {};
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return (data as AsnRow[]) || [];
  }

  async updateStatus(asnId: string, status: string, receivedAt?: string): Promise<AsnRow> {
    const updateData: Partial<AsnUpdate> = { status };
    if (receivedAt) updateData.received_at = receivedAt;
    if (status === 'completed') updateData.received_at = new Date().toISOString();
    return this.update(asnId, updateData as AsnUpdate);
  }

  async assignWave(asnId: string, waveId: string): Promise<AsnRow> {
    return this.update(asnId, { wave_id: waveId } as AsnUpdate);
  }

  async getSupplierStats(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    supplierName: string;
    asnCount: number;
    totalQty: number;
  }>> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('supplier_name, id')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const rows = data as { supplier_name: string; id: string }[];
    const stats = new Map<string, { count: number; totalQty: number }>();

    for (const row of rows) {
      const existing = stats.get(row.supplier_name) || { count: 0, totalQty: 0 };
      existing.count++;
      stats.set(row.supplier_name, existing);
    }

    return Array.from(stats.entries()).map(([supplierName, { count, totalQty }]) => ({
      supplierName,
      asnCount: count,
      totalQty,
    }));
  }
}