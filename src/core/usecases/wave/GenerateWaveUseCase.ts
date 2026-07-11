/**
 * 生成波次用例
 * 核心策略引擎内核：批次/区域/聚类/波次策略
 */
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
  async execute(input: GenerateWaveInput): Promise<{
    waveId: string;
    strategyConfig: Record<string, unknown>;
    orderCount: number;
  }> {
    // 1. 根据策略类型分组订单
    // 2. 计算最优拣货路径
    // 3. 生成波次记录
    // 4. 返回波次 ID

    return {
      waveId: `wave-${Date.now()}`,
      strategyConfig: { type: input.strategyType, ...input.config },
      orderCount: input.orderIds.length,
    };
  }
}

/**
 * 交叉理货匹配用例
 * 封装 fn_match_cross_dock RPC
 */
import { ICrossDockRpc } from '../../core/ports/rpc/ICrossDockRpc';

export interface MatchCrossDockInput {
  receiptId: string;
  skuId: string;
  qty: number;
}

export class MatchCrossDockUseCase {
  constructor(private crossDockRpc: ICrossDockRpc) {}

  async execute(input: MatchCrossDockInput): Promise<{
    jobId: string;
    matchedQty: number;
    outboundOrderId: string;
    stagingLocId: string;
  }> {
    const result = await this.crossDockRpc.match({
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
import { IChuteAllocationRpc } from '../../core/ports/rpc/IChuteAllocationRpc';

export interface AllocateChuteInput {
  waveId: string;
  skuId: string;
}

export class AllocateChuteUseCase {
  constructor(private chuteAllocationRpc: IChuteAllocationRpc) {}

  async execute(input: AllocateChuteInput): Promise<{
    chuteId: string;
    chuteCode: string;
  }> {
    const result = await this.chuteAllocationRpc.allocate({
      p_wave_id: input.waveId,
      p_sku_id: input.skuId,
    });

    return {
      chuteId: result.chute_id,
      chuteCode: result.chute_code,
    };
  }
}