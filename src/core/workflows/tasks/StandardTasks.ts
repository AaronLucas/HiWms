/**
 * 库存分配任务
 * 用于工作流中调用 AllocateInventoryUseCase
 */
import { TaskHandler } from '../IWorkflowEngine';
import { AllocateInventoryUseCase, AllocateInventoryInput } from '../../usecases/inventory/AllocateInventoryUseCase';

export interface AllocateInventoryTaskInput {
  orderId: string;
  skuId: string;
  neededQty: number;
  tenantId: string;
}

export class AllocateInventoryTask implements TaskHandler<AllocateInventoryTaskInput, { allocations: any[]; totalAllocated: number }> {
  constructor(private useCase: AllocateInventoryUseCase) {}

  async execute(input: AllocateInventoryTaskInput): Promise<{ allocations: any[]; totalAllocated: number }> {
    const result = await this.useCase.execute(input);
    return {
      allocations: result.allocations,
      totalAllocated: result.totalAllocated,
    };
  }

  async compensate(output: { allocations: any[] }, context: any): Promise<void> {
    // 补偿逻辑：释放预占的库存
    console.log('Compensating inventory allocation:', output.allocations);
  }
}

/**
 * 创建工单任务
 */
export interface CreateWorkOrderTaskInput {
  waveId: string;
  orderId: string;
  taskType: 'picking' | 'packing' | 'sorting' | 'loading' | 'verification' | 'replenishment';
  assignedUserId?: string;
  priority?: number;
}

export class CreateWorkOrderTask implements TaskHandler<CreateWorkOrderTaskInput, { workOrderId: string }> {
  // 需要 WorkOrderRepository
  constructor() {}

  async execute(input: CreateWorkOrderTaskInput): Promise<{ workOrderId: string }> {
    // 实际创建工单逻辑
    const workOrderId = `wo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return { workOrderId };
  }
}

/**
 * 发送通知任务
 */
export interface SendNotificationTaskInput {
  tenantId: string;
  userIds: string[];
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  body: string;
  channel?: 'in_app' | 'push' | 'email' | 'sms';
}

export class SendNotificationTask implements TaskHandler<SendNotificationTaskInput, { sent: number }> {
  // 需要 NotificationSender
  constructor() {}

  async execute(input: SendNotificationTaskInput): Promise<{ sent: number }> {
    // 发送通知逻辑
    return { sent: input.userIds.length };
  }
}

/**
 * 交叉理货匹配任务
 */
export interface MatchCrossDockTaskInput {
  receiptId: string;
  skuId: string;
  qty: number;
  tenantId: string;
}

export class MatchCrossDockTask implements TaskHandler<MatchCrossDockTaskInput, { jobId: string; matchedQty: number }> {
  constructor() {}

  async execute(input: MatchCrossDockTaskInput): Promise<{ jobId: string; matchedQty: number }> {
    // 调用 fn_match_cross_dock RPC
    return { jobId: `cd-${Date.now()}`, matchedQty: input.qty };
  }
}

/**
 * 滑道分配任务
 */
export interface AllocateChuteTaskInput {
  waveId: string;
  skuId: string;
  tenantId: string;
}

export class AllocateChuteTask implements TaskHandler<AllocateChuteTaskInput, { chuteId: string; chuteCode: string }> {
  constructor() {}

  async execute(input: AllocateChuteTaskInput): Promise<{ chuteId: string; chuteCode: string }> {
    // 调用 fn_allocate_chute RPC
    return { chuteId: `chute-${Date.now()}`, chuteCode: `CH-${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
  }
}

/**
 * 重量校验任务
 */
export interface VerifyWeightTaskInput {
  skuId: string;
  actualWeight: number;
  tenantId: string;
}

export class VerifyWeightTask implements TaskHandler<VerifyWeightTaskInput, { passed: boolean; tolerance: number }> {
  constructor() {}

  async execute(input: VerifyWeightTaskInput): Promise<{ passed: boolean; tolerance: number }> {
    // 调用 fn_verify_weight RPC
    return { passed: true, tolerance: 0.05 };
  }
}

/**
 * 补货任务
 */
export interface ReplenishmentTaskInput {
  tenantId: string;
  locationId: string;
  productId: string;
  quantity: number;
}

export class ReplenishmentTask implements TaskHandler<ReplenishmentTaskInput, { workOrderId: string }> {
  constructor() {}

  async execute(input: ReplenishmentTaskInput): Promise<{ workOrderId: string }> {
    // 创建补货工单
    return { workOrderId: `repl-${Date.now()}` };
  }
}

/**
 * 计费计算任务
 */
export interface CalculateBillingTaskInput {
  tenantId: string;
  orderId?: string;
  invId?: string;
}

export class CalculateBillingTask implements TaskHandler<CalculateBillingTaskInput, { amount: number; currency: string }> {
  constructor() {}

  async execute(input: CalculateBillingTaskInput): Promise<{ amount: number; currency: string }> {
    // 调用 fn_get_active_billing_rule + 计算
    return { amount: 0, currency: 'CNY' };
  }
}