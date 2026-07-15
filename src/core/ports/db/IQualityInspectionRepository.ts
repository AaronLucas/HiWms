/**
 * 质检仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type QualityInspectionRow = Tables<'quality_inspections'>;
export type QualityInspectionInsert = TablesInsert<'quality_inspections'>;
export type QualityInspectionUpdate = TablesUpdate<'quality_inspections'>;

export interface IQualityInspectionRepository extends IRepository<QualityInspectionRow, QualityInspectionInsert, QualityInspectionUpdate> {
  /**
   * 按单号查找
   */
  findByInspectionNo(inspectionNo: string, tenantId: string): Promise<QualityInspectionRow | null>;

  /**
   * 按租户查找（分页、状态/结果/工单过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; result?: string; orderId?: string; waveId?: string }
  ): Promise<QualityInspectionRow[]>;

  /**
   * 查找待质检记录
   */
  findPending(tenantId: string): Promise<QualityInspectionRow[]>;

  /**
   * 查找异常质检记录
   */
  findDiscrepancy(tenantId: string): Promise<QualityInspectionRow[]>;

  /**
   * 更新质检结果
   */
  updateResult(inspectionId: string, result: string, details?: any): Promise<QualityInspectionRow>;

  /**
   * 获取质检统计
   */
  getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    total: number;
    passed: number;
    failed: number;
    discrepancy: number;
    passRate: number;
    byInspector: Record<string, { total: number; passed: number; failed: number }>;
  }>;
}