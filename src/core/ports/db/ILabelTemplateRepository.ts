/**
 * 面单模板仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type LabelTemplateRow = Tables<'label_templates'>;
export type LabelTemplateInsert = TablesInsert<'label_templates'>;
export type LabelTemplateUpdate = TablesUpdate<'label_templates'>;

export interface ILabelTemplateRepository extends IRepository<LabelTemplateRow, LabelTemplateInsert, LabelTemplateUpdate> {
  /**
   * 按编码查找
   */
  findByCode(code: string, tenantId: string): Promise<LabelTemplateRow | null>;

  /**
   * 按租户查找（分页、类型/默认过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; labelType?: string; isDefault?: boolean; isActive?: boolean }
  ): Promise<LabelTemplateRow[]>;

  /**
   * 查找默认模板
   */
  findDefault(tenantId: string, labelType: string): Promise<LabelTemplateRow | null>;

  /**
   * 设置默认模板
   */
  setDefault(templateId: string, tenantId: string): Promise<void>;

  /**
   * 获取模板统计
   */
  getStats(tenantId: string): Promise<{
    total: number;
    byType: Record<string, number>;
    defaultCount: number;
    activeCount: number;
  }>;
}