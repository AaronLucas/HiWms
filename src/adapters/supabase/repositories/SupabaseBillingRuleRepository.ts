/**
 * Supabase 计费规则仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IBillingRuleRepository } from '@core/ports/db/IBillingRuleRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type BillingRuleRow = Tables<'billing_rules'>;
type BillingRuleInsert = TablesInsert<'billing_rules'>;
type BillingRuleUpdate = TablesUpdate<'billing_rules'>;

type BillingRuleTierRow = Tables<'billing_rule_tiers'>;
type BillingRuleTierInsert = TablesInsert<'billing_rule_tiers'>;
type BillingRuleTierUpdate = TablesUpdate<'billing_rule_tiers'>;

export class SupabaseBillingRuleRepository extends SupabaseBaseRepository<
  BillingRuleRow,
  BillingRuleInsert,
  BillingRuleUpdate,
  string
> implements IBillingRuleRepository {
  protected tableName = 'billing_rules';
  protected idColumn = 'id';

  async findByName(name: string, tenantId: string): Promise<BillingRuleRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('rule_name', name)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as BillingRuleRow;
  }

  async findActiveDefault(tenantId: string): Promise<BillingRuleRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as BillingRuleRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; isDefault?: boolean; isActive?: boolean }
  ): Promise<BillingRuleRow[]> {
    const { limit = 100, offset = 0, isDefault, isActive } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (isDefault !== undefined) query = query.eq('is_default', isDefault);
    if (isActive !== undefined) query = query.eq('is_active', isActive);

    const { data, error } = await query;
    if (error) throw error;
    return (data as BillingRuleRow[]) || [];
  }

  async findWithTiers(ruleId: string): Promise<{
    rule: BillingRuleRow;
    tiers: BillingRuleTierRow[];
  } | null> {
    const { data: rule, error: ruleError } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('id', ruleId)
      .single();

    if (ruleError) {
      if (ruleError.code === 'PGRST116') return null;
      throw ruleError;
    }

    const { data: tiers, error: tiersError } = await this.getClient()
      .from('billing_rule_tiers')
      .select('*')
      .eq('rule_id', ruleId)
      .order('tier_sequence', { ascending: true });

    if (tiersError) throw tiersError;

    return {
      rule: rule as BillingRuleRow,
      tiers: (tiers as BillingRuleTierRow[]) || [],
    };
  }

  async createWithTiers(rule: BillingRuleInsert, tiers: BillingRuleTierInsert[]): Promise<{
    rule: BillingRuleRow;
    tiers: BillingRuleTierRow[];
  }> {
    const { data: newRule, error: ruleError } = await this.getClient()
      .from(this.tableName)
      .insert(rule as any)
      .select()
      .single();

    if (ruleError) throw ruleError;

    const tiersWithRuleId = tiers.map(t => ({ ...t, rule_id: newRule.id }));
    const { data: newTiers, error: tiersError } = await this.getClient()
      .from('billing_rule_tiers')
      .insert(tiersWithRuleId as any)
      .select();

    if (tiersError) throw tiersError;

    return {
      rule: newRule as BillingRuleRow,
      tiers: (newTiers as BillingRuleTierRow[]) || [],
    };
  }

  async updateWithTiers(ruleId: string, rule: BillingRuleUpdate, tiers: BillingRuleTierInsert[]): Promise<{
    rule: BillingRuleRow;
    tiers: BillingRuleTierRow[];
  }> {
    const { data: updatedRule, error: ruleError } = await this.getClient()
      .from(this.tableName)
      .update(rule as any)
      .eq('id', ruleId)
      .select()
      .single();

    if (ruleError) throw ruleError;

    // Delete existing tiers
    await this.getClient()
      .from('billing_rule_tiers')
      .delete()
      .eq('rule_id', ruleId);

    // Insert new tiers
    const tiersWithRuleId = tiers.map(t => ({ ...t, rule_id: ruleId }));
    const { data: newTiers, error: tiersError } = await this.getClient()
      .from('billing_rule_tiers')
      .insert(tiersWithRuleId as any)
      .select();

    if (tiersError) throw tiersError;

    return {
      rule: updatedRule as BillingRuleRow,
      tiers: (newTiers as BillingRuleTierRow[]) || [],
    };
  }

  async setDefault(ruleId: string, isDefault: boolean): Promise<BillingRuleRow> {
    // If setting as default, unset other defaults for this tenant
    if (isDefault) {
      const { data: rule } = await this.getClient()
        .from(this.tableName)
        .select('tenant_id')
        .eq('id', ruleId)
        .single();

      if (rule) {
        await this.getClient()
          .from(this.tableName)
          .update({ is_default: false })
          .eq('tenant_id', rule.tenant_id)
          .eq('is_default', true);
      }
    }

    return this.update(ruleId, { is_default: isDefault } as BillingRuleUpdate);
  }

  async findActiveAt(tenantId: string, at: Date): Promise<{
    rule: BillingRuleRow;
    tiers: BillingRuleTierRow[];
  } | null> {
    const atISO = at.toISOString();
    const { data: rule, error: ruleError } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .lte('effective_from', atISO)
      .or(`effective_to.is.null,effective_to.gte.${atISO}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    if (ruleError) {
      if (ruleError.code === 'PGRST116') return null;
      throw ruleError;
    }

    const { data: tiers, error: tiersError } = await this.getClient()
      .from('billing_rule_tiers')
      .select('*')
      .eq('rule_id', rule.id)
      .order('tier_sequence', { ascending: true });

    if (tiersError) throw tiersError;

    return {
      rule: rule as BillingRuleRow,
      tiers: (tiers as BillingRuleTierRow[]) || [],
    };
  }
}