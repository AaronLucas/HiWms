/**
 * VAS BOM 仓储端口接口
 * 聚合根：VasBom + VasBomItems
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type VasBomRow = Tables<'vas_boms'>;
export type VasBomInsert = TablesInsert<'vas_boms'>;
export type VasBomUpdate = TablesUpdate<'vas_boms'>;

export type VasBomItemRow = Tables<'vas_bom_items'>;
export type VasBomItemInsert = TablesInsert<'vas_bom_items'>;
export type VasBomItemUpdate = TablesUpdate<'vas_bom_items'>;

export interface VasBomWithItems {
  bom: VasBomRow;
  items: VasBomItemRow[];
}

export interface IVasBomRepository extends IRepository<VasBomRow, VasBomInsert, VasBomUpdate> {
  /**
   * 按编码查找 BOM
   */
  findByCode(code: string, tenantId: string): Promise<VasBomRow | null>;

  /**
   * 按租户查找 BOM（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; vasType?: string }
  ): Promise<VasBomRow[]>;

  /**
   * 查找 BOM 及其明细项
   */
  findWithItems(bomId: string): Promise<VasBomWithItems | null>;

  /**
   * 查找指定 SKU 适用的 BOM
   */
  findBySku(skuId: string, tenantId: string): Promise<VasBomRow[]>;

  /**
   * 创建 BOM 明细项
   */
  createBomItems(items: VasBomItemInsert[]): Promise<VasBomItemRow[]>;

  /**
   * 更新 BOM 明细项
   */
  updateBomItem(itemId: string, data: Partial<VasBomItemUpdate>): Promise<VasBomItemRow>;

  /**
   * 删除 BOM 明细项
   */
  deleteBomItem(itemId: string): Promise<void>;

  /**
   * 获取 BOM 使用统计
   */
  getUsageStats(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    bomId: string;
    bomCode: string;
    usageCount: number;
    totalQty: number;
  }>>;
}