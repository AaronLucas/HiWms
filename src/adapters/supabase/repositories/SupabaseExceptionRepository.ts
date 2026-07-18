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
      // p_source_id 是 UUID 类型参数，传空字符串会被 Postgres 当成非法 UUID 字面量报错
      // （invalid input syntax for type uuid），必须传 null，不能用 '' 兜底。生成的 RPC
      // 类型把它标成必填 string（因为 SQL 侧没有 DEFAULT），但运行时 NULL 是合法值，
      // 这里用类型断言绕过生成类型的这个已知局限，不是绕过真实的 not-null 约束。
      // 用 || 而不是 ??：显式传空字符串（''）也要归一成 null，否则同样会被当成
      // 非法 UUID 字面量报错——?? 只替换 null/undefined，接不住 ''。
      p_source_id: (params.relatedEntityId || null) as string,
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
      PENDING_REVIEW: 0,
      CONFLICT: 0,
      RESOLVED: 0,
      DISMISSED: 0,
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
    // fn_resolve_exception 对 INVENTORY_SHORTAGE 类型会把 p_resolution_details 原样转给
    // fn_confirm_inventory_recount，后者要读 details 里的 confirmed_available_qty 才会真正
    // 调整库存（见该函数定义）。之前这里硬编码只传 {resolution}，永远不含这个 key，导致
    // 库存不足类异常"确认解决"了，但库存数字从未被真正修正——这里开放一个透传口子，
    // 让调用方（比如 confirmInventoryRecount）能把这类领域专属数据带进去。
    resolutionDetails?: Record<string, unknown>;
  }): Promise<ExceptionRow> {
    const result = await this.rpcClient.raw('fn_resolve_exception', {
      p_exception_id: params.exceptionId,
      p_new_status: 'RESOLVED',
      p_resolution_action: params.actionTaken,
      p_resolution_details: { resolution: params.resolution, ...params.resolutionDetails } as any,
      // 修正：之前这里传的是 params.actionTaken（一个简短动作码），导致
      // exceptions.resolution_notes 永远存的是动作码而不是人工填写的解决说明——
      // 对 confirmInventoryRecount 这类固定 actionTaken 的调用方，resolution_notes
      // 会对每一条记录都存成完全相同的常量字符串，审计时毫无信息量。
      p_resolution_notes: params.resolution,
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
    // 走统一恢复入口 fn_resolve_exception，而不是直接调 fn_confirm_inventory_recount——
    // 直接调用会绕开权限校验、状态转移到 RESOLVED、exception_events 审计轨迹，这条异常
    // 会一直卡在 PENDING_REVIEW，且无法通过统一恢复流程追溯"谁在什么时候确认的"。
    // fn_resolve_exception 对 INVENTORY_SHORTAGE 类型内部会自动调用
    // fn_confirm_inventory_recount(v_exc.id, p_resolution_details)，这里只需要把
    // confirmed_available_qty 放进 resolutionDetails（之前这里用的 key 是 recount_qty，
    // 跟 fn_confirm_inventory_recount 实际读取的 confirmed_available_qty 对不上，库存
    // 从未被真正修正过，属于同一批需要修的问题）。
    //
    // fn_resolve_exception 只在 exception_type = 'INVENTORY_SHORTAGE' 时才会触发这个
    // 库存联动，对其他类型静默跳过（不报错）。这里提前查一次类型并显式拒绝，避免调用方
    // 对着一条非库存类异常调这个方法，得到"成功"却什么都没发生的静默 no-op。
    const { data: target, error: findError } = await this.supabase.getClient()
      .from('exceptions')
      .select('exception_type')
      .eq('id', params.exceptionId)
      .eq('tenant_id', params.tenantId)
      .single();
    if (findError) throw findError;
    if (target!.exception_type !== 'INVENTORY_SHORTAGE') {
      throw new Error(
        `confirmInventoryRecount 只适用于 INVENTORY_SHORTAGE 类型异常，这条异常的类型是 ${target!.exception_type}`
      );
    }

    return this.resolveException({
      exceptionId: params.exceptionId,
      tenantId: params.tenantId,
      resolvedBy: params.confirmedBy,
      resolution: params.notes ?? '库存复盘确认',
      actionTaken: 'INVENTORY_RECOUNT_CONFIRMED',
      resolutionDetails: { confirmed_available_qty: params.recountQty, notes: params.notes },
    });
  }

  async escalateException(
    id: string,
    tenantId: string,
    escalatedTo: string,
    reason: string
  ): Promise<ExceptionRow> {
    // exceptions.status 的 CHECK 约束里没有独立的 ESCALATED 值，"升级"在这个状态机里
    // 就是转移到 CONFLICT（见 unWMS_Offline_Sync_Exception_Domain_V1.md §4.2："处理过程中
    // 发现情况复杂需要升级"）。只允许从 PENDING_REVIEW/CONFLICT 升级，已经 RESOLVED/
    // DISMISSED 的异常不应该被再次改动。
    const { data: current, error: findError } = await this.supabase.getClient()
      .from('exceptions')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (findError) throw findError;
    if (current!.status === 'RESOLVED' || current!.status === 'DISMISSED') {
      throw new Error(`该异常当前状态为 ${current!.status}，已处理完结，不能再升级`);
    }

    // UPDATE 时把 status 的旧值也带进 WHERE，而不是先查后无条件写：如果查完到写之前，
    // 这条异常被并发的 resolveException 抢先改成了 RESOLVED/DISMISSED，这里的 UPDATE
    // 会因为 status 不再匹配而影响 0 行，用 PGRST116（.single() 在 0 行时的报错码）
    // 兜底识别出"刚才检查完，状态已经被别人改了"，避免无条件覆盖把一条已经处理完的
    // 异常（resolved_at/resolved_by 都已经写好）静默改回 CONFLICT。
    const { data, error } = await this.supabase.getClient()
      .from('exceptions')
      .update({
        status: 'CONFLICT' as ExceptionStatus,
        assigned_to: escalatedTo,
        updated_at: new Date().toISOString(),
      } as ExceptionUpdate)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', current!.status)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('该异常在升级过程中已被其他人处理，可能已被恢复，请刷新后重试');
      }
      throw error;
    }

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
    // exception_events 表实际列名是 note，不是 description（已用生成的 database.ts
    // 类型核实）；此前这里直接写 description 会被 PostgREST 拒绝（列不存在），导致
    // recordEvent 每次调用都必定报错，连带调用方 escalateException 也会失败。
    const { data, error } = await this.supabase.getClient()
      .from('exception_events')
      .insert({
        exception_id: params.exceptionId,
        tenant_id: params.tenantId,
        actor_user_id: params.actorUserId,
        event_type: params.eventType,
        note: params.description,
        metadata: params.metadata as any || null,
      } as ExceptionEventInsert)
      .select()
      .single();

    if (error) throw error;
    return data as ExceptionEventRow;
  }
}