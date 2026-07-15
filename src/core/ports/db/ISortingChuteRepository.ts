/**
 * 滑道仓储端口接口
 * 独立于分拣任务，管理滑道配置与状态
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type SortingChuteRow = Tables<'sorting_chutes'>;
export type SortingChuteInsert = TablesInsert<'sorting_chutes'>;
export type SortingChuteUpdate = TablesUpdate<'sorting_chutes'>;

export interface ISortingChuteRepository extends IRepository<SortingChuteRow, SortingChuteInsert, SortingChuteUpdate> {
  /**
   * 按波次查找滑道
   */
  findByWave(waveId: string): Promise<SortingChuteRow[]>;

  /**
   * 按目标查找滑道（订单/库位/车辆等）
   */
  findByTarget(targetId: string, targetType: string): Promise<SortingChuteRow[]>;

  /**
   * 查找可用滑道（未满、状态 active）
   */
  findAvailable(
    tenantId: string,
    waveId?: string,
    options?: { targetType?: string; minCapacity?: number }
  ): Promise<SortingChuteRow[]>;

  /**
   * 更新滑道当前数量
   */
  updateCurrentQty(chuteId: string, currentQty: number): Promise<SortingChuteRow>;

  /**
   * 更新滑道状态
   */
  updateStatus(chuteId: string, status: string): Promise<SortingChuteRow>;

  /**
   * 批量创建滑道（波次初始化）
   */
  createBatch(chutes: SortingChuteInsert[]): Promise<SortingChuteRow[]>;

  /**
   * 获取滑道利用率统计
   */
  getUtilizationStats(tenantId: string, waveId?: string): Promise<Array<{
    chuteId: string;
    chuteCode: string;
    capacity: number;
    currentQty: number;
    utilizationPct: number;
    targetId: string | null;
    targetType: string;
  }>>;
}