// src/services/VerificationService.ts
// Phase A: 验货/质检服务 - 规则引擎、差异处理、复检流程

import { SupabaseClient } from '../supabase/SupabaseClient';

export class VerificationService {
  private supabase: SupabaseClient;

  constructor(tenantId: string) {
    this.supabase = new SupabaseClient({
      defaultTenantId: tenantId,
      url: process.env.SUPABASE_URL!,
      anonKey: process.env.SUPABASE_ANON_KEY!,
    });
  }

  // =====================================================================
  // 验货规则管理
  // =====================================================================

  async createRule(data: any): Promise<any> {
    const result = await this.supabase
      .from('verification_rules')
      .insert(data)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getRules(skuId?: string): Promise<any[]> {
    let query = this.supabase.from('verification_rules').select('*').eq('is_active', true);
    const result = await query.order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getRule(ruleId: string): Promise<any | null> {
    const result = await this.supabase
      .from('verification_rules')
      .select('*')
      .eq('rule_id', ruleId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  // =====================================================================
  // 质检单管理
  // =====================================================================

  async createInspection(data: any): Promise<any> {
    const inspectionNo = `QC-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const result = await this.supabase
      .from('quality_inspections')
      .insert({ ...data, inspection_no: inspectionNo })
      .select()
      .single();
    if (result.error) throw result.error;

    // 自动态 自动关联适用的验货规则生成检查项
    await this.generateInspectionItems(result.data.inspection_id);

    return result.data;
  }

  async getInspections(
    type?: string,
    status?: string,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    let query = this.supabase.from('quality_inspections').select('*');
    if (type) query = query.eq('inspection_type', type);
    if (status) query = query.eq('status', status);
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);
    const result = await query.order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getInspection(inspectionId: string): Promise<any | null> {
    const result = await this.supabase
      .from('quality_inspections')
      .select('*')
      .eq('inspection_id', inspectionId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async startInspection(inspectionId: string, inspectorId: string): Promise<any> {
    const result = await this.supabase
      .from('quality_inspections')
      .update({ status: 'IN_PROGRESS', inspector_id: inspectorId, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('inspection_id', inspectionId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async completeInspection(
    inspectionId: string,
    result: 'PASSED' | 'FAILED' | 'REWORK',
    inspectorId: string
  ): Promise<any> {
    const update: any = { status: result, completed_at: new Date().toISOString() };
    const r = await this.supabase
      .from('quality_inspections')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('inspection_id', inspectionId)
      .select()
      .single();
    if (r.error) throw r.error;

    // 如果是入库质检失败，自动生成退货/隔离工单
    if (result === 'FAILED' || result === 'REWORK') {
      await this.handleFailedInspection(inspectionId, result);
    }

    return r.data;
  }

  // =====================================================================
  // 检查项管理
  // =====================================================================

  async getInspectionItems(inspectionId: string): Promise<any[]> {
    const result = await this.supabase
      .from('inspection_items')
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async recordItemResult(itemId: string, actualValue: string, result: 'PASS' | 'FAIL' | 'WARNING'): Promise<any> {
    const itemResult = await this.supabase
      .from('inspection_items')
      .update({ actual_value: actualValue, result, updated_at: new Date().toISOString() })
      .eq('item_id', itemId)
      .select()
      .single();
    if (itemResult.error) throw itemResult.error;
    return itemResult.data;
  }

  // =====================================================================
  // 复检流程
  // =====================================================================

  async createReworkInspection(originalInspectionId: string, reason: string): Promise<any> {
    const original = await this.getInspection(originalInspectionId);
    if (!original) throw new Error('Original inspection not found');

    const reworkData = {
      tenant_id: original.tenant_id,
      inspection_type: original.inspection_type,
      source_ref_type: original.source_ref_type,
      source_ref_id: original.source_ref_id,
      sku_id: original.sku_id,
      lot_no: original.lot_no,
      qty_inspected: original.qty_inspected,
    };

    const rework = await this.createInspection(reworkData);

    // 关联原质检单
    await this.supabase
      .from('quality_inspections')
      .update({ rework_of: originalInspectionId, rework_reason: reason })
      .eq('inspection_id', rework.inspection_id);

    return rework;
  }

  // =====================================================================
  // 内部辅助
  // =====================================================================

  private async generateInspectionItems(inspectionId: string): Promise<void> {
    const inspection = await this.getInspection(inspectionId);
    if (!inspection) return;

    // 查找适用的规则
    const rules = await this.getApplicableRules(inspection.sku_id);
    if (rules.length === 0) return;

    const items = rules.map(rule => ({
      inspection_id: inspectionId,
      rule_id: rule.rule_id,
      check_item: rule.rule_name,
      expected_value: JSON.stringify(rule.tolerance),
      result: 'PENDING',
    }));

    if (items.length > 0) {
      const result = await this.supabase.from('inspection_items').insert(items);
      if (result.error) throw result.error;
    }
  }

  private async getApplicableRules(skuId?: string): Promise<any[]> {
    if (!skuId) return [];
    return this.getRules();
  }

  private async handleFailedInspection(inspectionId: string, disposition: 'FAILED' | 'REWORK'): Promise<void> {
    const inspection = await this.getInspection(inspectionId);
    if (!inspection) return;

    // TODO: 集成 WorkOrderService 创建退货/隔离工单
    console.log(`Inspection ${inspectionId} failed with disposition ${disposition}, needs exception handling`);
  }
}