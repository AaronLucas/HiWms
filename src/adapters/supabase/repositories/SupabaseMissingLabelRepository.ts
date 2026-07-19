/**
 * Supabase 漏码/缺码闭环仓储实现
 * 封装 fn_generate_internal_lpn / fn_confirm_label_applied
 * 对应表：containers, exceptions, exception_events (通过异常领域)
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import {
  IMissingLabelRepository,
  MissingLabelRow,
  MissingLabelInsert,
  MissingLabelUpdate,
  ContainerRow,
  ContainerInsert,
  ContainerUpdate,
} from '@core/ports/db/IMissingLabelRepository';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';
import { WmsSupabaseClient } from '../SupabaseClient';

export class SupabaseMissingLabelRepository extends SupabaseBaseRepository<
  ContainerRow,
  ContainerInsert,
  ContainerUpdate,
  string
> implements IMissingLabelRepository {
  protected tableName = 'containers';
  protected idColumn = 'id';

  constructor(
    protected supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {
    super(supabase);
  }

  /**
   * 生成内部 LPN 码（用于 MISSING_LABEL 闭环）
   * 封装 RPC fn_generate_internal_lpn(p_exception_id, p_actor_user_id)
   * @returns 生成的 LPN 码
   */
  async generateInternalLpn(exceptionId: string, actorUserId: string): Promise<string> {
    const result = await this.rpcClient.raw('fn_generate_internal_lpn', {
      p_exception_id: exceptionId,
      p_actor_user_id: actorUserId,
    });
    return result as string;
  }

  /**
   * 确认标签已贴（MISSING_LABEL 闭环完成）
   * 封装 RPC fn_confirm_label_applied(p_exception_id, p_resolver_user_id, p_scanned_lpn_code)
   * @returns 确认是否成功
   */
  async confirmLabelApplied(exceptionId: string, resolverUserId: string, scannedLpnCode: string): Promise<boolean> {
    const result = await this.rpcClient.raw('fn_confirm_label_applied', {
      p_exception_id: exceptionId,
      p_resolver_user_id: resolverUserId,
      p_scanned_lpn_code: scannedLpnCode,
    });
    return result === true;
  }

  /**
   * 查找租户的 MISSING_LABEL 异常
   */
  async findMissingLabelExceptions(tenantId: string, status?: string): Promise<MissingLabelRow[]> {
    let query = this.supabase.getClient()
      .from('exceptions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('exception_type', 'MISSING_LABEL')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as MissingLabelRow[]) || [];
  }

  /**
   * 创建容器记录（用于 SYSTEM_GENERATED LPN）
   */
  async createContainer(container: ContainerInsert): Promise<ContainerRow> {
    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .insert(container as any)
      .select()
      .single();

    if (error) throw error;
    return data as ContainerRow;
  }

  /**
   * 按 LPN 码查找容器
   * containers 表没有 tenant_id 列（已用 psql \d containers 核实，也没有 RLS 策略），
   * lpn_code 全局唯一（UNIQUE 约束）——原实现过滤一个不存在的列，PostgREST 会报错，
   * 每次调用必定抛异常。
   */
  async findContainerByLpn(lpnCode: string): Promise<ContainerRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('lpn_code', lpnCode)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ContainerRow;
  }

  /**
   * 查找系统生成的容器（同上，containers 无 tenant_id，不做租户过滤）
   */
  async findSystemGeneratedContainers(): Promise<ContainerRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('lpn_source', 'SYSTEM_GENERATED')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }
}