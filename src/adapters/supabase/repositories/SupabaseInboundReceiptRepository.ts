/**
 * Supabase 入库单仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IInboundReceiptRepository } from '@core/ports/db/IInboundReceiptRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type InboundReceiptRow = Tables<'inbound_receipts'>;
type InboundReceiptInsert = TablesInsert<'inbound_receipts'>;
type InboundReceiptUpdate = TablesUpdate<'inbound_receipts'>;

type InspectionItemRow = Tables<'inspection_items'>;
type InspectionItemInsert = TablesInsert<'inspection_items'>;
type InspectionItemUpdate = TablesUpdate<'inspection_items'>;

export class SupabaseInboundReceiptRepository extends SupabaseBaseRepository<
  InboundReceiptRow,
  InboundReceiptInsert,
  InboundReceiptUpdate,
  string
> implements IInboundReceiptRepository {
  protected tableName = 'inbound_receipts';
  protected idColumn = 'id';

  async findByReceiptNo(receiptNo: string, tenantId: string): Promise<InboundReceiptRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('receipt_no', receiptNo)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as InboundReceiptRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; supplierName?: string }
  ): Promise<InboundReceiptRow[]> {
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
    return (data as InboundReceiptRow[]) || [];
  }

  async findWithItems(receiptId: string): Promise<{
    receipt: InboundReceiptRow;
    items: InspectionItemRow[];
  } | null> {
    const { data: receipt, error: receiptError } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('id', receiptId)
      .single();

    if (receiptError) {
      if (receiptError.code === 'PGRST116') return null;
      throw receiptError;
    }

    const { data: items, error: itemsError } = await this.getClient()
      .from('inspection_items')
      .select('*')
      .eq('receipt_id', receiptId)
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    return {
      receipt: receipt as InboundReceiptRow,
      items: (items as InspectionItemRow[]) || [],
    };
  }

  async findPendingReceipt(tenantId: string): Promise<InboundReceiptRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('expected_at', { ascending: true });

    if (error) throw error;
    return (data as InboundReceiptRow[]) || [];
  }

  async findPendingInspection(tenantId: string): Promise<InboundReceiptRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'received')
      .order('received_at', { ascending: true });

    if (error) throw error;
    return (data as InboundReceiptRow[]) || [];
  }

  async findCompleted(tenantId: string, options?: { limit?: number; offset?: number }): Promise<InboundReceiptRow[]> {
    const { limit = 100, offset = 0 } = options || {};
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return (data as InboundReceiptRow[]) || [];
  }

  async updateStatus(receiptId: string, status: string, receivedAt?: string): Promise<InboundReceiptRow> {
    const updateData: Partial<InboundReceiptUpdate> = { status };
    if (receivedAt) updateData.received_at = receivedAt;
    if (status === 'completed') updateData.completed_at = new Date().toISOString();
    return this.update(receiptId, updateData as InboundReceiptUpdate);
  }

  async assignWave(receiptId: string, waveId: string): Promise<InboundReceiptRow> {
    return this.update(receiptId, { wave_id: waveId } as InboundReceiptUpdate);
  }

  async createInspectionItems(items: InspectionItemInsert[]): Promise<InspectionItemRow[]> {
    const { data, error } = await this.getClient()
      .from('inspection_items')
      .insert(items as any)
      .select();

    if (error) throw error;
    return (data as InspectionItemRow[]) || [];
  }

  async updateInspectionItem(itemId: string, data: Partial<InspectionItemUpdate>): Promise<InspectionItemRow> {
    const { data, error } = await this.getClient()
      .from('inspection_items')
      .update(data as any)
      .eq('id', itemId)
      .select()
      .single();

    if (error) throw error;
    return data as InspectionItemRow;
  }

  async getInspectionSummary(receiptId: string): Promise<{
    totalItems: number;
    passedItems: number;
    failedItems: number;
    pendingItems: number;
  }> {
    const { data, error } = await this.getClient()
      .from('inspection_items')
      .select('status')
      .eq('receipt_id', receiptId);

    if (error) throw error;
    const items = data as { status: string }[];
    return {
      totalItems: items.length,
      passedItems: items.filter(i => i.status === 'passed').length,
      failedItems: items.filter(i => i.status === 'failed').length,
      pendingItems: items.filter(i => i.status === 'pending').length,
    };
  }

  async getSupplierStats(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    supplierName: string;
    receiptCount: number;
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
      receiptCount: count,
      totalQty,
    }));
  }
}