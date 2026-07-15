/**
 * 用户仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type UserRow = Tables<'users'>;
export type UserInsert = TablesInsert<'users'>;
export type UserUpdate = TablesUpdate<'users'>;

export interface IUserRepository extends IRepository<UserRow, UserInsert, UserUpdate> {
  /**
   * 按用户名查找
   */
  findByUsername(username: string): Promise<UserRow | null>;

  /**
   * 按租户查找用户（分页、状态/角色过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; role?: string; isActive?: boolean }
  ): Promise<UserRow[]>;

  /**
   * 更新用户状态
   */
  updateStatus(userId: string, isActive: boolean): Promise<UserRow>;

  /**
   * 更新用户角色
   */
  updateRole(userId: string, role: string): Promise<UserRow>;

  /**
   * 重置密码
   */
  resetPassword(userId: string, newPasswordHash: string): Promise<void>;

  /**
   * 检查用户名是否存在
   */
  usernameExists(username: string): Promise<boolean>;

  /**
   * 获取用户统计
   */
  getStats(tenantId: string): Promise<{
    total: number;
    active: number;
    byRole: Record<string, number>;
  }>;
}