-- ====================================================================
-- RBAC 核心表结构与权限检查函数 (Supabase / PostgreSQL)
-- 兼容 PostgreSQL 13+
-- ====================================================================

-- 1. 角色表
CREATE TABLE IF NOT EXISTS roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,            -- 'ADMIN', 'OPERATOR', 'AUDITOR'
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,             -- 系统内置角色不可删除
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 权限表
CREATE TABLE IF NOT EXISTS permissions (
    permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource VARCHAR(100) NOT NULL,              -- 例如 'products', 'orders', 'inventory'
    action VARCHAR(20) NOT NULL,                 -- 'CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (resource, action)
);

-- 3. 角色-权限关联表
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(permission_id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    granted_by UUID,                             -- 授予者的 user_id
    PRIMARY KEY (role_id, permission_id)
);

-- 4. 用户-角色关联表
CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL,                       -- 关联 users.user_id
    role_id UUID REFERENCES roles(role_id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID,                            -- 分配者的 user_id
    expires_at TIMESTAMPTZ,                      -- 临时角色过期时间（可选）
    PRIMARY KEY (user_id, role_id)
);

-- 5. 为现有 users 表添加外键（如果 users 表已存在，建议手动添加外键约束）
-- ALTER TABLE users ADD CONSTRAINT fk_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
-- ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(user_id);

-- 6. 索引优化
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);

-- 7. 初始化系统内置角色
INSERT INTO roles (name, description, is_system) VALUES
    ('SUPER_ADMIN', '超级管理员，拥有所有租户的完全控制权', TRUE),
    ('ADMIN', '租户管理员，管理本租户所有资源', TRUE),
    ('OPERATOR', '操作员，仅能执行日常业务操作', TRUE),
    ('AUDITOR', '审计员，只读访问', TRUE)
ON CONFLICT (name) DO NOTHING;

-- 8. 初始化基础权限（可根据业务扩展）
INSERT INTO permissions (resource, action, description) VALUES
    ('products', 'CREATE', '创建物料'),
    ('products', 'READ', '查看物料'),
    ('products', 'UPDATE', '修改物料'),
    ('products', 'DELETE', '删除物料'),
    ('orders', 'CREATE', '创建订单'),
    ('orders', 'READ', '查看订单'),
    ('orders', 'UPDATE', '修改订单'),
    ('orders', 'DELETE', '删除订单'),
    ('inventory', 'CREATE', '入库操作'),
    ('inventory', 'READ', '查看库存'),
    ('inventory', 'UPDATE', '调整库存'),
    ('inventory', 'DELETE', '删除库存记录'),
    ('waves', 'CREATE', '创建波次'),
    ('waves', 'READ', '查看波次'),
    ('waves', 'UPDATE', '修改波次'),
    ('waves', 'DELETE', '删除波次'),
    ('tenants', 'READ', '查看租户信息'),
    ('tenants', 'UPDATE', '修改租户信息')
ON CONFLICT (resource, action) DO NOTHING;

-- 9. 为角色分配默认权限（可根据需求调整）
-- SUPER_ADMIN: 所有权限
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- ADMIN: 除删除租户外的所有权限
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'ADMIN' AND p.resource <> 'tenants'
ON CONFLICT DO NOTHING;

-- OPERATOR: 仅业务核心资源的读写
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'OPERATOR' AND p.resource IN ('products','orders','inventory','waves') AND p.action IN ('CREATE','READ','UPDATE')
ON CONFLICT DO NOTHING;

-- AUDITOR: 所有资源只读
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.role_id, p.permission_id, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'AUDITOR' AND p.action = 'READ'
ON CONFLICT DO NOTHING;

-- 10. 权限检查函数（供 Cloudflare Worker / API 网关调用）
-- 返回 JSON: [{ has_permission: boolean }]
CREATE OR REPLACE FUNCTION check_user_permission(
    p_user_id UUID,
    p_resource TEXT,
    p_action TEXT,
    p_scope UUID DEFAULT NULL   -- tenant_id，用于租户级隔离
) RETURNS SETOF JSONB LANGUAGE plpgsql AS $$
DECLARE
    v_has BOOLEAN;
BEGIN
    -- 1. 检查用户是否属于该租户（若提供了 p_scope）
    IF p_scope IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM users WHERE user_id = p_user_id AND tenant_id = p_scope
        ) THEN
            RETURN NEXT jsonb_build_object('has_permission', false);
            RETURN;
        END IF;
    END IF;

    -- 2. 查询用户角色对应的权限
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.permission_id
        WHERE ur.user_id = p_user_id
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
          AND p.resource = p_resource
          AND p.action = p_action
    ) INTO v_has;

    RETURN NEXT jsonb_build_object('has_permission', v_has);
    RETURN;
END;
$$;

-- 11. 为 check_user_permission 赋予 anon 角色执行权限（Supabase 默认 anon 角色可调用 RPC）
GRANT EXECUTE ON FUNCTION check_user_permission TO anon;

-- ====================================================================
-- 使用说明：
-- 1. 在 Supabase Dashboard -> SQL Editor 执行本脚本
-- 2. 在 Cloudflare Worker 中调用:
--    POST https://<project>.supabase.co/rest/v1/rpc/check_user_permission
--    Headers: apikey, Authorization: Bearer <anon_key>
--    Body: { "p_user_id": "...", "p_resource": "products", "p_action": "READ", "p_scope": "<tenant_id>" }
-- ====================================================================