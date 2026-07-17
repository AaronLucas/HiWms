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
      p_note: params.note || null,
      p_actor_user_id: params.actorUserId || null,
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
      .eq('type_code', 'UNIDENTIFIED_GOODS')
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
   */
  async findContainerByException(exceptionId: string, tenantId: string): Promise<ContainerRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('exception_id', exceptionId)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ContainerRow;
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
   */
  async findContainerByLpn(lpnCode: string, tenantId: string): Promise<ContainerRow | null> {
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
   * 查找系统生成的容器（用于未识别货物）
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

  // ========== IRepository 接口实现（代理到容器表）==========

  async findById(id: string): Promise<ContainerRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq(this.idColumn, id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ContainerRow;
  }

  async findAll(options: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    ascending?: boolean;
    filters?: Record<string, unknown>;
  } = {}): Promise<ContainerRow[]> {
    const { limit = 100, offset = 0, orderBy = 'created_at', ascending = false, filters = {} } = options;
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .order(orderBy, { ascending })
      .range(offset, offset + limit - 1);

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }

  async count(filters: Record<string, unknown> = {}): Promise<number> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*', { count: 'exact', head: true });

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    }

    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }

  async create(data: ContainerInsert): Promise<ContainerRow> {
    const { data: result, error } = await this.getClient()
      .from(this.tableName)
      .insert(data as any)
      .select()
      .single();

    if (error) throw error;
    return result as ContainerRow;
  }

  async createMany(data: ContainerInsert[]): Promise<ContainerRow[]> {
    const { data: result, error } = await this.getClient()
      .from(this.tableName)
      .insert(data as any)
      .select();

    if (error) throw error;
    return (result as ContainerRow[]) || [];
  }

  async update(id: string, data: ContainerUpdate): Promise<ContainerRow> {
    const { data: result, error } = await this.getClient()
      .from(this.tableName)
      .update(data as any)
      .eq(this.idColumn, id)
      .select()
      .single();

    if (error) throw error;
    return result as ContainerRow;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.getClient()
      .from(this.tableName)
      .delete()
      .eq(this.idColumn, id);

    if (error) throw error;
  }

  async exists(id: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select(this.idColumn)
      .eq(this.idColumn, id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false;
      throw error;
    }
    return !!data;
  }
}