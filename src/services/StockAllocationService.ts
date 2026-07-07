import { SupabaseClient } from '../supabase/SupabaseClient';

/**
 * 库存分配服务
 * 封装 PostgreSQL 函数 fn_logic_stock_allocation
 * 实现：散货优先(picking_priority=99) → 近效期(FEFO) → 路径优化(travel_sequence)
 */
export interface AllocationResult {
  source_lpn: string;
  alloc_qty: number;
  inv_id?: string;
  remaining_qty?: number;
}

export interface AllocationRequest {
  orderId: string;
  skuId: string;
  neededQty: number;
  tenantId: string;
}

export class StockAllocationService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 执行库存分配算法
   * 返回分配计划：每行一个 LPN + 分配数量
   */
  async allocate(request: AllocationRequest): Promise<AllocationResult[]> {
    const { data, error } = await this.supabase.rpc('fn_logic_stock_allocation', {
      p_order_id: request.orderId,
      p_sku_id: request.skuId,
      p_needed_qty: request.neededQty,
    });

    if (error) {
      throw new Error(`库存分配失败: ${error.message}`);
    }

    // 标准化返回格式
    return (data || []).map((row: any) => ({
      source_lpn: row.source_lpn,
      alloc_qty: Number(row.alloc_qty),
    }));
  }

  /**
   * 批量分配多个 SKU（用于波次拣货）
   */
  async allocateBatch(requests: AllocationRequest[]): Promise<Map<string, AllocationResult[]>> {
    const results = new Map<string, AllocationResult[]>();

    for (const req of requests) {
      const allocations = await this.allocate(req);
      results.set(`${req.orderId}-${req.skuId}`, allocations);
    }

    return results;
  }

  /**
   * 预检分配可行性（不实际执行，仅返回可分配总量）
   */
  async checkAvailability(skuId: string, neededQty: number, tenantId: string): Promise<{
    available: boolean;
    totalAllocatable: number;
    shortage: number;
    details: AllocationResult[];
  }> {
    const allocations = await this.allocate({
      orderId: '00000000-0000-0000-0000-000000000000', // 临时订单ID
      skuId,
      neededQty,
      tenantId,
    });

    const totalAllocatable = allocations.reduce((sum, a) => sum + a.alloc_qty, 0);
    const shortage = Math.max(0, neededQty - totalAllocatable);

    return {
      available: shortage === 0,
      totalAllocatable,
      shortage,
      details: allocations,
    };
  }
}

export default StockAllocationService;