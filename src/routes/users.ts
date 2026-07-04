import { Router, Request, Response } from 'express';
import { RoleManager } from '../services/RoleManager';
import { SupabaseClient, createSupabaseClientFromEnv } from '../supabase/SupabaseClient';

const router = Router();
const supabase = createSupabaseClientFromEnv();
const roleManager = new RoleManager(supabase);

// 创建角色
router.post('/roles', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const role = await roleManager.createRole(name, description);
    res.status(201).json({ data: role });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 创建权限
router.post('/permissions', async (req: Request, res: Response) => {
  try {
    const { resource, action, description } = req.body;
    const permission = await roleManager.createPermission(resource, action, description);
    res.status(201).json({ data: permission });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 为角色授权
router.post('/roles/:roleId/permissions', async (req: Request, res: Response) => {
  try {
    const { roleId } = req.params;
    const { permissionId, grantedBy } = req.body;
    const rp = await roleManager.assignRolePermission(roleId, permissionId, grantedBy);
    res.status(201).json({ data: rp });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 为用户分配角色
router.post('/user-roles', async (req: Request, res: Response) => {
  try {
    const { userId, roleId, assignedBy } = req.body;
    const ur = await roleManager.assignUserRole(userId, roleId, assignedBy);
    res.status(201).json({ data: ur });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 检查用户是否有角色
router.get('/users/:userId/roles/:roleName', async (req: Request, res: Response) => {
  try {
    const { userId, roleName } = req.params;
    const hasRole = await roleManager.hasRole(userId, roleName);
    res.json({ hasRole });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 检查用户权限
router.get('/users/:userId/permissions/:resource/:action', async (req: Request, res: Response) => {
  try {
    const { userId, resource, action } = req.params;
    const scope = req.query.scope as string | undefined;
    const hasPerm = await roleManager.hasPermission(userId, resource, action, scope);
    res.json({ hasPermission: hasPerm });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 获取用户的完整权限集合
router.get('/users/:userId/permissions', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const permissions = await roleManager.getUserPermissions(userId);
    res.json({ data: permissions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 撤销用户的角色
router.delete('/user-roles', async (req: Request, res: Response) => {
  try {
    const { userId, roleId } = req.body;
    await roleManager.removeUserRole(userId, roleId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 撤销角色权限
router.delete('/role-permissions', async (req: Request, res: Response) => {
  try {
    const { roleId, permissionId } = req.body;
    await roleManager.removeRolePermission(roleId, permissionId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;