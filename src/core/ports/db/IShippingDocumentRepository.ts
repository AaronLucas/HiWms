/**
 * 发货单据仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type ShippingDocumentRow = Tables<'shipping_documents'>;
export type ShippingDocumentInsert = TablesInsert<'shipping_documents'>;
export type ShippingDocumentUpdate = TablesUpdate<'shipping_documents'>;

export interface IShippingDocumentRepository extends IRepository<ShippingDocumentRow, ShippingDocumentInsert, ShippingDocumentUpdate> {
  /**
   * 按单号查找
   */
  findByDocNo(docNo: string, tenantId: string): Promise<ShippingDocumentRow | null>;

  /**
   * 按租户查找（分页、类型/状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; docType?: string; status?: string }
  ): Promise<ShippingDocumentRow[]>;

  /**
   * 按装车任务查找关联单据
   */
  findByLoadingTask(loadingTaskId: string): Promise<ShippingDocumentRow[]>;

  /**
   * 更新状态
   */
  updateStatus(docId: string, status: string, issuedAt?: string): Promise<ShippingDocumentRow>;

  /**
   * 获取发货统计
   */
  getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalDocs: number;
    shipped: number;
    pending: number;
    byCarrier: Record<string, number>;
  }>;
}