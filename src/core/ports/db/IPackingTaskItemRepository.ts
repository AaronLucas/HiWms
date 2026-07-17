/**
 * 打包明细行仓储端口接口
 * packing_task_items CRUD、同箱/同码去重逻辑
 * 对应表：packing_task_items
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type PackingTaskItemRow = Tables<'packing_task_items'>;
export type PackingTaskItemInsert = TablesInsert<'packing_task_items'>;
export type PackingTaskItemUpdate = TablesUpdate<'packing_task_items'>;

export interface IPackingTaskItemRepository extends IRepository<PackingTaskItemRow, PackingTaskItemInsert, PackingTaskItemUpdate> {
  /**
   * 按打包任务查找明细行
   */
  findByPackingTask(packingTaskId: string, tenantId: string): Promise<PackingTaskItemRow[]>;

  /**
   * 按订单行查找明细行
   */
  findByOrderLine(orderLineId: string, tenantId: string): Promise<PackingTaskItemRow[]>;

  /**
   * 按容器查找明细行
   */
  findByContainer(containerId: string, tenantId: string): Promise<PackingTaskItemRow[]>;

  /**
   * 按产品查找明细行
   */
  findByProduct(productId: string, tenantId: string): Promise<PackingTaskItemRow[]>;

  /**
   * 批量插入明细行（同箱/同码去重）
   * 如果同一 packing_task_id + product_id 已存在，则更新数量
   */
  upsertBatch(items: PackingTaskItemInsert[]): Promise<PackingTaskItemRow[]>;

  /**
   * 更新明细行数量
   */
  updateQty(id: string, tenantId: string, qty: number): Promise<PackingTaskItemRow | null>;

  /**
   * 分配容器 ID
   */
  assignContainer(id: string, tenantId: string, containerId: string): Promise<PackingTaskItemRow | null>;

  /**
   * 获取打包任务的总数量
   */
  getTotalQtyByPackingTask(packingTaskId: string, tenantId: string): Promise<number>;

  /**
   * 删除打包任务的所有明细行
   */
  deleteByPackingTask(packingTaskId: string, tenantId: string): Promise<number>;
}