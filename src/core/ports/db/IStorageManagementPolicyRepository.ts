/**
 * 存储管理策略仓储端口接口
 * 对应表：storage_management_policies
 * 封装 fn_get_storage_policy / fn_check_storage_usage / fn_run_storage_maintenance
 *
 * 【重要】写方法（create/update）只能从 admin-api 调用，不能暴露给 device-api：
 * 数据库层 RLS 策略 platform_admin_manage_storage_policy 已经把写权限锁死在平台管理员
 * （fn_is_platform_admin），但 TS 层同样不应该把这些写方法接到设备端应用的任何路由上——
 * 存储/成本预算是平台运营决策，不是租户自己的业务配置项（见
 * supabase/migrations/008_storage_management.sql §2 顶部注释）。
 */
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type StorageManagementPolicyRow = Tables<'storage_management_policies'>;
export type StorageManagementPolicyInsert = TablesInsert<'storage_management_policies'>;
export type StorageManagementPolicyUpdate = TablesUpdate<'storage_management_policies'>;

export interface StorageUsageStatus {
  currentSizeBytes: number;
  usedPct: number;
  status: string;
}

export interface IStorageManagementPolicyRepository {
  /**
   * 获取生效策略：租户专属覆盖优先，否则回退平台默认
   * 封装 RPC fn_get_storage_policy(p_tenant_id)
   */
  getEffectivePolicy(tenantId?: string): Promise<StorageManagementPolicyRow | null>;

  /**
   * 检查当前数据库存储用量，按阈值分级登记异常
   * 封装 RPC fn_check_storage_usage()
   */
  checkStorageUsage(): Promise<StorageUsageStatus>;

  /**
   * 一站式维护入口：用量检查 + 工单日志聚合归档 + 库存流水聚合归档
   * 封装 RPC fn_run_storage_maintenance()
   */
  runMaintenance(): Promise<string>;

  /**
   * 创建存储策略（平台管理员专用写操作，仅限 admin-api 调用）
   */
  create(policy: StorageManagementPolicyInsert): Promise<StorageManagementPolicyRow>;

  /**
   * 更新存储策略（平台管理员专用写操作，仅限 admin-api 调用）
   */
  update(id: string, policy: StorageManagementPolicyUpdate): Promise<StorageManagementPolicyRow>;

  /**
   * 查找所有存储策略（平台默认 + 各租户专属覆盖）
   */
  findAll(): Promise<StorageManagementPolicyRow[]>;

  /**
   * 按租户查找专属策略；tenantId 为 null 时查平台默认策略
   */
  findByTenant(tenantId: string | null): Promise<StorageManagementPolicyRow | null>;
}
