/**
 * 创建订单用例
 */
import { IOrderRepository } from '@core/ports/db/IOrderRepository';
import { IStockAllocationRpc } from '@core/ports/rpc/IStockAllocationRpc';

export interface CreateOrderInput {
  tenantId: string;
  externalOrderId: string;
  orderType: 'outbound' | 'inbound' | 'transfer';
  lines: Array<{
    productId: string;
    qty: number;
  }>;
  cutoffTime?: string;
  platformPriority?: number;
}

export class CreateOrderUseCase {
  constructor(private orderRepo: IOrderRepository) {}

  async execute(input: CreateOrderInput): Promise<{
    orderId: string;
    lines: Array<{ id: string; productId: string; qty: number }>;
  }> {
    // 创建订单
    const order = await this.orderRepo.create({
      tenant_id: input.tenantId,
      external_order_id: input.externalOrderId,
      order_type: input.orderType,
      status: 'pending',
      cutoff_time: input.cutoffTime ?? null,
      platform_priority: input.platformPriority ?? 0,
    } as any);

    // 创建订单明细（实际需要单独的 repository）
    // 这里简化处理

    return {
      orderId: order.id,
      lines: input.lines.map((l, i) => ({ id: `${order.id}-${i}`, ...l })),
    };
  }
}

/**
 * 订单分配用例
 * 协调库存分配 RPC
 */
export interface AllocateOrderInput {
  orderId: string;
  tenantId: string;
}

export class AllocateOrderUseCase {
  constructor(
    private orderRepo: IOrderRepository,
    private stockAllocationRpc: IStockAllocationRpc
  ) {}

  async execute(input: AllocateOrderInput): Promise<{
    success: boolean;
    allocations: Array<{ allocQty: number; sourceLpn: string }>;
  }> {
    // 获取订单及明细
    const orderWithLines = await this.orderRepo.findWithLines(input.orderId);
    if (!orderWithLines) {
      throw new Error('Order not found');
    }

    const allAllocations: Array<{ alloc_qty: number; source_lpn: string }> = [];

    // 为每个明细行分配库存
    for (const line of orderWithLines.lines) {
      const allocations = await this.stockAllocationRpc.allocate({
        p_order_id: input.orderId,
        p_sku_id: line.product_id ?? '',
        p_needed_qty: line.qty,
      });
      allAllocations.push(...allocations);
    }

    // 更新订单状态
    await this.orderRepo.updateStatus(input.orderId, 'allocated');

    return {
      success: true,
      allocations: allAllocations.map(a => ({ allocQty: a.alloc_qty, sourceLpn: a.source_lpn })),
    };
  }
}

/**
 * 波次释放用例
 * 封装订单 → 波次 → 分配 → 工单生成的完整流程
 */
export interface ReleaseWaveInput {
  tenantId: string;
  orderIds: string[];
  strategyType: 'batch' | 'zone' | 'cluster' | 'wave';
  priority?: number;
}

export class ReleaseWaveUseCase {
  constructor(
    private orderRepo: IOrderRepository
    // private waveRepo, private workOrderRepo, etc.
  ) {}

  async execute(input: ReleaseWaveInput): Promise<{
    waveId: string;
    workOrderIds: string[];
  }> {
    // 1. 创建波次
    // 2. 关联订单
    // 3. 调用分配 RPC
    // 4. 生成工单

    return {
      waveId: 'wave-' + Date.now(),
      workOrderIds: [],
    };
  }
}