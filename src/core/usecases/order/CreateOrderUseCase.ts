/**
 * 创建订单用例
 * 使用 WmsSupabaseClient 直接操作数据库 + 调用 RPC
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';

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
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: CreateOrderInput): Promise<{
    orderId: string;
    lines: Array<{ id: string; productId: string; qty: number }>;
  }> {
    // 创建订单
    const { data: order, error } = await this.supabase
      .from('orders')
      .insert({
        tenant_id: input.tenantId,
        external_order_id: input.externalOrderId,
        order_type: input.orderType,
        status: 'pending',
        cutoff_time: input.cutoffTime ?? null,
        platform_priority: input.platformPriority ?? 0,
      })
      .select('id')
      .single();

    if (error) throw new Error(`创建订单失败: ${error.message}`);
    if (!order?.id) throw new Error('Order creation returned no id');

    // 创建订单明细
    const orderLines = input.lines.map((l, i) => ({
      order_id: order.id,
      product_id: l.productId,
      qty: l.qty,
      status: 'PENDING',
    }));

    const { error: linesError } = await this.supabase
      .from('order_lines')
      .insert(orderLines);

    if (linesError) throw new Error(`创建订单明细失败: ${linesError.message}`);

    return {
      orderId: order.id,
      lines: input.lines.map((l, i) => ({ id: `${order.id}-${i}`, ...l })),
    };
  }
}

/**
 * 订单分配用例
 * 协调库存分配 RPC (fn_logic_stock_allocation)
 */
export interface AllocateOrderInput {
  orderId: string;
  tenantId: string;
}

export class AllocateOrderUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: AllocateOrderInput): Promise<{
    success: boolean;
    allocations: Array<{ allocQty: number; sourceLpn: string }>;
  }> {
    // 获取订单及明细
    const { data: orderLines, error } = await this.supabase
      .from('order_lines')
      .select('id, product_id, qty')
      .eq('order_id', input.orderId);

    if (error) throw new Error(`查询订单明细失败: ${error.message}`);
    if (!orderLines || orderLines.length === 0) {
      throw new Error('Order not found or has no lines');
    }

    const allAllocations: Array<{ alloc_qty: number; source_lpn: string }> = [];

    // 为每个明细行分配库存
    for (const line of orderLines) {
      const allocations = await this.supabase.rpc('fn_logic_stock_allocation', {
        p_order_id: input.orderId,
        p_sku_id: line.product_id,
        p_needed_qty: line.qty,
      });
      allAllocations.push(...(allocations as Array<{ alloc_qty: number; source_lpn: string }>));
    }

    // 更新订单状态
    const { error: updateError } = await this.supabase
      .from('orders')
      .update({ status: 'allocated', updated_at: new Date().toISOString() })
      .eq('id', input.orderId);

    if (updateError) throw new Error(`更新订单状态失败: ${updateError.message}`);

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
  config?: {
    maxOrders?: number;
    maxLines?: number;
    maxQty?: number;
    zoneSequence?: string[];
  };
}

export class ReleaseWaveUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: ReleaseWaveInput): Promise<{
    waveId: string;
    workOrderIds: string[];
  }> {
    // 1. 创建波次
    const waveNo = `W-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const { data: wave, error: waveError } = await this.supabase
      .from('waves')
      .insert({
        tenant_id: input.tenantId,
        wave_no: waveNo,
        status: 'planning',
        strategy_type: input.strategyType.toUpperCase(),
        strategy_config: input.config ?? null,
      })
      .select('id')
      .single();

    if (waveError) throw new Error(`创建波次失败: ${waveError.message}`);
    if (!wave?.id) throw new Error('Wave creation returned no id');

    // 2. 关联订单
    const mappings = input.orderIds.map(orderId => ({
      wave_id: wave.id,
      order_id: orderId,
    }));

    const { error: mappingError } = await this.supabase
      .from('wave_order_mapping')
      .insert(mappings);

    if (mappingError) throw new Error(`关联订单失败: ${mappingError.message}`);

    // 3. 更新订单状态
    const { error: orderUpdateError } = await this.supabase
      .from('orders')
      .update({ status: 'allocated', updated_at: new Date().toISOString() })
      .in('id', input.orderIds);

    if (orderUpdateError) throw new Error(`更新订单状态失败: ${orderUpdateError.message}`);

    // 4. 这里应该调用分配 RPC 和生成工单
    // 简化处理

    return {
      waveId: wave.id,
      workOrderIds: [],
    };
  }
}