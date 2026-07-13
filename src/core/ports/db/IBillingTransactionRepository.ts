/**
 * 计费交易仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type BillingTransactionRow = Tables<'billing_transactions'>;
export type BillingTransactionInsert = TablesInsert<'billing_transactions'>;
export type BillingTransactionUpdate = TablesUpdate<'billing_transactions'>;

export interface IBillingTransactionRepository extends IRepository<BillingTransactionRow, BillingTransactionInsert, BillingTransactionUpdate> {
  /**
   * 按租户查找交易（分页、类型/状态/日期过滤）
   */
  findByTenant(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      feeType?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      orderId?: string;
      invId?: string;
    }
  ): Promise<BillingTransactionRow[]>;

  /**
   * 按订单查找关联交易
   */
  findByOrder(orderId: string): Promise<BillingTransactionRow[]>;

  /**
   * 按库存记录查找关联交易
   */
  findByInventory(invId: string): Promise<BillingTransactionRow[]>;

  /**
   * 更新交易状态
   */
  updateStatus(transId: string, status: string): Promise<BillingTransactionRow>;

  /**
   * 获取计费统计
   */
  getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalAmount: number;
    totalCount: number;
    byFeeType: Record<string, { count: number; amount: number }>;
    byStatus: Record<string, number>;
    byCurrency: Record<string, number>;
  }>;

  /**
   * 生成对账报表
   */
  getReconciliationReport(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    transId: string;
    feeType: string;
    amount: number;
    currency: string;
    status: string;
    orderId: string | null;
    invId: string | null;
    createdAt: string;
  }>>;
}