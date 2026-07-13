/**
 * 计费规则仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type BillingRuleRow = Tables<'billing_rules'>;
export type BillingRuleInsert = TablesInsert<'billing_rules'>;
export type BillingRuleUpdate = TablesUpdate<'billing_rules'>;

export type BillingRuleTierRow = Tables<'billing_rule_tiers'>;
export type BillingRuleTierInsert = TablesInsert<'billing_rule_tiers'>;
export type BillingRuleTierUpdate = TablesUpdate<'billing_rule_tiers'>;

export interface BillingRuleWithTiers {
  rule: BillingRuleRow;
  tiers: BillingRuleTierRow[];
}

export interface IBillingRuleRepository extends IRepository<BillingRuleRow, BillingRuleInsert, BillingRuleUpdate> {
  /**
   * 按规则名称查找
   */
  findByName(name: string, tenantId: string): Promise<BillingRuleRow | null>;

  /**
   * 查找当前生效的默认计费规则
   */
  findActiveDefault(tenantId: string): Promise<BillingRuleRow | null>;

  /**
   * 按租户查找所有规则（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; isDefault?: boolean; isActive?: boolean }
  ): Promise<BillingRuleRow[]>;

  /**
   * 查找规则及其阶梯配置
   */
  findWithTiers(ruleId: string): Promise<BillingRuleWithTiers | null>;

  /**
   * 创建计费规则及其阶梯
   */
  createWithTiers(rule: BillingRuleInsert, tiers: BillingRuleTierInsert[]): Promise<BillingRuleWithTiers>;

  /**
   * 更新规则及阶梯
   */
  updateWithTiers(ruleId: string, rule: BillingRuleUpdate, tiers: BillingRuleTierInsert[]): Promise<BillingRuleWithTiers>;

  /**
   * 设置规则为默认/激活/停用
   */
  setDefault(ruleId: string, isDefault: boolean): Promise<BillingRuleRow>;

  /**
   * 获取指定日期生效的计费规则（用于计费计算）
   */
  findActiveAt(tenantId: string, at: Date): Promise<BillingRuleWithTiers | null>;
}