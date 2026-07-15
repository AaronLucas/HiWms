/**
 * 角色仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type RoleRow = Tables<'roles'>;
export type RoleInsert = TablesInsert<'roles'>;
export type RoleUpdate = TablesUpdate<'roles'>;

export type PermissionRow = Tables<'permissions'>;
export type PermissionInsert = TablesInsert<'permissions'>;
export type PermissionUpdate = TablesUpdate<'permissions'>;

export type RolePermissionRow = Tables<'role_permissions'>;
export type RolePermissionInsert = TablesInsert<'role_permissions'>;
export type RolePermissionUpdate = TablesUpdate<'role_permissions'>;

export type UserRoleRow = Tables<'user_roles'>;
export type UserRoleInsert = TablesInsert<'user_roles'>;
export type UserRoleUpdate = TablesUpdate<'user_roles'>;

export interface IRoleRepository extends IRepository<RoleRow, RoleInsert, RoleUpdate> {
  /**
   * 按名称查找角色
   */
  findByName(name: string): Promise<RoleRow | null>;

  /**
   * 按 ID 查找角色
   */
  findById(id: string): Promise<RoleRow | null>;

  /**
   * 创建角色
   */
  createRole(data: RoleInsert): Promise<RoleRow>;

  // Permissions
  findPermissionByResourceAction(resource: string, action: string): Promise<PermissionRow | null>;
  createPermission(data: PermissionInsert): Promise<PermissionRow>;

  // Role Permissions
  assignRolePermission(data: RolePermissionInsert): Promise<RolePermissionRow>;
  removeRolePermission(roleId: string, permissionId: string): Promise<void>;
  findPermissionsByRole(roleId: string): Promise<PermissionRow[]>;

  // User Roles
  assignUserRole(data: UserRoleInsert): Promise<UserRoleRow>;
  removeUserRole(userId: string, roleId: string): Promise<void>;
  hasUserRole(userId: string, roleName: string): Promise<boolean>;
  findUserPermissions(userId: string): Promise<PermissionRow[]>;
}