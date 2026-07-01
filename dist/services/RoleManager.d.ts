export declare class RoleManager {
    private supabase;
    constructor(supabase: any);
    createRole(name: string, description: string): Promise<Role>;
    createPermission(resource: string, action: string, description?: string): Promise<Permission>;
    assignRolePermission(roleId: string, permissionId: string, grantedBy: string): Promise<RolePermission>;
    assignUserRole(userId: string, roleId: string, assignedBy: string): Promise<UserRole>;
    hasRole(userId: string, roleName: string): Promise<boolean>;
    hasPermission(userId: string, resource: string, action: string, scope?: string): Promise<boolean>;
    getUserPermissions(userId: string): Promise<Permission[]>;
    removeUserRole(userId: string, roleId: string): Promise<void>;
    removeRolePermission(roleId: string, permissionId: string): Promise<void>;
}
export default RoleManager;
