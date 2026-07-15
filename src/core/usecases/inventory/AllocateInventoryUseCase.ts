/**
 * 库存分配用例
 * 封装 fn_logic_stock_allocation RPC 调用
 */
import { IStockAllocationRpc } from '../../ports/rpc/IStockAllocationRpc';
import { IInventoryRepository } from '../../ports/db/IInventoryRepository';

export interface AllocateInventoryInput {
  orderId: string;
  skuId: string;
  neededQty: number;
  tenantId: string;
}

export interface AllocationResult {
  allocations: Array<{
    inventoryId: string;
    sourceLpn: string;
    allocatedQty: number;
    locationId: string;
  }>;
  totalAllocated: number;
  isFullyAllocated: boolean;
}

export class AllocateInventoryUseCase {
  constructor(
    private stockAllocationRpc: IStockAllocationRpc,
    private inventoryRepo: IInventoryRepository
  ) {}

  async execute(input: AllocateInventoryInput): Promise<AllocationResult> {
    // 1. 调用 RPC 执行分配逻辑（散货优先 → FEFO → 入库时间早）
    const rpcResult = await this.stockAllocationRpc.allocate({
      p_order_id: input.orderId,
      p_sku_id: input.skuId,
      p_needed_qty: input.neededQty,
    });

    // 2. 转换 RPC 结果为领域模型
    const allocations = rpcResult.map(item => ({
      inventoryId: item.source_lpn, // RPC 返回 source_lpn，实际可能需要查询 inventory 表
      sourceLpn: item.source_lpn,
      allocatedQty: item.alloc_qty,
      locationId: '', // 需要从 inventory 查询补充
    }));

    const totalAllocated = allocations.reduce((sum, a) => sum + a.allocatedQty, 0);
    const isFullyAllocated = totalAllocated >= input.neededQty;

    // 3. 可选：更新本地库存缓存/预占记录
    // await this.inventoryRepo.updateQuantities(...)

    return {
      allocations,
      totalAllocated,
      isFullyAllocated,
    };
  }
}

/**
 * 库存预占用例
 * 用于锁定库存防止超卖
 */
export interface ReserveInventoryInput {
  inventoryId: string;
  orderId: string;
  quantity: number;
  expiresAt: Date;
}

export class ReserveInventoryUseCase {
  constructor(private inventoryRepo: IInventoryRepository) {}

  async execute(input: ReserveInventoryInput): Promise<boolean> {
    // 创建预占记录
    // 实际实现需要调用数据库插入 inventory_reservations
    // 这里简化返回 true
    return true;
  }

  async releaseReservation(reservationId: string): Promise<void> {
    // 释放预占
  }
}

/**
 * 库存可用性检查用例
 */
export interface CheckAvailabilityInput {
  productId: string;
  tenantId: string;
  locationId?: string;
  excludeReserved?: boolean;
}

export class CheckAvailabilityUseCase {
  constructor(private inventoryRepo: IInventoryRepository) {}

  async execute(input: CheckAvailabilityInput): Promise<{
    totalQty: number;
    availableQty: number;
    reservedQty: number;
    byLocation: Array<{ locationId: string; qty: number }>;
  }> {
    const inventory = await this.inventoryRepo.findAvailable(input.productId, input.locationId);

    const totalQty = inventory.reduce((sum, item) => sum + item.quantity, 0);
    // 实际实现需要扣除预占量

    return {
      totalQty,
      availableQty: totalQty,
      reservedQty: 0,
      byLocation: inventory.map(item => ({
        locationId: item.location_id || '',
        qty: item.quantity,
      })),
    };
  }
}