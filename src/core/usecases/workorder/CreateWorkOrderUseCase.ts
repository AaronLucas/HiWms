/**
 * 创建工单用例
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';

export interface CreateWorkOrderInput {
  tenantId: string;
  waveId?: string;
  taskType: 'picking' | 'packing' | 'loading' | 'replenishment' | 'putaway' | 'sorting';
  relatedOrderId?: string;
  assignedUserId?: string;
  expectedDurationSeconds?: number;
  metadata?: Record<string, unknown>;
}

export class CreateWorkOrderUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: CreateWorkOrderInput): Promise<{ workOrderId: string }> {
    const { data: workOrder, error } = await this.supabase
      .from('work_orders')
      .insert({
        tenant_id: input.tenantId,
        wave_id: input.waveId ?? null,
        task_type: input.taskType,
        related_order_id: input.relatedOrderId ?? null,
        assigned_user_id: input.assignedUserId ?? null,
        expected_duration_seconds: input.expectedDurationSeconds ?? null,
        status: 'PENDING',
        pda_summary: null,
        metadata: input.metadata ?? null,
      })
      .select('id')
      .single();

    if (error) throw new Error(`创建工单失败: ${error.message}`);
    if (!workOrder?.id) throw new Error('Work order creation returned no id');

    return { workOrderId: workOrder.id };
  }
}

/**
 * 执行工单动作用例
 * 记录 wo_action_logs（扫码、移库、计数等操作日志）
 */
export interface ExecuteWorkOrderActionInput {
  workOrderId: string;
  userId: string;
  actionType: 'scan' | 'move' | 'count' | 'pick' | 'pack' | 'load' | 'verify';
  fromLocId?: string;
  toLocId?: string;
  skuId?: string;
  qtyActed: number;
  capturedData?: Record<string, unknown>;
  startAt: string;
  endAt: string;
}

export class ExecuteWorkOrderActionUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: ExecuteWorkOrderActionInput): Promise<{ logId: number }> {
    const { data, error } = await this.supabase
      .from('wo_action_logs')
      .insert({
        wo_id: input.workOrderId,
        action_type: input.actionType.toUpperCase(),
        from_loc_id: input.fromLocId ?? null,
        to_loc_id: input.toLocId ?? null,
        sku_id: input.skuId ?? null,
        qty_acted: input.qtyActed,
        captured_data: input.capturedData ?? null,
        start_at: input.startAt,
        end_at: input.endAt,
      })
      .select('log_id')
      .single();

    if (error) throw new Error(`记录工单动作失败: ${error.message}`);
    if (!data?.log_id) throw new Error('Action log creation returned no id');

    return { logId: data.log_id };
  }
}

/**
 * 更新工单状态用例
 */
export interface UpdateWorkOrderStatusInput {
  workOrderId: string;
  status: 'pending' | 'dispatched' | 'in_progress' | 'completed' | 'cancelled' | 'exception';
  completedAt?: string;
}

export class UpdateWorkOrderStatusUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: UpdateWorkOrderStatusInput): Promise<void> {
    const updateData: any = {
      status: input.status.toUpperCase(),
      updated_at: new Date().toISOString(),
    };
    if (input.completedAt) {
      updateData.completed_at = input.completedAt;
    }
    if (input.status === 'completed' && !input.completedAt) {
      updateData.completed_at = new Date().toISOString();
    }

    const { error } = await this.supabase
      .from('work_orders')
      .update(updateData)
      .eq('id', input.workOrderId);

    if (error) throw new Error(`更新工单状态失败: ${error.message}`);
  }
}