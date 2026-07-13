/**
 * Supabase 质检仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IQualityInspectionRepository } from '@core/ports/db/IQualityInspectionRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type QualityInspectionRow = Tables<'quality_inspections'>;
type QualityInspectionInsert = TablesInsert<'quality_inspections'>;
type QualityInspectionUpdate = TablesUpdate<'quality_inspections'>;

type InspectionItemRow = Tables<'inspection_items'>;
type InspectionItemInsert = TablesInsert<'inspection_items'>;
type InspectionItemUpdate = TablesUpdate<'inspection_items'>;

export class SupabaseQualityInspectionRepository extends SupabaseBaseRepository<
  QualityInspectionRow,
  QualityInspectionInsert,
  QualityInspectionUpdate,
  string
> implements IQualityInspectionRepository {
  protected tableName = 'quality_inspections';
  protected idColumn = 'id';

  async findByInspectionNo(inspectionNo: string, tenantId: string): Promise<QualityInspectionRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('inspection_no', inspectionNo)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as QualityInspectionRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; result?: string; orderId?: string; waveId?: string }
  ): Promise<QualityInspectionRow[]> {
    const { limit = 100, offset = 0, status, result, orderId, waveId } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (result) query = query.eq('result', result);
    if (orderId) query = query.eq('order_id', orderId);
    if (waveId) query = query.eq('wave_id', waveId);

    const { data, error } = await query;
    if (error) throw error;
    return (data as QualityInspectionRow[]) || [];
  }

  async findPending(tenantId: string): Promise<QualityInspectionRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as QualityInspectionRow[]) || [];
  }

  async findDiscrepancy(tenantId: string): Promise<QualityInspectionRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('result', 'discrepancy')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as QualityInspectionRow[]) || [];
  }

  async updateResult(inspectionId: string, result: string, details?: any): Promise<QualityInspectionRow> {
    const updateData: Partial<QualityInspectionUpdate> = { result };
    if (details) updateData.discrepancy_details = details;
    return this.update(inspectionId, updateData as QualityInspectionUpdate);
  }

  async getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    total: number;
    passed: number;
    failed: number;
    discrepancy: number;
    passRate: number;
    byInspector: Record<string, { total: number; passed: number; failed: number }>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('result, inspector_id')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const inspections = data as { result: string; inspector_id: string | null }[];

    const byInspector: Record<string, { total: number; passed: number; failed: number }> = {};
    let total = 0, passed = 0, failed = 0, discrepancy = 0;

    for (const i of inspections) {
      total++;
      if (i.result === 'passed') passed++;
      else if (i.result === 'failed') failed++;
      else if (i.result === 'discrepancy') discrepancy++;

      if (i.inspector_id) {
        if (!byInspector[i.inspector_id]) byInspector[i.inspector_id] = { total: 0, passed: 0, failed: 0 };
        byInspector[i.inspector_id].total++;
        if (i.result === 'passed') byInspector[i.inspector_id].passed++;
        else if (i.result === 'failed') byInspector[i.inspector_id].failed++;
      }
    }

    return {
      total,
      passed,
      failed,
      discrepancy,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      byInspector,
    };
  }
}