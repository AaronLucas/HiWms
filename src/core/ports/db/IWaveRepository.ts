/**
 * 波次仓储端口接口
 * 聚合根：Wave + WaveOrderMapping
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type WaveRow = Tables<'waves'>;
export type WaveInsert = TablesInsert<'waves'>;
export type WaveUpdate = TablesUpdate<'waves'>;

export type WaveOrderMappingRow = Tables<'wave_order_mapping'>;
export type WaveOrderMappingInsert = TablesInsert<'wave_order_mapping'>;
export type WaveOrderMappingUpdate = TablesUpdate<'wave_order_mapping'>;

export interface WaveWithOrders {
  wave: WaveRow;
  orders: WaveOrderMappingRow[];
}

export interface IWaveRepository extends IRepository<WaveRow, WaveInsert, WaveUpdate> {
  /**
   * 按波次编号查找
   */
  findByWaveNo(waveNo: string, tenantId: string): Promise<WaveRow | null>;

  /**
   * 按租户查找波次（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; strategyType?: string }
  ): Promise<WaveRow[]>;

  /**
   * 查找波次及其关联订单
   */
  findWithOrders(waveId: string): Promise<WaveWithOrders | null>;

  /**
   * 查找进行中的波次
   */
  findInProgress(tenantId: string): Promise<WaveRow[]>;

  /**
   * 查找待释放波次
   */
  findPendingRelease(tenantId: string): Promise<WaveRow[]>;

  /**
   * 更新波次状态
   */
  updateStatus(waveId: string, status: string): Promise<WaveRow>;

  /**
   * 关联订单到波次
   */
  addOrdersToWave(waveId: string, orderIds: string[]): Promise<WaveOrderMappingRow[]>;

  /**
   * 从波次移除订单
   */
  removeOrdersFromWave(waveId: string, orderIds: string[]): Promise<void>;

  /**
   * 获取波次进度统计
   */
  getProgress(waveId: string): Promise<{
    totalOrders: number;
    allocatedOrders: number;
    pickedOrders: number;
    packedOrders: number;
    shippedOrders: number;
  }>;

  /**
   * 按策略类型统计波次
   */
  getStrategyStats(tenantId: string): Promise<Array<{
    strategyType: string;
    waveCount: number;
    totalOrders: number;
  }>>;
}