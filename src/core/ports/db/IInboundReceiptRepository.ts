/**
 * 入库单仓储端口接口
 * 聚合根：InboundReceipt + InspectionItems
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type InboundReceiptRow = Tables<'inbound_receipts'>;
export type InboundReceiptInsert = TablesInsert<'inbound_receipts'>;
export type InboundReceiptUpdate = TablesUpdate<'inbound_receipts'>;

export type InspectionItemRow = Tables<'inspection_items'>;
export type InspectionItemInsert = TablesInsert<'inspection_items'>;
export type InspectionItemUpdate = TablesUpdate<'inspection_items'>;

export interface InboundReceiptWithItems {
  receipt: InboundReceiptRow;
  items: InspectionItemRow[];
}

export interface IInboundReceiptRepository extends IRepository<InboundReceiptRow, InboundReceiptInsert, InboundReceiptUpdate> {
  /**
   * 按单号查找入库单
   */
  findByReceiptNo(receiptNo: string, tenantId: string): Promise<InboundReceiptRow | null>;

  /**
   * 按租户查找入库单（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; supplierName?: string }
  ): Promise<InboundReceiptRow[]>;

  /**
   * 查找入库单及其质检项
   */
  findWithItems(receiptId: string): Promise<InboundReceiptWithItems | null>;

  /**
   * 查找待收货入库单
   */
  findPendingReceipt(tenantId: string): Promise<InboundReceiptRow[]>;

  /**
   * 查找待质检入库单
   */
  findPendingInspection(tenantId: string): Promise<InboundReceiptRow[]>;

  /**
   * 查找已完成入库单
   */
  findCompleted(tenantId: string, options?: { limit?: number; offset?: number }): Promise<InboundReceiptRow[]>;

  /**
   * 更新入库单状态
   */
  updateStatus(receiptId: string, status: string, receivedAt?: string): Promise<InboundReceiptRow>;

  /**
   * 关联波次
   */
  assignWave(receiptId: string, waveId: string): Promise<InboundReceiptRow>;

  /**
   * 创建质检项
   */
  createInspectionItems(items: InspectionItemInsert[]): Promise<InspectionItemRow[]>;

  /**
   * 更新质检项结果
   */
  updateInspectionItem(itemId: string, data: Partial<InspectionItemUpdate>): Promise<InspectionItemRow>;

  /**
   * 获取入库单质检汇总
   */
  getInspectionSummary(receiptId: string): Promise<{
    totalItems: number;
    passedItems: number;
    failedItems: number;
    pendingItems: number;
  }>;

  /**
   * 按供应商统计入库量
   */
  getSupplierStats(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    supplierName: string;
    receiptCount: number;
    totalQty: number;
  }>>;
}