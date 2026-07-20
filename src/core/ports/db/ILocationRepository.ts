/**
 * 库位仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type LocationRow = Tables<'locations'>;
export type LocationInsert = TablesInsert<'locations'>;
export type LocationUpdate = TablesUpdate<'locations'>;

export interface ILocationRepository extends IRepository<LocationRow, LocationInsert, LocationUpdate> {
  /**
   * 按编码查找库位
   */
  findByCode(code: string, tenantId: string): Promise<LocationRow | null>;

  /**
   * 按租户查找库位（分页）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; zoneType?: string; isActive?: boolean }
  ): Promise<LocationRow[]>;

  /**
   * 查找可用库位（未冻结、有容量）
   */
  findAvailable(
    tenantId: string,
    options?: { zoneType?: string; minVolume?: number; minWeight?: number }
  ): Promise<LocationRow[]>;

  /**
   * 查找需要补货的库位
   */
  findReplenishmentNeeded(tenantId: string): Promise<LocationRow[]>;

  /**
   * 按区域类型查找库位
   */
  findByZoneType(tenantId: string, zoneType: string): Promise<LocationRow[]>;

  /**
   * 按库区（zones.id）查找库位
   * 对应 migration 007 新增的 locations.zone_id 外键
   */
  findByZone(zoneId: string): Promise<LocationRow[]>;

  /**
   * 更新库位状态（冻结/解冻/激活/停用）
   */
  updateStatus(locationId: string, isActive: boolean, isFrozen?: boolean): Promise<LocationRow>;

  /**
   * 更新库位容量信息
   */
  updateCapacity(
    locationId: string,
    capacity: { maxVolume?: number; maxWeight?: number; pickingMaxQty?: number; pickingThresholdPct?: number }
  ): Promise<LocationRow>;

  /**
   * 获取库位利用率统计
   */
  getUtilizationStats(tenantId: string): Promise<Array<{
    locationId: string;
    code: string;
    currentVolume: number;
    currentWeight: number;
    maxVolume: number;
    maxWeight: number;
    utilizationPct: number;
  }>>;
}