/**
 * 未识别货物闭环仓储端口接口
 * 封装 fn_receive_unidentified_goods / fn_identify_unidentified_goods
 * 对应表：exceptions (UNIDENTIFIED_GOODS 域)，containers
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type UnidentifiedGoodsRow = Tables<'exceptions'>; // 复用 exceptions 表，domain = 'UNIDENTIFIED_GOODS'
export type UnidentifiedGoodsInsert = TablesInsert<'exceptions'>;
export type UnidentifiedGoodsUpdate = TablesUpdate<'exceptions'>;

export type ContainerRow = Tables<'containers'>;
export type ContainerInsert = TablesInsert<'containers'>;
export type ContainerUpdate = TablesUpdate<'containers'>;

export interface IUnidentifiedGoodsRepository extends IRepository<UnidentifiedGoodsRow, UnidentifiedGoodsInsert, UnidentifiedGoodsUpdate> {
  /**
   * 接收未识别货物（入库时不知道是什么商品）
   * 封装 RPC fn_receive_unidentified_goods(p_tenant_id, p_location_id, p_qty, p_note, p_actor_user_id)
   * 创建容器记录（lpn_source = 'SYSTEM_GENERATED'），登记 UNIDENTIFIED_GOODS 异常
   * @returns 创建的异常 ID
   */
  receiveUnidentifiedGoods(params: {
    tenantId: string;
    locationId: string;
    qty: number;
    note?: string;
    actorUserId?: string;
  }): Promise<string>;

  /**
   * 确认未识别货物身份（完成闭环）
   * 封装 RPC fn_identify_unidentified_goods(p_exception_id, p_confirmed_product_id, p_resolver_user_id)
   * 更新容器 product_id，关闭异常
   */
  identifyUnidentifiedGoods(exceptionId: string, confirmedProductId: string, resolverUserId: string): Promise<boolean>;

  /**
   * 查找租户的 UNIDENTIFIED_GOODS 异常
   */
  findUnidentifiedGoodsExceptions(tenantId: string, status?: string): Promise<UnidentifiedGoodsRow[]>;

  /**
   * 获取未识别货物的容器信息
   */
  findContainerByException(exceptionId: string, tenantId: string): Promise<ContainerRow | null>;
}
