export class RoleManager {
    constructor(supabase) {
        this.supabase = supabase;
    }
    // 创建角色 (仅管理员可操作)
    async createRole(name, description) {
        const { data, error } = await this.supabase
            .from('roles')
            .insert([{ name, description, is_system: false }]);
        if (error)
            throw error;
        return data[0];
    }
    // 创建权限
    async createPermission(resource, action, description) {
        const { data, error } = await this.supabase
            .from('permissions')
            .insert([{ resource, action, description }]);
        if (error)
            throw error;
        return data[0];
    }
    // 为角色授权
    async assignRolePermission(roleId, permissionId, grantedBy) {
        const { data, error } = await this.supabase
            .from('role_permissions')
            .insert([{ role_id: roleId, permission_id: permissionId, granted_by: grantedBy }]);
        if (error)
            throw error;
        return data[0];
    }
    // 为用户分配角色
    async assignUserRole(userId, roleId, assignedBy) {
        const { data, error } = await this.supabase
            .from('user_roles')
            .insert([{ user_id: userId, role_id: roleId, assigned_by: assignedBy }]);
        if (error)
            throw error;
        return data[0];
    }
    // 检查用户是否有角色
    async hasRole(userId, roleName) {
        const { data, error } = await this.supabase
            .from('user_roles')
            .innerJoin('roles', 'user_roles.role_id', 'roles.role_id')
            .select('roles.*')
            .eq('user_roles.user_id', userId)
            .eq('roles.name', roleName);
        if (error)
            throw error;
        return data.length > 0;
    }
    // 检查用户是否有指定资源的权限
    async hasPermission(userId, resource, action, scope) {
        const { data, error } = await this.supabase
            .rpc('check_user_permission', {
            p_user_id: userId,
            p_resource: resource,
            p_action: action,
            p_scope: scope
        });
        if (error)
            throw error;
        return data[0].has_permission;
    }
    // 获取用户的完整权限集合
    async getUserPermissions(userId) {
        const { data, error } = await this.supabase
            .from('user_roles')
            .innerJoin('role_permissions', 'user_roles.role_id', 'role_permissions.role_id')
            .innerJoin('permissions', 'role_permissions.permission_id', 'permissions.permission_id')
            .select('permissions.*')
            .eq('user_roles.user_id', userId);
        if (error)
            throw error;
        return data;
    }
    // 撤销用户的角色
    async removeUserRole(userId, roleId) {
        const { error } = await this.supabase
            .from('user_roles')
            .delete()
            .eq('user_id', userId)
            .eq('role_id', roleId);
        if (error)
            throw error;
    }
    // 撤销角色权限
    async removeRolePermission(roleId, permissionId) {
        const { error } = await this.supabase
            .from('role_permissions')
            .delete()
            .eq('role_id', roleId)
            .eq('permission_id', permissionId);
        if (error)
            throw error;
    }
}
export default RoleManager;
