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
    options?: { limit?: number; offset?: number; labelType?: string; isDefault?: boolean }
  ): Promise<LabelTemplateRow[]> {
    const { limit = 100, offset = 0, labelType, isDefault } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('template_name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (labelType) query = query.eq('label_type', labelType);
    if (isDefault !== undefined) query = query.eq('is_default', isDefault);

    const { data, error } = await query;
    if (error) throw error;
    return (data as LabelTemplateRow[]) || [];
  }

  async findDefault(tenantId: string, labelType: string): Promise<LabelTemplateRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('label_type', labelType)
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
      .select('label_type')
      .eq('id', templateId)
      .eq('tenant_id', tenantId)
      .single();

    if (!template) return;

    // Unset current default for this label_type
    await this.getClient()
      .from(this.tableName)
      .update({ is_default: false })
      .eq('tenant_id', tenantId)
      .eq('label_type', template.label_type)
      .eq('is_default', true);

    // Set new default
    await this.update(templateId, { is_default: true } as LabelTemplateUpdate);
  }

  async getStats(tenantId: string): Promise<{
    total: number;
    byType: Record<string, number>;
    defaultCount: number;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('label_type, is_default')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const templates = data as { label_type: string; is_default: boolean }[];

    const byType: Record<string, number> = {};
    let defaultCount = 0;

    for (const t of templates) {
      byType[t.label_type] = (byType[t.label_type] || 0) + 1;
      if (t.is_default) defaultCount++;
    }

    return {
      total: templates.length,
      byType,
      defaultCount,
    };
  }
}