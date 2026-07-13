/**
 * Supabase 验货规则仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IVerificationRuleRepository } from '@core/ports/db/IVerificationRuleRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type VerificationRuleRow = Tables<'verification_rules'>;
type VerificationRuleInsert = TablesInsert<'verification_rules'>;
type VerificationRuleUpdate = TablesUpdate<'verification_rules'>;

export class SupabaseVerificationRuleRepository extends SupabaseBaseRepository<
  VerificationRuleRow,
  VerificationRuleInsert,
  VerificationRuleUpdate,
  string
> implements IVerificationRuleRepository {
  protected tableName = 'verification_rules';
  protected idColumn = 'id';

  async findActiveBySku(skuId: string, at: Date = new Date()): Promise<VerificationRuleRow | null> {
    const atISO = at.toISOString();
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('sku_id', skuId)
      .eq('is_active', true)
      .lte('effective_from', atISO)
      .or(`effective_to.is.null,effective_to.gte.${atISO}`)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as VerificationRuleRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; isActive?: boolean; version?: number }
  ): Promise<VerificationRuleRow[]> {
    const { limit = 100, offset = 0, isActive, version } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('version', { ascending: false })
      .range(offset, offset + limit - 1);

    if (isActive !== undefined) query = query.eq('is_active', isActive);
    if (version !== undefined) query = query.eq('version', version);

    const { data, error } = await query;
    if (error) throw error;
    return (data as VerificationRuleRow[]) || [];
  }

  async findByVersion(version: number): Promise<VerificationRuleRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('version', version)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as VerificationRuleRow;
  }

  async findHistoryBySku(skuId: string): Promise<VerificationRuleRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('sku_id', skuId)
      .order('version', { ascending: false });

    if (error) throw error;
    return (data as VerificationRuleRow[]) || [];
  }

  async createNewVersion(data: VerificationRuleInsert): Promise<VerificationRuleRow> {
    // Get next version number for this SKU
    const { data: maxVersionData } = await this.getClient()
      .from(this.tableName)
      .select('version')
      .eq('sku_id', data.sku_id)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    const nextVersion = (maxVersionData?.version || 0) + 1;
    const insertData = { ...data, version: nextVersion } as VerificationRuleInsert;

    const { data: result, error } = await this.getClient()
      .from(this.tableName)
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return result as VerificationRuleRow;
  }

  async deactivate(ruleId: string): Promise<VerificationRuleRow> {
    return this.update(ruleId, { is_active: false } as VerificationRuleUpdate);
  }

  async getVersionStats(tenantId: string): Promise<{
    totalVersions: number;
    activeCount: number;
    latestVersion: number;
    bySku: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('sku_id, is_active, version')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const rules = data as { sku_id: string; is_active: boolean; version: number }[];

    const bySku: Record<string, number> = {};
    let totalVersions = 0, activeCount = 0, latestVersion = 0;

    for (const r of rules) {
      totalVersions++;
      if (r.is_active) activeCount++;
      latestVersion = Math.max(latestVersion, r.version);
      bySku[r.sku_id] = (bySku[r.sku_id] || 0) + 1;
    }

    return { totalVersions, activeCount, latestVersion, bySku };
  }
}