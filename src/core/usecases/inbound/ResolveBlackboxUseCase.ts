/**
 * 黑盒收货解析用例
 * 封装 fn_logic_resolve_blackbox_box RPC
 */
import { IBlackboxReceivingRpc } from '@core/ports/rpc/IBlackboxReceivingRpc';
import { IInventoryRepository } from '@core/ports/db/IInventoryRepository';
import { IInboundReceiptRepository } from '@core/ports/db/IInboundReceiptRepository';

export interface ResolveBlackboxInput {
  lpnCode: string;
  skuId: string;
  qty: number;
  batch?: string;
  tenantId: string;
}

export class ResolveBlackboxUseCase {
  constructor(
    private blackboxRpc: IBlackboxReceivingRpc,
    private inventoryRepo: IInventoryRepository,
    private inboundReceiptRepo: IInboundReceiptRepository
  ) {}

  async execute(input: ResolveBlackboxInput): Promise<{
    success: boolean;
    inventoryId: string;
    message: string;
  }> {
    // 调用 RPC：扫箱不扫货，开箱确认 SKU/数量，置 picking_priority=99
    await this.blackboxRpc.resolve({
      p_lpn_code: input.lpnCode,
      p_sku_id: input.skuId,
      p_qty: input.qty,
      p_batch: input.batch ?? null,
    });

    return {
      success: true,
      inventoryId: '', // RPC 不返回 ID，实际可能需要查询
      message: `黑盒箱 ${input.lpnCode} 解析完成，SKU: ${input.skuId}, 数量: ${input.qty}`,
    };
  }
}

/**
 * 库存调整用例
 * 封装 adjust_inventory RPC（入库/出库/盘点，乐观锁保护）
 */
import { IInventoryAdjustRpc } from '@core/ports/rpc/IInventoryAdjustRpc';

export interface AdjustInventoryInput {
  tenantId: string;
  sku: string;
  quantity: number; // 正数入库，负数出库
  reason: string;
}

export class AdjustInventoryUseCase {
  constructor(private inventoryAdjustRpc: IInventoryAdjustRpc) {}

  async execute(input: AdjustInventoryInput): Promise<{
    inventoryId: string;
    newQuantity: number;
  }> {
    const result = await this.inventoryAdjustRpc.adjust({
      p_tenant_id: input.tenantId,
      p_sku: input.sku,
      p_quantity: input.quantity,
      p_reason: input.reason,
    });

    return {
      inventoryId: result[0]?.id ?? '',
      newQuantity: result[0]?.quantity ?? 0,
    };
  }
}

/**
 * 库存同步用例
 * 封装 sync_inventory_from_source RPC（多租户同步）
 */
import { IInventorySyncRpc } from '@core/ports/rpc/IInventorySyncRpc';

export interface SyncInventoryInput {
  tenantId: string;
}

export class SyncInventoryUseCase {
  constructor(private inventorySyncRpc: IInventorySyncRpc) {}

  async execute(input: SyncInventoryInput): Promise<{
    syncedCount: number;
  }> {
    const result = await this.inventorySyncRpc.sync({ p_tenant_id: input.tenantId });
    return { syncedCount: result.synced_count };
  }
}
