/**
 * 验货规则仓储端口接口
 * 支持版本化规则，历史订单按当时规则复核
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type VerificationRuleRow = Tables<'verification_rules'>;
export type VerificationRuleInsert = TablesInsert<'verification_rules'>;
export type VerificationRuleUpdate = TablesUpdate<'verification_rules'>;

export interface IVerificationRuleRepository extends IRepository<VerificationRuleRow, VerificationRuleInsert, VerificationRuleUpdate> {
  /**
   * 查找当前生效的验货规则（按 SKU + 时间点）
   */
  findActiveBySku(skuId: string, at?: Date): Promise<VerificationRuleRow | null>;

  /**
   * 按租户查找规则（分页、状态/版本过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; isActive?: boolean; version?: number }
  ): Promise<VerificationRuleRow[]>;

  /**
   * 查找指定版本的规则
   */
  findByVersion(version: number): Promise<VerificationRuleRow | null>;

  /**
   * 查找某 SKU 的所有历史版本
   */
  findHistoryBySku(skuId: string): Promise<VerificationRuleRow[]>;

  /**
   * 创建新版本规则（自动设置版本号、生效时间）
   */
  createNewVersion(data: VerificationRuleInsert): Promise<VerificationRuleRow>;

  /**
   * 停用规则
   */
  deactivate(ruleId: string): Promise<VerificationRuleRow>;

  /**
   * 获取规则版本统计
   */
  getVersionStats(tenantId: string): Promise<{
    totalVersions: number;
    activeCount: number;
    latestVersion: number;
    bySku: Record<string, number>;
  }>;
}