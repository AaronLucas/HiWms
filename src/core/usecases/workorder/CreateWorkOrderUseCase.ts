/**
 * 创建工单用例
 */
import { IWorkOrderRepository } from '../../core/ports/db/IWorkOrderRepository';

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
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: CreateWorkOrderInput): Promise<{ workOrderId: string }> {
    const workOrder = await this.workOrderRepo.create({
      tenant_id: input.tenantId,
      wave_id: input.waveId ?? null,
      task_type: input.taskType,
      related_order_id: input.relatedOrderId ?? null,
      assigned_user_id: input.assignedUserId ?? null,
      expected_duration_seconds: input.expectedDurationSeconds ?? null,
      status: 'pending',
      pda_summary: null,
    } as any);

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
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: ExecuteWorkOrderActionInput): Promise<{ logId: number }> {
    const log = await this.workOrderRepo.logAction({
      wo_id: input.workOrderId,
      action_type: input.actionType,
      from_loc_id: input.fromLocId ?? null,
      to_loc_id: input.toLocId ?? null,
      sku_id: input.skuId ?? null,
      qty_acted: input.qtyActed,
      captured_data: input.capturedData ?? null,
      start_at: input.startAt,
      end_at: input.endAt,
    } as any);

    return { logId: log.log_id };
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
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: UpdateWorkOrderStatusInput): Promise<void> {
    const updateData: any = { status: input.status };
    if (input.completedAt) {
      updateData.completed_at = input.completedAt;
    }
    await this.workOrderRepo.updateStatus(input.workOrderId, input.status);
  }
}