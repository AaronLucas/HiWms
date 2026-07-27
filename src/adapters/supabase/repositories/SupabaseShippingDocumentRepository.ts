/**
 * Supabase 发货单据仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IShippingDocumentRepository } from '@core/ports/db/IShippingDocumentRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';
import { SHIPPING_DOCUMENT_STATUS } from '../../../core/constants/status';

type ShippingDocumentRow = Tables<'shipping_documents'>;
type ShippingDocumentInsert = TablesInsert<'shipping_documents'>;
type ShippingDocumentUpdate = TablesUpdate<'shipping_documents'>;

export class SupabaseShippingDocumentRepository extends SupabaseBaseRepository<
  ShippingDocumentRow,
  ShippingDocumentInsert,
  ShippingDocumentUpdate,
  string
> implements IShippingDocumentRepository {
  protected tableName = 'shipping_documents' as const;
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
    options?: { limit?: number; offset?: number; docType?: string; status?: string }
  ): Promise<ShippingDocumentRow[]> {
    const { limit = 100, offset = 0, docType, status } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('issued_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (docType) query = query.eq('doc_type', docType);
    if (status) query = query.eq('status', status);

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

  async updateStatus(docId: string, status: string, issuedAt?: string): Promise<ShippingDocumentRow> {
    // NOTE: shipping_documents.status 约束为 DRAFT/ISSUED/SIGNED/ARCHIVED，没有 'shipped'/'pending'。
    // 业务语义上"单据已签发/生成"对应 ISSUED，映射为该值。
    const updateData: Partial<ShippingDocumentUpdate> = { status };
    if (issuedAt) updateData.issued_at = issuedAt;
    else if (status === SHIPPING_DOCUMENT_STATUS.ISSUED) updateData.issued_at = new Date().toISOString();
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
      // NOTE: 映射同上：ISSUED≈已签发("shipped" 字段名沿用原接口), DRAFT≈待处理("pending")。
      if (d.status === SHIPPING_DOCUMENT_STATUS.ISSUED) shipped++;
      else if (d.status === SHIPPING_DOCUMENT_STATUS.DRAFT) pending++;
      byCarrier[d.doc_type] = (byCarrier[d.doc_type] || 0) + 1;
    }

    return { totalDocs, shipped, pending, byCarrier };
  }
}