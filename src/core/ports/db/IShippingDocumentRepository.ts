/**
 * 发货单据/面单仓储端口接口
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
   * 按租户查找（分页、状态/承运商过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; carrier?: string }
  ): Promise<ShippingDocumentRow[]>;

  /**
   * 查找待打印面单
   */
  findPendingPrint(tenantId: string): Promise<ShippingDocumentRow[]>;

  /**
   * 查找待发货单据
   */
  findPendingShip(tenantId: string): Promise<ShippingDocumentRow[]>;

  /**
   * 更新状态
   */
  updateStatus(docId: string, status: string, extra?: { trackingNo?: string; shippedAt?: string }): Promise<ShippingDocumentRow>;

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