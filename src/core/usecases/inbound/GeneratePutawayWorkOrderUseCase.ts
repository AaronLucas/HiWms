/**
 * 生成上架工单用例
 * 入库单必须已 RECEIVED 才能触发上架
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';
import { INBOUND_RECEIPT_STATUS, WORK_ORDER_STATUS } from '../../constants/status';

export interface GeneratePutawayWorkOrderInput {
  tenantId: string;
  receiptId: string;
  assignedUserId?: string;
}

export class GeneratePutawayWorkOrderUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: GeneratePutawayWorkOrderInput, authToken?: string): Promise<{ workOrderId: string }> {
    const { data: receipt, error: findError } = await this.supabase
      .from('inbound_receipts', false, authToken)
      .select('id, tenant_id, status, wave_id, receipt_no')
      .eq('id', input.receiptId)
      .single();

    if (findError || !receipt) throw new Error('入库单不存在');
    const r = receipt as { tenant_id: string; status: string | null; wave_id: string | null; receipt_no: string };
    if (r.tenant_id !== input.tenantId) throw new Error('入库单不存在');
    if (r.status !== INBOUND_RECEIPT_STATUS.RECEIVED) {
      throw new Error(`入库单当前状态为 ${r.status}，须先完成收货才能生成上架工单`);
    }

    const { data: workOrder, error: createError } = await this.supabase
      .from('work_orders', false, authToken)
      .insert({
        tenant_id: input.tenantId,
        wave_id: r.wave_id,
        task_type: 'putaway',
        assigned_user_id: input.assignedUserId ?? null,
        status: WORK_ORDER_STATUS.OPEN,
        pda_summary: `入库单 ${r.receipt_no} 上架`,
      })
      .select('id')
      .single();

    if (createError) throw new Error(`生成上架工单失败: ${createError.message}`);
    if (!(workOrder as { id?: string })?.id) throw new Error('Putaway work order creation returned no id');

    return { workOrderId: (workOrder as { id: string }).id };
  }
}
