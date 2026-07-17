/**
 * 漏码闭环仓储端口接口
 * 封装 fn_generate_internal_lpn / fn_confirm_label_applied
 * 对应表：exceptions (MISSING_LABEL 域)，containers
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type MissingLabelRow = Tables<'exceptions'>; // 复用 exceptions 表，domain = 'MISSING_LABEL'
export type MissingLabelInsert = TablesInsert<'exceptions'>;
export type MissingLabelUpdate = TablesUpdate<'exceptions'>;

export type ContainerRow = Tables<'containers'>;
export type ContainerInsert = TablesInsert<'containers'>;
export type ContainerUpdate = TablesUpdate<'containers'>;

export interface IMissingLabelRepository extends IRepository<MissingLabelRow, MissingLabelInsert, MissingLabelUpdate> {
  /**
   * 生成内部 LPN 码（用于 MISSING_LABEL 异常处理）
   * 封装 RPC fn_generate_internal_lpn(p_actor_user_id, p_exception_id)
   * @returns 生成的内部 LPN 码，格式: INT-{YYYYMMDD}-{8位随机十六进制}
   */
  generateInternalLpn(exceptionId: string, actorUserId: string): Promise<string>;

  /**
   * 确认标签已贴（MISSING_LABEL 闭环恢复）
   * 封装 RPC fn_confirm_label_applied(p_exception_id, p_resolver_user_id, p_scanned_lpn_code)
   * 校验扫描码与生成码一致，关联容器，关闭异常
   */
  confirmLabelApplied(exceptionId: string, resolverUserId: string, scannedLpnCode: string): Promise<boolean>;

  /**
   * 查找租户的 MISSING_LABEL 异常
   */
  findMissingLabelExceptions(tenantId: string, status?: string): Promise<MissingLabelRow[]>;

  /**
   * 创建容器记录（用于 SYSTEM_GENERATED LPN）
   */
  createContainer(container: ContainerInsert): Promise<ContainerRow>;

  /**
   * 按 LPN 查找容器
   */
  findContainerByLpn(lpnCode: string, tenantId: string): Promise<ContainerRow | null>;
}