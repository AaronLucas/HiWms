/**
 * RBAC 数据模型定义
 * 对应 Supabase 表: roles, permissions, role_permissions, user_roles
 */
export interface Role {
    role_id: string;
    name: string;
    description?: string;
    is_system: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface Permission {
    permission_id: string;
    resource: string;
    action: string;
    description?: string;
    created_at: Date;
}
export interface RolePermission {
    role_id: string;
    permission_id: string;
    granted_at: Date;
    granted_by: string;
}
export interface UserRole {
    user_id: string;
    role_id: string;
    assigned_at: Date;
    assigned_by: string;
    expires_at?: Date;
}
/**
 * 权限检查结果
 */
export interface PermissionCheck {
    allowed: boolean;
    reason?: string;
    missingPermissions?: Permission[];
}
