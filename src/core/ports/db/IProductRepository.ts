/**
 * 产品仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type ProductRow = Tables<'products'>;
export type ProductInsert = TablesInsert<'products'>;
export type ProductUpdate = TablesUpdate<'products'>;

export interface IProductRepository extends IRepository<ProductRow, ProductInsert, ProductUpdate> {
  /**
   * 按 SKU 查找产品
   */
  findBySku(sku: string): Promise<ProductRow | null>;

  /**
   * 按租户查找产品
   */
  findByTenant(tenantId: string): Promise<ProductRow[]>;

  /**
   * 搜索产品（按名称、SKU 模糊匹配）
   */
  search(query: string, tenantId: string): Promise<ProductRow[]>;

  /**
   * 检查 SKU 是否存在
   */
  skuExists(sku: string, tenantId?: string): Promise<boolean>;
}