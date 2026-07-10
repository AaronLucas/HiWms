/**
 * 订单仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database';

export type OrderRow = Tables<'orders'>;
export type OrderInsert = TablesInsert<'orders'>;
export type OrderUpdate = TablesUpdate<'orders'>;

export interface IOrderRepository extends IRepository<OrderRow, OrderInsert, OrderUpdate> {
  /**
   * 按外部订单号查找
   */
  findByExternalId(externalOrderId: string): Promise<OrderRow | null>;

  /**
   * 按状态查找订单
   */
  findByStatus(status: string, tenantId: string): Promise<OrderRow[]>;

  /**
   * 查找租户下的所有订单
   */
  findByTenant(tenantId: string, options?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<OrderRow[]>;

  /**
   * 获取订单及其明细
   */
  findWithLines(orderId: string): Promise<{
    order: OrderRow;
    lines: Tables<'order_lines'>[];
  } | null>;

  /**
   * 更新订单状态
   */
  updateStatus(orderId: string, status: string): Promise<OrderRow>;

  /**
   * 查找待分配订单
   */
  findPendingAllocation(tenantId: string): Promise<OrderRow[]>;
}