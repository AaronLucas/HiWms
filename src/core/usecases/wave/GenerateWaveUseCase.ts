/**
 * 生成波次用例
 * 核心策略引擎内核：批次/区域/聚类/波次策略
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';

export interface GenerateWaveInput {
  tenantId: string;
  strategyType: 'batch' | 'zone' | 'cluster' | 'wave';
  orderIds: string[];
  config?: {
    maxOrders?: number;
    maxLines?: number;
    maxQty?: number;
    zoneSequence?: string[];
  };
}

export class GenerateWaveUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: GenerateWaveInput): Promise<{
    waveId: string;
    strategyConfig: Record<string, unknown>;
    orderCount: number;
  }> {
    // 1. 根据策略类型分组订单
    // 2. 计算最优拣货路径
    // 3. 生成波次记录
    // 4. 返回波次 ID

    // 创建波次
    const waveNo = `W-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const { data: wave, error } = await this.supabase
      .from('waves')
      .insert({
        tenant_id: input.tenantId,
        wave_no: waveNo,
        status: 'planning',
        strategy_type: input.strategyType.toUpperCase(),
        strategy_config: input.config,
      })
      .select('id')
      .single();

    if (error) throw new Error(`创建波次失败: ${error.message}`);

    // 关联订单
    const mappings = input.orderIds.map(orderId => ({
      wave_id: wave.id,
      order_id: orderId,
    }));

    const { error: mappingError } = await this.supabase
      .from('wave_order_mapping')
      .insert(mappings);

    if (mappingError) throw new Error(`关联订单失败: ${mappingError.message}`);

    // 更新订单状态
    await this.supabase
      .from('orders')
      .update({ status: 'allocated', updated_at: new Date().toISOString() })
      .in('id', input.orderIds);

    return {
      waveId: wave.id,
      strategyConfig: { type: input.strategyType, ...input.config },
      orderCount: input.orderIds.length,
    };
  }
}

/**
 * 交叉理货匹配用例
 * 封装 fn_match_cross_dock RPC
 */
export interface MatchCrossDockInput {
  receiptId: string;
  skuId: string;
  qty: number;
}

export class MatchCrossDockUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: MatchCrossDockInput): Promise<{
    jobId: string;
    matchedQty: number;
    outboundOrderId: string;
    stagingLocId: string;
  }> {
    const result = await this.supabase.rpc('fn_match_cross_dock', {
      p_receipt_id: input.receiptId,
      p_sku_id: input.skuId,
      p_qty: input.qty,
    });

    return {
      jobId: result[0]?.job_id ?? '',
      matchedQty: result[0]?.matched_qty ?? 0,
      outboundOrderId: result[0]?.outbound_order_id ?? '',
      stagingLocId: result[0]?.staging_loc_id ?? '',
    };
  }
}

/**
 * 滑道分配用例
 * 封装 fn_allocate_chute RPC
 */
export interface AllocateChuteInput {
  waveId: string;
  skuId: string;
}

export class AllocateChuteUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: AllocateChuteInput): Promise<{
    chuteId: string;
    chuteCode: string;
  }> {
    const result = await this.supabase.rpc('fn_allocate_chute', {
      p_wave_id: input.waveId,
      p_sku_id: input.skuId,
    });

    return {
      chuteId: result[0]?.chute_id ?? '',
      chuteCode: result[0]?.chute_code ?? '',
    };
  }
}