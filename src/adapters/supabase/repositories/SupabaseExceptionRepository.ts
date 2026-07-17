/**
 * Supabase 统一异常领域仓储实现
 * 涵盖：exception_type_catalog / exceptions / exception_events
 * 封装：fn_raise_exception / fn_resolve_exception / fn_confirm_inventory_recount
 * 对应表：exceptions, exception_type_catalog, exception_events
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import {
  IExceptionRepository,
  ExceptionRow,
  ExceptionInsert,
  ExceptionUpdate,
  ExceptionEventRow,
  ExceptionEventInsert,
  ExceptionTypeCatalogRow,
  ExceptionStatus,
  ExceptionDomain,
  ExceptionSeverity,
} from '@core/ports/db/IExceptionRepository';
import { WmsSupabaseClient } from '../SupabaseClient';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';

export class SupabaseExceptionRepository implements IExceptionRepository {
  constructor(
    private supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {}

  // ========== 异常类型目录 ==========

  async getExceptionTypes(): Promise<ExceptionTypeCatalogRow[]> {
    const { data, error } = await this.supabase.getClient()
      .from('exception_type_catalog')
      .select('*')
      .eq('is_active', true)
      .order('domain', { ascending: true })
      .order('code', { ascending: true });

    if (error) throw error;
    return (data as ExceptionTypeCatalogRow[]) || [];
  }

  async getExceptionTypesByDomain(domain: ExceptionDomain): Promise<ExceptionTypeCatalogRow[]> {
    const { data, error } = await this.supabase.getClient()
      .from('exception_type_catalog')
      .select('*')
      .eq('domain', domain)
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (error) throw error;
    return (data as ExceptionTypeCatalogRow[]) || [];
  }

  async getExceptionTypeByCode(code: string): Promise<ExceptionTypeCatalogRow | null> {
    const { data, error } = await this.supabase.getClient()
      .from('exception_type_catalog')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ExceptionTypeCatalogRow;
  }

  // ========== 异常主表 ==========

  async raiseException(params: {
    tenantId: string;
    typeCode: string;
    severity: ExceptionSeverity;
    title: string;
    description?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    raisedBy?: string;
    assignedTo?: string;
    context?: Record<string, unknown>;
  }): Promise<ExceptionRow> {
    const result = await this.rpcClient.raw('fn_raise_exception', {
      p_tenant_id: params.tenantId,
      p_exception_type: params.typeCode,
      p_title: params.title,
      p_details: {
        description: params.description,
        ...params.context
      } as any,
      p_source_table: params.relatedEntityType ?? 'exceptions',
      p_source_id: params.relatedEntityId ?? '',
      p_raised_by: params.raisedBy ?? undefined,
    });

    // fn_raise_exception returns string (exception ID)
    const exceptionId = Array.isArray(result) && result.length > 0 ? result[0] : result as string | null;

    // Fetch the created exception
    const { data, error } = await this.supabase.getClient()
      .from('exceptions')
      .select('*')
      .eq('id', exceptionId ?? '')
      .eq('tenant_id', params.tenantId)
      .single();

    if (error) throw error;
    return data as ExceptionRow;
  }

  async findById(id: string, tenantId: string): Promise<(ExceptionRow & { events: ExceptionEventRow[] }) | null> {
    const { data: exception, error: excError } = await this.supabase.getClient()
      .from('exceptions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (excError || !exception) {
      if (excError?.code === 'PGRST116') return null;
      if (excError) throw excError;
      return null;
    }

    const { data: events, error: eventsError } = await this.supabase.getClient()
      .from('exception_events')
      .select('*')
      .eq('exception_id', id)
      .order('id', { ascending: true });

    if (eventsError) throw eventsError;

    return {
      ...exception,
      events: (events as ExceptionEventRow[]) || [],
    };
  }

  async findByTenant(params: {
    tenantId: string;
    status?: ExceptionStatus;
    domain?: ExceptionDomain;
    severity?: ExceptionSeverity;
    limit?: number;
    offset?: number;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: ExceptionRow[]; total: number }> {
    let query = this.supabase.getClient()
      .from('exceptions')
      .select('*', { count: 'exact' })
      .eq('tenant_id', params.tenantId);

    if (params.status) query = query.eq('status', params.status);
    if (params.domain) query = query.eq('domain', params.domain);
    if (params.severity) query = query.eq('severity', params.severity);
    if (params.fromDate) query = query.gte('created_at', params.fromDate);
    if (params.toDate) query = query.lte('created_at', params.toDate);

    const limit = params.limit || 50;
    const offset = params.offset || 0;
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return { data: (data as ExceptionRow[]) || [], total: count || 0 };
  }

  async countByStatus(tenantId: string): Promise<Record<ExceptionStatus, number>> {
    const { data, error } = await this.supabase.getClient()
      .from('exceptions')
      .select('status')
      .eq('tenant_id', tenantId);

    if (error) throw error;

    const counts: Record<ExceptionStatus, number> = {
      OPEN: 0,
      INVESTIGATING: 0,
      RESOLVED: 0,
      CLOSED: 0,
      ESCALATED: 0,
    };

    for (const row of (data as { status: ExceptionStatus }[]) || []) {
      if (counts[row.status] !== undefined) {
        counts[row.status]++;
      }
    }

    return counts;
  }

  async updateException(
    id: string,
    tenantId: string,
    updates: {
      status?: ExceptionStatus;
      assignedTo?: string;
      resolvedAt?: string;
      resolution?: string;
    }
  ): Promise<ExceptionRow | null> {
    const { data, error } = await this.supabase.getClient()
      .from('exceptions')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      } as ExceptionUpdate)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ExceptionRow;
  }

  async resolveException(params: {
    exceptionId: string;
    tenantId: string;
    resolvedBy: string;
    resolution: string;
    actionTaken: string;
  }): Promise<ExceptionRow> {
    const result = await this.rpcClient.raw('fn_resolve_exception', {
      p_exception_id: params.exceptionId,
      p_new_status: 'RESOLVED',
      p_resolution_action: params.actionTaken,
      p_resolution_details: { resolution: params.resolution } as any,
      p_resolution_notes: params.actionTaken,
      p_resolver_user_id: params.resolvedBy,
    });

    // fn_resolve_exception returns boolean
    if (!result || (Array.isArray(result) && result[0] !== true) || (typeof result === 'boolean' && !result)) {
      throw new Error('Failed to resolve exception: RPC returned false');
    }

    // Fetch the updated exception
    const { data, error } = await this.supabase.getClient()
      .from('exceptions')
      .select('*')
      .eq('id', params.exceptionId)
      .eq('tenant_id', params.tenantId)
      .single();

    if (error) throw error;
    return data as ExceptionRow;
  }

  async confirmInventoryRecount(params: {
    exceptionId: string;
    tenantId: string;
    confirmedBy: string;
    recountQty: number;
    notes?: string;
  }): Promise<ExceptionRow> {
    const result = await this.rpcClient.raw('fn_confirm_inventory_recount', {
      p_exception_id: params.exceptionId,
      p_resolution_details: { recount_qty: params.recountQty, notes: params.notes } as any,
    });

    // fn_confirm_inventory_recount returns undefined
    // Fetch the updated exception
    const { data, error } = await this.supabase.getClient()
      .from('exceptions')
      .select('*')
      .eq('id', params.exceptionId)
      .eq('tenant_id', params.tenantId)
      .single();

    if (error) throw error;
    return data as ExceptionRow;
  }

  async escalateException(
    id: string,
    tenantId: string,
    escalatedTo: string,
    reason: string
  ): Promise<ExceptionRow> {
    // 更新状态为 ESCALATED 并记录转派
    const { data, error } = await this.supabase.getClient()
      .from('exceptions')
      .update({
        status: 'ESCALATED' as ExceptionStatus,
        assigned_to: escalatedTo,
        updated_at: new Date().toISOString(),
      } as ExceptionUpdate)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw error;

    // 记录升级事件
    await this.recordEvent({
      exceptionId: id,
      tenantId,
      actorUserId: escalatedTo,
      eventType: 'ESCALATED',
      description: `Exception escalated to ${escalatedTo}: ${reason}`,
      metadata: { reason, escalatedTo },
    });

    return data as ExceptionRow;
  }

  async getExceptionEvents(exceptionId: string, tenantId: string): Promise<ExceptionEventRow[]> {
    // First verify the exception belongs to the tenant
    const { data: exception, error: excError } = await this.supabase.getClient()
      .from('exceptions')
      .select('id')
      .eq('id', exceptionId)
      .eq('tenant_id', tenantId)
      .single();

    if (excError || !exception) {
      if (excError?.code === 'PGRST116') return [];
      if (excError) throw excError;
      return [];
    }

    const { data, error } = await this.supabase.getClient()
      .from('exception_events')
      .select('*')
      .eq('exception_id', exceptionId)
      .order('id', { ascending: true });

    if (error) throw error;
    return (data as ExceptionEventRow[]) || [];
  }

  async recordEvent(params: {
    exceptionId: string;
    tenantId: string;
    actorUserId: string;
    eventType: 'CREATED' | 'ASSIGNED' | 'STATUS_CHANGED' | 'RESOLVED' | 'ESCALATED' | 'RECOUNT_CONFIRMED' | 'COMMENT_ADDED';
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<ExceptionEventRow> {
    const { data, error } = await this.supabase.getClient()
      .from('exception_events')
      .insert({
        exception_id: params.exceptionId,
        tenant_id: params.tenantId,
        actor_user_id: params.actorUserId,
        event_type: params.eventType,
        description: params.description,
        metadata: params.metadata as any || null,
      } as ExceptionEventInsert)
      .select()
      .single();

    if (error) throw error;
    return data as ExceptionEventRow;
  }
}