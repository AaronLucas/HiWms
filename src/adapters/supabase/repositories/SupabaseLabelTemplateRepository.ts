/**
 * Supabase 面单模板仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ILabelTemplateRepository } from '@core/ports/db/ILabelTemplateRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type LabelTemplateRow = Tables<'label_templates'>;
type LabelTemplateInsert = TablesInsert<'label_templates'>;
type LabelTemplateUpdate = TablesUpdate<'label_templates'>;

export class SupabaseLabelTemplateRepository extends SupabaseBaseRepository<
  LabelTemplateRow,
  LabelTemplateInsert,
  LabelTemplateUpdate,
  string
> implements ILabelTemplateRepository {
  protected tableName = 'label_templates';
  protected idColumn = 'id';

  async findByCode(code: string, tenantId: string): Promise<LabelTemplateRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('template_code', code)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as LabelTemplateRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; labelType?: string; isDefault?: boolean; isActive?: boolean }
  ): Promise<LabelTemplateRow[]> {
    const { limit = 100, offset = 0, labelType, isDefault, isActive } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('template_name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (labelType) query = query.eq('format', labelType);
    if (isDefault !== undefined) query = query.eq('is_default', isDefault);
    if (isActive !== undefined) query = query.eq('is_active', isActive);

    const { data, error } = await query;
    if (error) throw error;
    return (data as LabelTemplateRow[]) || [];
  }

  async findDefault(tenantId: string, labelType: string): Promise<LabelTemplateRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('format', labelType)
      .eq('is_default', true)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as LabelTemplateRow;
  }

  async setDefault(templateId: string, tenantId: string): Promise<void> {
    // Get the label_type of the template being set as default
    const { data: template } = await this.getClient()
      .from(this.tableName)
      .select('format')
      .eq('id', templateId)
      .eq('tenant_id', tenantId)
      .single();

    if (!template) return;

    // Unset current default for this label_type
    await this.getClient()
      .from(this.tableName)
      .update({ is_default: false })
      .eq('tenant_id', tenantId)
      .eq('format', template.format)
      .eq('is_default', true);

    // Set new default
    await this.update(templateId, { is_default: true } as any);
  }

  async getStats(tenantId: string): Promise<{
    total: number;
    byType: Record<string, number>;
    defaultCount: number;
    activeCount: number;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('format, is_default, is_active')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const templates = data as { format: string; is_default: boolean; is_active: boolean }[];

    const byType: Record<string, number> = {};
    let total = 0, activeCount = 0, defaultCount = 0;

    for (const t of templates) {
      total++;
      if (t.is_active) activeCount++;
      if (t.is_default) defaultCount++;
      byType[t.format] = (byType[t.format] || 0) + 1;
    }

    return { total, byType, defaultCount, activeCount };
  }
}