/**
 * 库区仓储端口接口
 * 对应表：zones
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type ZoneRow = Tables<'zones'>;
export type ZoneInsert = TablesInsert<'zones'>;
export type ZoneUpdate = TablesUpdate<'zones'>;

export interface IZoneRepository extends IRepository<ZoneRow, ZoneInsert, ZoneUpdate> {
  /**
   * 按租户 + 库区编码查找库区
   */
  findByCode(tenantId: string, code: string): Promise<ZoneRow | null>;

  /**
   * 按租户查找所有库区
   */
  findByTenant(tenantId: string): Promise<ZoneRow[]>;

  /**
   * 按租户查找启用中的库区
   */
  findActive(tenantId: string): Promise<ZoneRow[]>;
}
