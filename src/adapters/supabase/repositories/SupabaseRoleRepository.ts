/**
 * Supabase 角色仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IRoleRepository, RoleRow, RoleInsert, RoleUpdate, PermissionRow, PermissionInsert, PermissionUpdate, RolePermissionRow, RolePermissionInsert, RolePermissionUpdate, UserRoleRow, UserRoleInsert, UserRoleUpdate } from '@core/ports/db/IRoleRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export class SupabaseRoleRepository extends SupabaseBaseRepository<
  RoleRow,
  RoleInsert,
  RoleUpdate,
  string
> implements IRoleRepository {
  protected tableName = 'roles';
  protected idColumn = 'id';

  async findRoleByName(name: string): Promise<RoleRow | null> {
    return this.findById(name); // name is the id for roles
  }

  async findRoleById(id: string): Promise<RoleRow | null> {
    return this.findById(id);
  }

  async createRole(data: RoleInsert): Promise<RoleRow> {
    return this.create(data);
  }

  // Permissions
  async findPermissionByResourceAction(resource: string, action: string): Promise<PermissionRow | null> {
    const { data, error } = await this.getClient()
      .from('permissions')
      .select('*')
      .eq('resource', resource)
      .eq('action', action)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as PermissionRow;
  }

  async createPermission(data: PermissionInsert): Promise<PermissionRow> {
    const { data: result, error } = await this.getClient()
      .from('permissions')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return result as PermissionRow;
  }

  // Role Permissions
  async assignRolePermission(data: RolePermissionInsert): Promise<RolePermissionRow> {
    const { data: result, error } = await this.getClient()
      .from('role_permissions')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return result as RolePermissionRow;
  }

  async removeRolePermission(roleId: string, permissionId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)
      .eq('permission_id', permissionId);

    if (error) throw error;
  }

  async findPermissionsByRole(roleId: string): Promise<PermissionRow[]> {
    const { data, error } = await this.getClient()
      .from('role_permissions')
      .select('permissions(*)')
      .eq('role_id', roleId);

    if (error) throw error;
    return (data as Array<{ permissions: PermissionRow }> || []).map(d => d.permissions);
  }

  // User Roles
  async assignUserRole(data: UserRoleInsert): Promise<UserRoleRow> {
    const { data: result, error } = await this.getClient()
      .from('user_roles')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return result as UserRoleRow;
  }

  async removeUserRole(userId: string, roleId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId);

    if (error) throw error;
  }

  async hasUserRole(userId: string, roleName: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('user_roles')
      .select('role_id')
      .eq('user_id', userId)
      .eq('role_id', roleName)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false;
      throw error;
    }
    return !!data;
  }

  async findUserPermissions(userId: string): Promise<PermissionRow[]> {
    const { data, error } = await this.getClient()
      .from('user_roles')
      .select(`
        role_id,
        roles!inner(
          role_permissions!inner(
            permission_id,
            permissions(*)
          )
        )
      `)
      .eq('user_id', userId);

    if (error) throw error;

    const permissions: PermissionRow[] = [];
    for (const ur of data as any[]) {
      for (const rp of ur.roles?.role_permissions || []) {
        if (rp.permissions) permissions.push(rp.permissions);
      }
    }
    return permissions;
  }
}