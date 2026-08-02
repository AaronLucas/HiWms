/**
 * 入库单收货用例
 * PENDING/RECEIVING → RECEIVED
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';
import { INBOUND_RECEIPT_STATUS } from '../../constants/status';

export interface ReceiveInboundReceiptInput {
  tenantId: string;
  receiptId: string;
  receivedAt?: string;
}

export class ReceiveInboundReceiptUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: ReceiveInboundReceiptInput, authToken?: string): Promise<{ receiptId: string; status: string; receivedAt: string }> {
    const { data: receipt, error: findError } = await this.supabase
      .from('inbound_receipts', false, authToken)
      .select('id, tenant_id, status')
      .eq('id', input.receiptId)
      .single();

    if (findError || !receipt) throw new Error('入库单不存在');
    if ((receipt as { tenant_id: string }).tenant_id !== input.tenantId) throw new Error('入库单不存在');

    const currentStatus = (receipt as { status: string | null }).status;
    if (currentStatus !== INBOUND_RECEIPT_STATUS.PENDING && currentStatus !== INBOUND_RECEIPT_STATUS.RECEIVING) {
      throw new Error(`入库单当前状态为 ${currentStatus}，无法收货`);
    }

    const receivedAt = input.receivedAt ?? new Date().toISOString();
    const { data: updated, error: updateError } = await this.supabase
      .from('inbound_receipts', false, authToken)
      .update({ status: INBOUND_RECEIPT_STATUS.RECEIVED, received_at: receivedAt })
      .eq('id', input.receiptId)
      .select('id, status, received_at')
      .single();

    if (updateError) throw new Error(`收货失败: ${updateError.message}`);

    return {
      receiptId: (updated as { id: string }).id,
      status: (updated as { status: string }).status,
      receivedAt: (updated as { received_at: string }).received_at,
    };
  }
}
