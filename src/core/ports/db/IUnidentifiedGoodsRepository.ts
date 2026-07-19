/**
 * 未识别货物闭环仓储端口接口
 * 封装 fn_receive_unidentified_goods / fn_identify_unidentified_goods
 * 对应表：exceptions (UNIDENTIFIED_GOODS 域)，containers
 */
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type UnidentifiedGoodsRow = Tables<'exceptions'>; // 复用 exceptions 表，domain = 'UNIDENTIFIED_GOODS'
export type UnidentifiedGoodsInsert = TablesInsert<'exceptions'>;
export type UnidentifiedGoodsUpdate = TablesUpdate<'exceptions'>;

export type ContainerRow = Tables<'containers'>;
export type ContainerInsert = TablesInsert<'containers'>;
export type ContainerUpdate = TablesUpdate<'containers'>;

export interface IUnidentifiedGoodsRepository {
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
   * 恒返回 null——UNIDENTIFIED_GOODS 闭环（fn_receive_unidentified_goods /
   * fn_identify_unidentified_goods，已读 SQL 源码核实）从头到尾只操作
   * inventory 表（product_id 记为 NULL 暂存，回填时直接 UPDATE inventory），
   * 从不创建 containers 行，与 MISSING_LABEL 闭环（会生成 SYSTEM_GENERATED
   * 容器）是两条完全不同的路径。containers 表本身也没有 exception_id 列
   * （已用 psql \d containers 核实），"按异常查容器"这个问题在这张表上
   * 无解——不是可修复的列名笔误，是这个领域本就不存在容器。
   */
  findContainerByException(exceptionId: string, tenantId: string): Promise<ContainerRow | null>;

  /**
   * 创建容器记录（用于 SYSTEM_GENERATED LPN）
   */
  createContainer(container: ContainerInsert): Promise<ContainerRow>;

  /**
   * 按 LPN 查找容器
   * containers 表没有 tenant_id 列（已用 psql \d containers 核实，也没有 RLS 策略），
   * lpn_code 全局唯一（UNIQUE 约束），因此本方法不做租户过滤——不是遗漏，是这张表的
   * 真实设计如此（与 IMissingLabelRepository.findContainerByLpn 同一类修复）。
   */
  findContainerByLpn(lpnCode: string): Promise<ContainerRow | null>;

  /**
   * 查找系统生成的容器（同上，containers 无 tenant_id，不做租户过滤）
   */
  findSystemGeneratedContainers(): Promise<ContainerRow[]>;
}
