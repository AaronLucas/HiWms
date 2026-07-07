import { SupabaseClient } from '../supabase/SupabaseClient';

/**
 * 黑盒入库服务
 * 封装 PostgreSQL 函数 fn_logic_resolve_blackbox_box
 * 场景：扫描箱码(LPN)不扫货，系统自动推断箱内 SKU/数量/批次，插入库存并标记箱子为"已开封散货箱"(picking_priority=99)
 */
export interface BlackboxReceiveRequest {
  lpnCode: string;
  skuId: string;
  qty: number;
  batchNo?: string;
  tenantId: string;
  mfgDate?: string; // YYYY-MM-DD
  expDate?: string; // YYYY-MM-DD
}

export interface BlackboxReceiveResult {
  success: boolean;
  inventoryId?: string;
  containerId?: string;
  message?: string;
}

export class BlackboxReceivingService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 执行黑盒入库：扫箱不扫货
   * 1. 查找容器
   * 2. 插入库存记录(picking_priority=99 表示已开封散货，优先拣选)
   * 3. 更新容器 is_sealed=false, last_opened_at=now()
   */
  async receive(request: BlackboxReceiveRequest): Promise<BlackboxReceiveResult> {
    const { data, error } = await this.supabase.rpc('fn_logic_resolve_blackbox_box', {
      p_lpn_code: request.lpnCode,
      p_sku_id: request.skuId,
      p_qty: request.qty,
      p_batch: request.batchNo || null,
    });

    if (error) {
      return {
        success: false,
        message: `黑盒入库失败: ${error.message}`,
      };
    }

    // 获取刚插入的库存 ID（通过容器和 SKU 查询最新记录）
    const { data: inv } = await this.supabase
      .from('inventory')
      .select('id, container_id')
      .eq('product_id', request.skuId)
      .eq('container_id', (await this.getContainerId(request.lpnCode)) || '')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return {
      success: true,
      inventoryId: inv?.id,
      containerId: inv?.container_id,
      message: `黑盒入库成功: LPN=${request.lpnCode}, SKU=${request.skuId}, Qty=${request.qty}`,
    };
  }

  /**
   * 批量黑盒入库（同一箱内多 SKU，或多箱）
   */
  async receiveBatch(requests: BlackboxReceiveRequest[]): Promise<BlackboxReceiveResult[]> {
    const results: BlackboxReceiveResult[] = [];

    for (const req of requests) {
      const result = await this.receive(req);
      results.push(result);
    }

    return results;
  }

  /**
   * 校验 LPN 是否存在且可入库
   */
  async validateLpn(lpnCode: string, tenantId: string): Promise<{
    valid: boolean;
    containerId?: string;
    currentLocationId?: string;
    isSealed?: boolean;
    message?: string;
  }> {
    const { data, error } = await this.supabase
      .from('containers')
      .select('id, current_location_id, is_sealed, status')
      .eq('lpn_code', lpnCode)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return { valid: false, message: `LPN 不存在: ${lpnCode}` };
    }

    if (data.status === 'EMPTY' || data.status === 'DISCARDED') {
      return { valid: false, message: `LPN 状态不可用: ${data.status}` };
    }

    return {
      valid: true,
      containerId: data.id,
      currentLocationId: data.current_location_id,
      isSealed: data.is_sealed,
    };
  }

  private async getContainerId(lpnCode: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('containers')
      .select('id')
      .eq('lpn_code', lpnCode)
      .single();
    return data?.id || null;
  }
}

export default BlackboxReceivingService;