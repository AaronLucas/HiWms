/**
 * 容器/LPN 仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type ContainerRow = Tables<'containers'>;
export type ContainerInsert = TablesInsert<'containers'>;
export type ContainerUpdate = TablesUpdate<'containers'>;

export interface IContainerRepository extends IRepository<ContainerRow, ContainerInsert, ContainerUpdate> {
  /**
   * 按 LPN 码查找容器
   */
  findByLpnCode(lpnCode: string, tenantId: string): Promise<ContainerRow | null>;

  /**
   * 按租户查找容器（分页）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; containerType?: string }
  ): Promise<ContainerRow[]>;

  /**
   * 查找指定库位的容器
   */
  findByLocation(locationId: string): Promise<ContainerRow[]>;

  /**
   * 查找父容器下的子容器
   */
  findChildren(parentContainerId: string): Promise<ContainerRow[]>;

  /**
   * 查找可用容器（未密封、有空间）
   */
  findAvailable(
    tenantId: string,
    options?: { containerType?: string; minVolume?: number; minWeight?: number }
  ): Promise<ContainerRow[]>;

  /**
   * 更新容器状态
   */
  updateStatus(containerId: string, status: string, isSealed?: boolean): Promise<ContainerRow>;

  /**
   * 移动容器到新库位
   */
  moveToLocation(containerId: string, newLocationId: string): Promise<ContainerRow>;

  /**
   * 密封/解密封容器
   */
  sealContainer(containerId: string, sealed: boolean): Promise<ContainerRow>;

  /**
   * 获取容器层级树
   */
  getContainerTree(rootContainerId: string): Promise<ContainerRow[]>;

  /**
   * 按 SKU 查找包含该 SKU 的容器
   */
  findBySku(skuId: string, tenantId: string): Promise<ContainerRow[]>;

  /**
   * 容器装箱统计
   */
  getPackingStats(tenantId: string): Promise<{
    totalContainers: number;
    sealedContainers: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  }>;
}