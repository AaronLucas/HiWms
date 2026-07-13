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
   * 按租户查找 BOM（分页、状态/类型过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; processType?: string }
  ): Promise<VasBomRow[]>;

  /**
   * 查找 BOM 及其明细项
   */
  findWithItems(bomId: string): Promise<VasBomWithItems | null>;

  /**
   * 查找指定产出产品的 BOM
   */
  findByOutputProduct(outputProductId: string, tenantId: string): Promise<VasBomRow[]>;

  /**
   * 创建 BOM 明细项
   */
  createBomItems(items: TablesInsert<'vas_bom_items'>[]): Promise<Tables<'vas_bom_items'>[]>;

  /**
   * 更新 BOM 明细项
   */
  updateBomItem(itemId: string, data: TablesUpdate<'vas_bom_items'>): Promise<Tables<'vas_bom_items'>>;

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