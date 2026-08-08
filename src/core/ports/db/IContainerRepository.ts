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

  // ===== Sprint 6: 容器全量写操作 =====

  /**
   * 获取容器内容物（含嵌套）
   */
  getContents(containerId: string, includeNested?: boolean): Promise<Array<{
    productId: string;
    productSku: string;
    productName: string;
    quantity: number;
    batchNo?: string;
    serialNo?: string;
  }>>;

  /**
   * 移动容器（更改父容器/位置）
   */
  moveContainer(containerId: string, newParentId: string | null): Promise<ContainerRow>;

  /**
   * 获取容器层级树（递归子容器）
   */
  getHierarchy(containerId: string): Promise<{
    container: ContainerRow;
    children: Array<{
      container: ContainerRow;
      children: any[];
    }>;
  } | null>;

  /**
   * 按 LPN 查询容器
   */
  findByLpn(lpnCode: string, tenantId: string): Promise<ContainerRow | null>;
}