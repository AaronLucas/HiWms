/**
 * RBAC 数据模型定义
 * 对应 Supabase 表: roles, permissions, role_permissions, user_roles
 */

export interface Role {
  role_id: string;
  name: string; // e.g., 'ADMIN', 'OPERATOR', 'AUDITOR'
  description?: string;
  is_system: boolean; // 系统内置角色不可删除
  created_at: Date;
  updated_at: Date;
}

export interface Permission {
  permission_id: string;
  resource: string; // e.g., 'products', 'orders', 'inventory'
  action: string;   // e.g., 'CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT'
  description?: string;
  created_at: Date;
}

export interface RolePermission {
  role_id: string;
  permission_id: string;
  granted_at: Date;
  granted_by: string; // user_id who granted
}

export interface UserRole {
  user_id: string;
  role_id: string;
  assigned_at: Date;
  assigned_by: string; // admin who assigned
  expires_at?: Date;   // optional expiration for temporary roles
}

/**
 * 权限检查结果
 */
export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
  missingPermissions?: Permission[];
}