/**
 * 车辆仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type VehicleRow = Tables<'vehicles'>;
export type VehicleInsert = TablesInsert<'vehicles'>;
export type VehicleUpdate = TablesUpdate<'vehicles'>;

export interface IVehicleRepository extends IRepository<VehicleRow, VehicleInsert, VehicleUpdate> {
  /**
   * 按车牌查找车辆
   */
  findByPlate(plate: string, tenantId: string): Promise<VehicleRow | null>;

  /**
   * 按租户查找车辆（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; vehicleType?: string }
  ): Promise<VehicleRow[]>;

  /**
   * 查找可用车辆（空闲、在线）
   */
  findAvailable(tenantId: string, vehicleType?: string): Promise<VehicleRow[]>;

  /**
   * 更新车辆状态
   */
  updateStatus(vehicleId: string, status: string): Promise<VehicleRow>;

  /**
   * 更新车辆位置
   */
  updateLocation(vehicleId: string, latitude: number, longitude: number): Promise<VehicleRow>;

  /**
   * 获取车辆统计
   */
  getStats(tenantId: string): Promise<{
    total: number;
    available: number;
    inUse: number;
    maintenance: number;
    byType: Record<string, number>;
  }>;
}