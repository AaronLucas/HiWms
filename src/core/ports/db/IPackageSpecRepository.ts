/**
 * 包装规格仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type PackageSpecRow = Tables<'package_specs'>;
export type PackageSpecInsert = TablesInsert<'package_specs'>;
export type PackageSpecUpdate = TablesUpdate<'package_specs'>;

export interface IPackageSpecRepository extends IRepository<PackageSpecRow, PackageSpecInsert, PackageSpecUpdate> {
  /**
   * 按 SKU 查找适用包装规格
   */
  findBySku(skuId: string, tenantId: string): Promise<PackageSpecRow[]>;

  /**
   * 查找默认包装规格
   */
  findDefault(tenantId: string, boxType?: string): Promise<PackageSpecRow | null>;

  /**
   * 按租户查找包装规格（分页、类型/状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; boxType?: string; isActive?: boolean }
  ): Promise<PackageSpecRow[]>;

  /**
   * 查找可用包装规格（按数量/重量/体积匹配）
   */
  findSuitable(
    tenantId: string,
    qty: number,
    weight?: number,
    volume?: number
  ): Promise<PackageSpecRow[]>;

  /**
   * 设置/取消默认包装规格
   */
  setDefault(specId: string, tenantId: string, isDefault: boolean): Promise<PackageSpecRow>;
}