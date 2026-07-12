/**
 * 管理角色用例
 * 替代 RoleManager Service，使用 Repository Port + AuthProvider Port
 */
import { IRoleRepository } from '@core/ports/db/IRoleRepository';
import { IAuthProvider } from '@core/ports/auth/IAuthProvider';

export interface CreateRoleInput {
  name: string;
  description: string;
  isSystem?: boolean;
}

export interface CreatePermissionInput {
  resource: string;
  action: string;
  description?: string;
}

export interface AssignRolePermissionInput {
  roleId: string;
  permissionId: string;
  grantedBy: string;
}

export interface AssignUserRoleInput {
  userId: string;
  roleId: string;
  assignedBy: string;
}

export interface CheckPermissionInput {
  userId: string;
  resource: string;
  action: string;
  scope?: string;
}

export interface GetUserPermissionsInput {
  userId: string;
}

export class ManageRoleUseCase {
  constructor(
    private roleRepo: IRoleRepository,
    private authProvider: IAuthProvider
  ) {}

  async createRole(input: CreateRoleInput): Promise<{ roleId: string }> {
    const role = await this.roleRepo.createRole({
      name: input.name,
      description: input.description,
      is_system: input.isSystem ?? false,
    } as any);

    return { roleId: role.id };
  }

  async createPermission(input: CreatePermissionInput): Promise<{ permissionId: string }> {
    const permission = await this.roleRepo.createPermission({
      resource: input.resource,
      action: input.action,
      description: input.description,
    } as any);

    return { permissionId: permission.id };
  }

  async assignRolePermission(input: AssignRolePermissionInput): Promise<void> {
    await this.roleRepo.assignRolePermission({
      role_id: input.roleId,
      permission_id: input.permissionId,
      granted_by: input.grantedBy,
    } as any);
  }

  async assignUserRole(input: AssignUserRoleInput): Promise<void> {
    await this.roleRepo.assignUserRole({
      user_id: input.userId,
      role_id: input.roleId,
      assigned_by: input.assignedBy,
    } as any);
  }

  async removeUserRole(userId: string, roleId: string): Promise<void> {
    await this.roleRepo.removeUserRole(userId, roleId);
  }

  async removeRolePermission(roleId: string, permissionId: string): Promise<void> {
    await this.roleRepo.removeRolePermission(roleId, permissionId);
  }

  async checkPermission(input: CheckPermissionInput): Promise<{ hasPermission: boolean }> {
    const hasPermission = await this.roleRepo.hasUserRole(input.userId, input.resource); // This needs proper implementation
    // Actually use RPC for proper permission check
    return { hasPermission };
  }

  async getUserPermissions(input: GetUserPermissionsInput): Promise<{ permissions: string[] }> {
    const permissions = await this.roleRepo.findUserPermissions(input.userId);
    return {
      permissions: permissions.map(p => `${p.resource}:${p.action}`),
    };
  }
}

export default ManageRoleUseCase;