/**
 * ASN (先期发货通知) 仓储端口接口
 * 基于 inbound_receipts 表实现
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type AsnRow = Tables<'inbound_receipts'>;
export type AsnInsert = TablesInsert<'inbound_receipts'>;
export type AsnUpdate = TablesUpdate<'inbound_receipts'>;

export interface IAsnRepository extends IRepository<AsnRow, AsnInsert, AsnUpdate> {
  /**
   * 按 ASN 单号查找
   */
  findByAsnNo(asnNo: string, tenantId: string): Promise<AsnRow | null>;

  /**
   * 按租户查找 ASN（分页、状态/供应商过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; supplierName?: string }
  ): Promise<AsnRow[]>;

  /**
   * 查找待收货 ASN
   */
  findPendingReceipt(tenantId: string): Promise<AsnRow[]>;

  /**
   * 查找已完成 ASN
   */
  findCompleted(tenantId: string, options?: { limit?: number; offset?: number }): Promise<AsnRow[]>;

  /**
   * 更新 ASN 状态
   */
  updateStatus(asnId: string, status: string, receivedAt?: string): Promise<AsnRow>;

  /**
   * 关联波次
   */
  assignWave(asnId: string, waveId: string): Promise<AsnRow>;

  /**
   * 获取 ASN 供应商统计
   */
  getSupplierStats(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    supplierName: string;
    asnCount: number;
    totalQty: number;
  }>>;
}