/**
 * 交叉转运作业仓储端口接口
 * 聚合根：CrossDockJob
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type CrossDockJobRow = Tables<'cross_dock_jobs'>;
export type CrossDockJobInsert = TablesInsert<'cross_dock_jobs'>;
export type CrossDockJobUpdate = TablesUpdate<'cross_dock_jobs'>;

export interface ICrossDockJobRepository extends IRepository<CrossDockJobRow, CrossDockJobInsert, CrossDockJobUpdate> {
  /**
   * 按租户查找交叉转运作业（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string }
  ): Promise<CrossDockJobRow[]>;

  /**
   * 查找待匹配作业
   */
  findPendingMatch(tenantId: string): Promise<CrossDockJobRow[]>;

  /**
   * 查找待暂存作业
   */
  findPendingStaging(tenantId: string): Promise<CrossDockJobRow[]>;

  /**
   * 查找超时作业（用于定时扫描降级）
   */
  findTimeoutJobs(tenantId: string, before: string): Promise<CrossDockJobRow[]>;

  /**
   * 按入库单查找关联的交叉转运作业
   */
  findByInboundReceipt(inboundReceiptId: string): Promise<CrossDockJobRow[]>;

  /**
   * 按出库单查找关联的交叉转运作业
   */
  findByOutboundOrder(outboundOrderId: string): Promise<CrossDockJobRow[]>;

  /**
   * 按 SKU 查找作业
   */
  findBySku(skuId: string, tenantId: string): Promise<CrossDockJobRow[]>;

  /**
   * 更新作业状态
   */
  updateStatus(jobId: string, status: string, extra?: { matchedAt?: string; shippedAt?: string; fallbackReason?: string }): Promise<CrossDockJobRow>;

  /**
   * 匹配入库单与出库单
   */
  matchReceiptToOrder(jobId: string, inboundReceiptId: string, outboundOrderId: string, matchedQty: number): Promise<CrossDockJobRow>;

  /**
   * 分配暂存库位
   */
  assignStagingLocation(jobId: string, stagingLocId: string): Promise<CrossDockJobRow>;

  /**
   * 获取交叉转运效率统计
   */
  getEfficiencyStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalJobs: number;
    shippedJobs: number;
    fallbackJobs: number;
    timeoutJobs: number;
    avgLeadTimeMinutes: number;
    shipRatePct: number;
  }>;
}