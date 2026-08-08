/**
 * 记录质检结果用例
 * 同时写入 result（PASS/REJECT/QUARANTINE/REWORK）与派生的 status
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';
import { QUALITY_INSPECTION_RESULT, QUALITY_INSPECTION_STATUS, type QualityInspectionResult } from '../../constants/status';

const RESULT_TO_STATUS: Record<QualityInspectionResult, string> = {
  [QUALITY_INSPECTION_RESULT.PASS]: QUALITY_INSPECTION_STATUS.PASSED,
  [QUALITY_INSPECTION_RESULT.REJECT]: QUALITY_INSPECTION_STATUS.FAILED,
  [QUALITY_INSPECTION_RESULT.QUARANTINE]: QUALITY_INSPECTION_STATUS.QUARANTINE,
  [QUALITY_INSPECTION_RESULT.REWORK]: QUALITY_INSPECTION_STATUS.REWORK,
};

export interface RecordInspectionResultInput {
  tenantId: string;
  inspectionId: string;
  result: QualityInspectionResult;
  discrepancyDetails?: Record<string, unknown>;
  notes?: string;
}

export class RecordInspectionResultUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: RecordInspectionResultInput, authToken?: string): Promise<{ inspectionId: string; result: string; status: string }> {
    const { data: inspection, error: findError } = await this.supabase
      .from('quality_inspections', false, authToken)
      .select('id, tenant_id')
      .eq('id', input.inspectionId)
      .single();

    if (findError || !inspection) throw new Error('质检单不存在');
    if ((inspection as { tenant_id: string }).tenant_id !== input.tenantId) throw new Error('质检单不存在');

    const status = RESULT_TO_STATUS[input.result];
    const { data: updated, error: updateError } = await this.supabase
      .from('quality_inspections', false, authToken)
      .update({
        result: input.result,
        status,
        discrepancy_details: input.discrepancyDetails ?? null,
        notes: input.notes ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', input.inspectionId)
      .select('id, result, status')
      .single();

    if (updateError) throw new Error(`记录质检结果失败: ${updateError.message}`);

    return {
      inspectionId: (updated as { id: string }).id,
      result: (updated as { result: string }).result,
      status: (updated as { status: string }).status,
    };
  }
}
