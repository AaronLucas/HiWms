/**
 * 创建工单用例
 */
import { IWorkOrderRepository } from '@core/ports/db/IWorkOrderRepository';

export type WorkOrderType = 'PICK' | 'PUTAWAY' | 'COUNT' | 'REPLENISH' | 'VAS' | 'RETURN';
export type WorkOrderStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXCEPTION' | 'CANCELLED';

export interface CreateWorkOrderInput {
  tenantId: string;
  type: WorkOrderType;
  orderId?: string;
  waveId?: string;
  parentWoId?: string;
  assignedUserId?: string;
  deviceId?: string;
  expectedDurationSeconds?: number;
  pdaSummary?: string;
  metadata?: Record<string, unknown>;
}

export class CreateWorkOrderUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: CreateWorkOrderInput): Promise<{ workOrderId: string }> {
    const workOrder = await this.workOrderRepo.create({
      tenant_id: input.tenantId,
      type: input.type,
      status: 'OPEN',
      order_id: input.orderId ?? null,
      wave_id: input.waveId ?? null,
      parent_wo_id: input.parentWoId ?? null,
      assigned_user_id: input.assignedUserId ?? null,
      device_id: input.deviceId ?? null,
      expected_duration_seconds: input.expectedDurationSeconds ?? null,
      pda_summary: input.pdaSummary ?? null,
      metadata: input.metadata ?? null,
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
  status: WorkOrderStatus;
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

/**
 * 接单用例
 */
export interface AcceptWorkOrderInput {
  workOrderId: string;
  userId: string;
  deviceId?: string;
}

export class AcceptWorkOrderUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: AcceptWorkOrderInput): Promise<void> {
    await this.workOrderRepo.updateStatus(input.workOrderId, 'ASSIGNED');
    // TODO: 也需要更新 assigned_user_id 和 device_id
    // 这里可以通过 update 方法实现，或者在 Repository 中添加专门方法
  }
}

/**
 * 开始执行用例
 */
export interface StartWorkOrderInput {
  workOrderId: string;
}

export class StartWorkOrderUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: StartWorkOrderInput): Promise<void> {
    await this.workOrderRepo.updateStatus(input.workOrderId, 'IN_PROGRESS');
  }
}

/**
 * 完成工单用例
 */
export interface CompleteWorkOrderInput {
  workOrderId: string;
  userId: string;
}

export class CompleteWorkOrderUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: CompleteWorkOrderInput): Promise<void> {
    await this.workOrderRepo.updateStatus(input.workOrderId, 'COMPLETED');
  }
}

/**
 * 标记异常用例
 */
export interface ExceptionWorkOrderInput {
  workOrderId: string;
  reason: string;
}

export class ExceptionWorkOrderUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: ExceptionWorkOrderInput): Promise<void> {
    await this.workOrderRepo.updateStatus(input.workOrderId, 'EXCEPTION');
    // TODO: 需要更新 exception_reason 字段
  }
}

/**
 * 获取工单详情用例
 */
export interface GetWorkOrderInput {
  workOrderId: string;
}

export interface WorkOrderOutput {
  id: string;
  tenant_id: string | null;
  type: string | null;
  status: string | null;
  order_id?: string | null;
  wave_id?: string | null;
  parent_wo_id?: string | null;
  assigned_user_id?: string | null;
  device_id?: string | null;
  expected_duration_seconds?: number | null;
  pda_summary?: string | null;
  accepted_at?: Date | null;
  completed_at?: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  metadata?: Record<string, unknown>;
}

export class GetWorkOrderUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: GetWorkOrderInput): Promise<WorkOrderOutput | null> {
    const wo = await this.workOrderRepo.findById(input.workOrderId);
    if (!wo) return null;
    return this.mapRow(wo);
  }

  private mapRow(row: any): WorkOrderOutput {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      type: row.task_type,
      status: row.status,
      order_id: row.related_order_id,
      wave_id: row.wave_id,
      parent_wo_id: row.parent_wo_id,
      assigned_user_id: row.assigned_user_id,
      device_id: row.device_id,
      expected_duration_seconds: row.expected_duration_seconds,
      pda_summary: row.pda_summary,
      accepted_at: row.accepted_at ? new Date(row.accepted_at) : null,
      completed_at: row.completed_at ? new Date(row.completed_at) : null,
      created_at: row.created_at ? new Date(row.created_at) : null,
      updated_at: row.updated_at ? new Date(row.updated_at) : null,
      metadata: undefined,
    };
  }
}

/**
 * 查询工单列表用例
 */
export interface ListWorkOrdersInput {
  tenantId?: string;
  status?: WorkOrderStatus | WorkOrderStatus[];
  type?: WorkOrderType | WorkOrderType[];
  assignedUserId?: string;
  waveId?: string;
  orderId?: string;
  parentWoId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

export interface ListWorkOrdersOutput {
  data: WorkOrderOutput[];
  total: number;
}

export class ListWorkOrdersUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: ListWorkOrdersInput): Promise<ListWorkOrdersOutput> {
    const filters: Record<string, unknown> = {};
    if (input.tenantId) filters.tenant_id = input.tenantId;
    if (input.status) filters.status = Array.isArray(input.status) ? input.status : [input.status];
    if (input.type) filters.type = Array.isArray(input.type) ? input.type : [input.type];
    if (input.assignedUserId) filters.assigned_user_id = input.assignedUserId;
    if (input.waveId) filters.wave_id = input.waveId;
    if (input.orderId) filters.related_order_id = input.orderId;
    if (input.parentWoId) filters.parent_wo_id = input.parentWoId;

    const page = input.page || 1;
    const pageSize = input.pageSize || 20;

    const [data, total] = await Promise.all([
      this.workOrderRepo.findAll({
        filters,
        orderBy: 'created_at',
        ascending: false,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
      this.workOrderRepo.count(filters),
    ]);

    return {
      data: data.map(this.mapRow),
      total,
    };
  }

  private mapRow(row: any): WorkOrderOutput {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      type: row.task_type,
      status: row.status,
      order_id: row.related_order_id,
      wave_id: row.wave_id,
      parent_wo_id: row.parent_wo_id,
      assigned_user_id: row.assigned_user_id,
      device_id: row.device_id,
      expected_duration_seconds: row.expected_duration_seconds,
      pda_summary: row.pda_summary,
      accepted_at: row.accepted_at ? new Date(row.accepted_at) : undefined,
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: undefined, // 数据库暂无 metadata 列
    };
  }
}

export interface GetWorkOrderChildrenInput {
  parentWoId: string;
}

export class GetWorkOrderChildrenUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: GetWorkOrderChildrenInput): Promise<WorkOrderOutput[]> {
    const children = await this.workOrderRepo.findByParent(input.parentWoId);
    return children.map(row => ({
      id: row.id,
      tenant_id: row.tenant_id,
      type: row.task_type,
      status: row.status,
      order_id: row.related_order_id,
      wave_id: row.wave_id,
      parent_wo_id: row.parent_wo_id,
      assigned_user_id: row.assigned_user_id,
      device_id: row.device_id,
      expected_duration_seconds: row.expected_duration_seconds,
      pda_summary: row.pda_summary,
      accepted_at: row.accepted_at ? new Date(row.accepted_at) : null,
      completed_at: row.completed_at ? new Date(row.completed_at) : null,
      created_at: row.created_at ? new Date(row.created_at) : null,
      updated_at: row.updated_at ? new Date(row.updated_at) : null,
      metadata: undefined,
    }));
  }
}

/**
 * 获取工单统计用例
 */
export interface GetWorkOrderStatsInput {
  tenantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export interface WorkOrderStatsOutput {
  total: number;
  byStatus: Record<WorkOrderStatus, number>;
  byType: Record<WorkOrderType, number>;
  avgDurationSeconds: number;
  exceptionRate: number;
  pph: number;
}

export class GetWorkOrderStatsUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  async execute(input: GetWorkOrderStatsInput): Promise<WorkOrderStatsOutput> {
    // 使用 findAll 获取数据，然后计算统计
    // 注意：这是简化实现，实际可能需要优化查询
    const workOrders = await this.workOrderRepo.findAll({
      filters: {
        tenant_id: input.tenantId,
        created_at: { gte: input.dateFrom.toISOString(), lte: input.dateTo.toISOString() }
      },
      limit: 10000, // 获取足够多数据用于统计
    });

    const stats: WorkOrderStatsOutput = {
      total: 0,
      byStatus: {} as Record<WorkOrderStatus, number>,
      byType: {} as Record<WorkOrderType, number>,
      avgDurationSeconds: 0,
      exceptionRate: 0,
      pph: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;
    let totalQty = 0;
    let totalHours = 0;

    for (const wo of workOrders) {
      stats.total++;
      stats.byStatus[wo.status as WorkOrderStatus] = (stats.byStatus[wo.status as WorkOrderStatus] || 0) + 1;
      stats.byType[wo.task_type as WorkOrderType] = (stats.byType[wo.task_type as WorkOrderType] || 0) + 1;

      if (wo.accepted_at && wo.completed_at) {
        const duration = (new Date(wo.completed_at).getTime() - new Date(wo.accepted_at).getTime()) / 1000;
        totalDuration += duration;
        completedCount++;
      }
    }

    stats.avgDurationSeconds = completedCount > 0 ? totalDuration / completedCount : 0;
    stats.exceptionRate = stats.total > 0 ? (stats.byStatus['EXCEPTION'] || 0) / stats.total : 0;
    stats.pph = totalHours > 0 ? totalQty / totalHours : 0;

    return stats;
  }
}

export default CreateWorkOrderUseCase;