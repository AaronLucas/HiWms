# API_SPEC.md

## API 接口定义

### 概述

本系统基于 Supabase PostgREST + Cloudflare Workers 代理实现，所有 HTTP 请求均需在 Query 中携带 `tenant_id` 以实现多租户隔离。所有敏感操作必须通过 JWT (Bearer Token) 进行身份验证，并在后端通过 `check_user_permission` RPC 进行 RBAC 授权。

### 基础约定

- **基础 URL**：`https://<your-project>.supabase.co/rest/v1`
- **认证方式**：
  - Header: `Authorization: Bearer <jwt_token>`
  - Header: `apikey: <anon_key>`
- **租户隔离**：所有资源查询必须加入过滤 `tenant_id=eq.<uuid>`
- **错误响应**：统一返回 JSON 格式
  ```json
  {
    "error": "错误码或描述",
    "details": "可选的详细信息"
  }
  ```

### 共享约定

- **多租户隔离**：所有请求均需通过 `tenant_id` 参数或 Header `x-tenant-id` 实现租户隔离。
- **错误响应统一**：所有错误均返回上述 JSON 格式。

### 端点列表

| 端点 | 方法 | 路径 | 描述 | 权限 |
|------`------|------|------|------|--------|
| 登录 | POST | `/auth/login` | 用户名密码登录 (JWT) | 不需要 |
| 注册 | POST | `/auth/register` | 用户注册 (可选) | 不需要 |
| 健康检查 | GET | `/health` | 系统状态检查 | 不需要 |

### 受保护端点

以下所有端点均需包含 `tenant_id` 参数或 Header `x-tenant-id`：

#### 1. 租户管理 (Tenant)

**仅 SUPER_ADMIN 可访问**

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/tenants` | 列出所有租户（分页） |
| GET | `/tenants/{id}` | 获取单个租户详情 |
| PATCH | `/tenants/{id}` | 更新租户信息 (名称、联系方式、计费策略) |
| DELETE | `/tenants/{id}` | 软删除租户 |

#### 2. 用户管理 (User)

** ADMIN 及以上可见**

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/users` | 列出当前租户用户 |
| GET | `/users/{id}` | 获取用户详情 |
| POST | `/users` | 创建新用户 (需管理员权限) |
| PATCH | `/users/{id}` | 更新用户信息 (角色、状态) |
| DELETE | `/users/{id}` | 停用用户（软删除） |
| POST | `/users/{id}/roles` | 为用户分配角色 |
| DELETE | `/users/{id}/roles/{role_id}` | 移除用户角色 |

#### 3. 角色与权限 (Role / Permission)

** ADMIN 及以上可见**

| 方法 | 路径 | 描述 |\n|------|------|------|
| GET | `/roles` | 列出所有角色 |
| GET | `/roles/{id}` | 获取角色详情及其权限 |
| POST | `/roles` | 创建自定义角色 |
| PATCH | `/roles/{id}` | 更新角色描述 |
| DELETE | `/roles/{id}` | 删除角色（需先解除用户关联） |
| GET | `/permissions` | 列出所有可用权限 |
| POST | `/role-permissions` | 授予角色权限 |
| DELETE | `/role-permissions` | 撤销角色权限 |

#### 4. 物料管理 (Product)

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/products` | 列出当前租户物料 (支持过滤、排序、分页) |
| GET | `/products/{id}` | 获取单个物料详情 |
| POST | `/products` | 创建新物料 |
| PATCH | `/products/{id}`` | 更新物料信息 |
| DELETE | `/products/{id}` | 软删除物料 |
| GET | `/products/{id}/constraints` | 获取物料约束 (危险品、温度等) |
| POST | `/product-constraints` | 创建/更新物料约束 |

#### 5. 库位管理 (Location)

| 方法 | 路径 | �בון |
|------|------|------|
| GET | `/locations` | 列出库位 (可按 zone_type、zone_abc_type 过滤) |
| GET | `/locations/{id}` | 库位详情 |
| POST | `/locations` | 创建库位 |
| PATCH | `/locations/{id}` | 更新库位属性 |
| DELETE | `/locations/{id}`
