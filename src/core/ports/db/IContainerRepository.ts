/**
 * 容器/LPN 仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type ContainerRow = Tables<'containers'>;
export type ContainerInsert = TablesInsert<'containers'>;
export type ContainerUpdate = TablesUpdate<'containers'>;

export interface IContainerRepository extends IRepository<ContainerRow, ContainerInsert, ContainerUpdate> {
  /**
   * 按编码查找容器
   */
  findByCode(code: string, tenantId: string): Promise<ContainerRow | null>;

  /**
   * 按父容器查找子容器
   */
  findByParent(parentContainerId: string): Promise<ContainerRow[]>;

  /**
   * 按租户查找容器（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; containerType?: string }
  ): Promise<ContainerRow[]>;

  /**
   * 查找可用容器（未密封、有剩余容量）
   */
  findAvailable(
    tenantId: string,
    options?: { minVolume?: number; minWeight?: number }
  ): Promise<ContainerRow[]>;

  /**
   * 更新容器密封状态
   */
  updateSealStatus(containerId: string, isSealed: boolean): Promise<ContainerRow>;

  /**
   * 更新容器容量信息
   */
  updateCapacity(
    containerId: string,
    capacity: { maxVolume?: number; maxWeight?: number; currentVolume?: number; currentWeight?: number }
  ): Promise<ContainerRow>;

  /**
   * 获取容器利用率统计
   */
  getUtilizationStats(tenantId: string): Promise<Array<{
    containerId: string;
    code: string;
    currentVolume: number;
    currentWeight: number;
    maxVolume: number;
    maxWeight: number;
    utilizationPct: number;
  }>>;
}