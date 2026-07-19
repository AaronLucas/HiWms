/**
 * Supabase 未识别货物闭环仓储实现
 * 封装 fn_receive_unidentified_goods / fn_identify_unidentified_goods
 * 对应表：containers, exceptions, exception_events
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import {
  IUnidentifiedGoodsRepository,
  UnidentifiedGoodsRow,
  UnidentifiedGoodsInsert,
  UnidentifiedGoodsUpdate,
  ContainerRow,
  ContainerInsert,
  ContainerUpdate,
} from '@core/ports/db/IUnidentifiedGoodsRepository';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';
import { WmsSupabaseClient } from '../SupabaseClient';

export class SupabaseUnidentifiedGoodsRepository extends SupabaseBaseRepository<
  ContainerRow,
  ContainerInsert,
  ContainerUpdate,
  string
> implements IUnidentifiedGoodsRepository {
  protected tableName = 'containers';
  protected idColumn = 'id';

  constructor(
    protected supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {
    super(supabase);
  }

  /**
   * 接收未识别货物（入库时不知道是什么商品）
   * 封装 RPC fn_receive_unidentified_goods(p_tenant_id, p_location_id, p_qty, p_note, p_actor_user_id)
   * 创建容器记录（lpn_source = 'SYSTEM_GENERATED'），登记 UNIDENTIFIED_GOODS 异常
   * @returns 创建的异常 ID
   */
  async receiveUnidentifiedGoods(params: {
    tenantId: string;
    locationId: string;
    qty: number;
    note?: string;
    actorUserId?: string;
  }): Promise<string> {
    const result = await this.rpcClient.raw('fn_receive_unidentified_goods', {
      p_tenant_id: params.tenantId,
      p_location_id: params.locationId,
      p_qty: params.qty,
      p_note: params.note || '',
      p_actor_user_id: params.actorUserId || undefined,
    });
    return result as string;
  }

  /**
   * 确认未识别货物身份（完成闭环）
   * 封装 RPC fn_identify_unidentified_goods(p_exception_id, p_confirmed_product_id, p_resolver_user_id)
   * 更新容器 product_id，关闭异常
   */
  async identifyUnidentifiedGoods(exceptionId: string, confirmedProductId: string, resolverUserId: string): Promise<boolean> {
    const result = await this.rpcClient.raw('fn_identify_unidentified_goods', {
      p_exception_id: exceptionId,
      p_confirmed_product_id: confirmedProductId,
      p_resolver_user_id: resolverUserId,
    });
    return result === true;
  }

  /**
   * 查找租户的 UNIDENTIFIED_GOODS 异常
   */
  async findUnidentifiedGoodsExceptions(tenantId: string, status?: string): Promise<UnidentifiedGoodsRow[]> {
    let query = this.supabase.getClient()
      .from('exceptions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('exception_type', 'UNIDENTIFIED_GOODS')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as UnidentifiedGoodsRow[]) || [];
  }

  /**
   * 获取未识别货物的容器信息
   * 恒返回 null——UNIDENTIFIED_GOODS 闭环从头到尾只操作 inventory 表，从不创建
   * containers 行（与 MISSING_LABEL 闭环不同），containers 表也没有 exception_id
   * 列，"按异常查容器"在这张表上无解，见 IUnidentifiedGoodsRepository 接口注释。
   * 原实现对不存在的 exception_id/tenant_id 两列做过滤，每次调用必定抛
   * PostgREST 列不存在错误。
   */
  async findContainerByException(_exceptionId: string, _tenantId: string): Promise<ContainerRow | null> {
    return null;
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
   * 按 LPN 查找容器
   * containers 表没有 tenant_id 列（已用 psql \d containers 核实，也没有 RLS 策略），
   * lpn_code 全局唯一（UNIQUE 约束）——原实现过滤一个不存在的列，每次调用必定抛错。
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