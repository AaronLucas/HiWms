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

export interface IPackingTaskItemRepository extends IRepository<
  PackingTaskItemRow,
  PackingTaskItemInsert,
  PackingTaskItemUpdate
> {
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
   * 按产品查找明细行（同码去重用）
   */
  findByProduct(packingTaskId: string, productId: string, tenantId: string): Promise<PackingTaskItemRow[]>;

  /**
   * 批量插入明细行（支持同箱/同码去重）
   * @param items 明细行列表
   * @param dedupe 是否启用去重（同一箱同一 SKU 合并数量）
   * @returns 插入/合并后的明细行
   */
  insertBatch(items: PackingTaskItemInsert[], dedupe?: boolean): Promise<PackingTaskItemRow[]>;

  /**
   * 更新明细行数量
   */
  updateQty(id: string, tenantId: string, qty: number): Promise<PackingTaskItemRow | null>;

  /**
   * 关联容器（封箱时调用）
   */
  assignContainer(ids: string[], containerId: string, tenantId: string): Promise<number>;

  /**
   * 获取打包任务的明细统计
   */
  getStatsByPackingTask(packingTaskId: string, tenantId: string): Promise<{
    totalItems: number;
    totalQty: number;
    byProduct: Array<{ productId: string; qty: number }>;
    byContainer: Array<{ containerId: string; itemCount: number }>;
  }>;

  /**
   * 删除打包任务的所有明细行
   */
  deleteByPackingTask(packingTaskId: string, tenantId: string): Promise<number>;
}