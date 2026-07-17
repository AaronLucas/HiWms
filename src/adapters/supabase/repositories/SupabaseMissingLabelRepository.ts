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
  MissingLabelRow,
  MissingLabelInsert,
  MissingLabelUpdate,
  string
> implements IMissingLabelRepository {
  protected tableName = 'containers'; // MISSING_LABEL 通过 containers 表的 lpn_source 字段标识
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
   * 查找系统生成的容器
   */
  async findSystemGeneratedContainers(tenantId: string): Promise<ContainerRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('lpn_source', 'SYSTEM_GENERATED')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }

  /**
   * 按 LPN 码查找容器
   */
  async findByLpnCode(lpnCode: string, tenantId: string): Promise<ContainerRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('lpn_code', lpnCode)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ContainerRow;
  }

  /**
   * 获取容器关联的库存记录
   */
  async getInventoryByContainer(containerId: string, tenantId: string): Promise<any[]> {
    const { data, error } = await this.getClient()
      .from('inventory')
      .select('*')
      .eq('container_id', containerId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return data || [];
  }
}
