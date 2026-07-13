/**
 * Supabase 发货单据仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IShippingDocumentRepository } from '@core/ports/db/IShippingDocumentRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type ShippingDocumentRow = Tables<'shipping_documents'>;
type ShippingDocumentInsert = TablesInsert<'shipping_documents'>;
type ShippingDocumentUpdate = TablesUpdate<'shipping_documents'>;

export class SupabaseShippingDocumentRepository extends SupabaseBaseRepository<
  ShippingDocumentRow,
  ShippingDocumentInsert,
  ShippingDocumentUpdate,
  string
> implements IShippingDocumentRepository {
  protected tableName = 'shipping_documents';
  protected idColumn = 'id';

  async findByDocNo(docNo: string, tenantId: string): Promise<ShippingDocumentRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('doc_number', docNo)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ShippingDocumentRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; carrier?: string }
  ): Promise<ShippingDocumentRow[]> {
    const { limit = 100, offset = 0, status, carrier } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (carrier) query = query.ilike('doc_type', `%${carrier}%`);

    const { data, error } = await query;
    if (error) throw error;
    return (data as ShippingDocumentRow[]) || [];
  }

  async findByLoadingTask(loadingTaskId: string): Promise<ShippingDocumentRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('loading_task_id', loadingTaskId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as ShippingDocumentRow[]) || [];
  }

  async findPendingPrint(tenantId: string): Promise<ShippingDocumentRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_print')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as ShippingDocumentRow[]) || [];
  }

  async findPendingShip(tenantId: string): Promise<ShippingDocumentRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_ship')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as ShippingDocumentRow[]) || [];
  }

  async updateStatus(docId: string, status: string, extra?: { trackingNo?: string; shippedAt?: string }): Promise<ShippingDocumentRow> {
    const updateData: Partial<ShippingDocumentUpdate> = { status };
    if (extra?.trackingNo) updateData.file_url = extra.trackingNo;
    if (extra?.shippedAt) updateData.issued_at = extra.shippedAt;
    else if (status === 'shipped') updateData.issued_at = new Date().toISOString();
    return this.update(docId, updateData as ShippingDocumentUpdate);
  }

  async getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalDocs: number;
    shipped: number;
    pending: number;
    byCarrier: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('status, doc_type')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const docs = data as { status: string; doc_type: string }[];

    let totalDocs = 0, shipped = 0, pending = 0;
    const byCarrier: Record<string, number> = {};

    for (const d of docs) {
      totalDocs++;
      if (d.status === 'shipped') shipped++;
      else if (d.status === 'pending') pending++;
      byCarrier[d.doc_type] = (byCarrier[d.doc_type] || 0) + 1;
    }

    return { totalDocs, shipped, pending, byCarrier };
  }
}