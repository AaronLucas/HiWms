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
  protected tableName = 'quality_inspections' as const;
  protected idColumn = 'id';

  async findByInspectionNo(inspectionNo: string, tenantId: string): Promise<QualityInspectionRow | null> {
    const { data, error } = await (this.getClient() as any)
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
    let query = (this.getClient() as any)
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

  async findWithItems(inspectionId: string): Promise<{
    inspection: QualityInspectionRow;
    items: InspectionItemRow[];
  } | null> {
    const { data: inspection, error: inspectionError } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('id', inspectionId)
      .single();

    if (inspectionError) {
      if (inspectionError.code === 'PGRST116') return null;
      throw inspectionError;
    }

    const { data: items, error: itemsError } = await (this.getClient() as any)
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    return {
      inspection: inspection as QualityInspectionRow,
      items: (items as InspectionItemRow[]) || [],
    };
  }

  async findPendingInspection(tenantId: string): Promise<QualityInspectionRow[]> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as QualityInspectionRow[]) || [];
  }

  async findPendingReinspection(tenantId: string): Promise<QualityInspectionRow[]> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      // NOTE: 'reinspect' 不在 chk_quality_inspections_status 约束内（PENDING/IN_PROGRESS/PASSED/FAILED/QUARANTINE/REWORK/CANCELLED），
      // 且没有语义完全对应的值（REWORK/QUARANTINE 都不精确等价于"待复检"）。保留原值，未修复，需产品/DBA 决策。
      .eq('status', 'reinspect')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as QualityInspectionRow[]) || [];
  }

  async findPending(tenantId: string): Promise<QualityInspectionRow[]> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as QualityInspectionRow[]) || [];
  }

  async findDiscrepancy(tenantId: string): Promise<QualityInspectionRow[]> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      // NOTE: 'discrepancy' 不在 chk_quality_inspections_result 约束内（PASS/REJECT/QUARANTINE/REWORK），
      // 没有明确对应"异常/差异"的值。保留原值，未修复，需产品/DBA 决策。
      .eq('result', 'discrepancy')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as QualityInspectionRow[]) || [];
  }

  async updateResult(inspectionId: string, result: string, details?: any): Promise<QualityInspectionRow> {
    const updateData: Partial<QualityInspectionUpdate> = {
      result,
      discrepancy_details: details || null
    };
    return this.update(inspectionId, updateData as QualityInspectionUpdate);
  }

  async updateStatus(inspectionId: string, status: string, completedAt?: string): Promise<QualityInspectionRow> {
    const updateData: Partial<QualityInspectionUpdate> = { status };
    if (completedAt) updateData.completed_at = completedAt;
    else if (status === 'PASSED' || status === 'FAILED') updateData.completed_at = new Date().toISOString();
    return this.update(inspectionId, updateData as QualityInspectionUpdate);
  }

  async createInspectionItems(items: InspectionItemInsert[]): Promise<InspectionItemRow[]> {
    const { data: insertedData, error } = await (this.getClient() as any)
      .from('inspection_items')
      .insert(items as any)
      .select();

    if (error) throw error;
    return (insertedData as InspectionItemRow[]) || [];
  }

  async updateInspectionItem(itemId: string, data: Partial<InspectionItemUpdate>): Promise<InspectionItemRow> {
    const { data: updatedData, error } = await (this.getClient() as any)
      .from('inspection_items')
      .update(data as any)
      .eq('id', itemId)
      .select()
      .single();

    if (error) throw error;
    return updatedData as InspectionItemRow;
  }

  async getInspectionSummary(inspectionId: string): Promise<{
    totalItems: number;
    passedItems: number;
    failedItems: number;
    pendingItems: number;
  }> {
    // NOTE: inspection_items 表没有 result/status 列，只有 boolean `passed`（可为 null 表示未检）。
    // 原代码 .select('result') 引用了不存在的列，会在真实 Postgrest 请求中报错。改为查询真实列 `passed`。
    const { data, error } = await (this.getClient() as any)
      .from('inspection_items')
      .select('passed')
      .eq('inspection_id', inspectionId);

    if (error) throw error;
    const items = data as { passed: boolean | null }[];
    return {
      totalItems: items.length,
      passedItems: items.filter(i => i.passed === true).length,
      failedItems: items.filter(i => i.passed === false).length,
      pendingItems: items.filter(i => i.passed === null || i.passed === undefined).length,
    };
  }

  async getInspectorPerformance(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    inspectorId: string;
    inspectorName: string;
    inspectionCount: number;
    passedCount: number;
    failedCount: number;
    avgDurationMinutes: number;
  }>> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('inspector_id, result, status, started_at, completed_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const inspections = data as { inspector_id: string; result: string; status: string; started_at: string | null; completed_at: string | null }[];

    const byInspector = new Map<string, {
      count: number;
      passed: number;
      failed: number;
      durations: number[];
    }>();

    for (const i of inspections) {
      if (!i.inspector_id) continue;
      const existing = byInspector.get(i.inspector_id) || { count: 0, passed: 0, failed: 0, durations: [] };
      existing.count++;
      if (i.result === 'PASS') existing.passed++;
      else if (i.result === 'REJECT') existing.failed++;
      if (i.started_at && i.completed_at) {
        existing.durations.push((new Date(i.completed_at).getTime() - new Date(i.started_at).getTime()) / 60000);
      }
      byInspector.set(i.inspector_id, existing);
    }

    return Array.from(byInspector.entries()).map(([inspectorId, { count, passed, failed, durations }]) => ({
      inspectorId,
      inspectorName: '',
      inspectionCount: count,
      passedCount: passed,
      failedCount: failed,
      avgDurationMinutes: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    }));
  }

  async getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    total: number;
    passed: number;
    failed: number;
    discrepancy: number;
    passRate: number;
    byInspector: Record<string, { total: number; passed: number; failed: number }>;
  }> {
    const { data, error } = await (this.getClient() as any)
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
      if (i.result === 'PASS') passed++;
      else if (i.result === 'REJECT') failed++;
      // NOTE: 'discrepancy' 在 chk_quality_inspections_result 约束（PASS/REJECT/QUARANTINE/REWORK）中无明确对应值，
      // 保留原比较（'discrepancy' 永远不匹配，discrepancy 计数将恒为 0），未修复，需产品/DBA 决策。
      else if (i.result === 'discrepancy') discrepancy++;

      if (i.inspector_id) {
        if (!byInspector[i.inspector_id]) byInspector[i.inspector_id] = { total: 0, passed: 0, failed: 0 };
        byInspector[i.inspector_id].total++;
        if (i.result === 'PASS') byInspector[i.inspector_id].passed++;
        else if (i.result === 'REJECT') byInspector[i.inspector_id].failed++;
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