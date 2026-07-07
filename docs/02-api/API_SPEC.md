# API_SPEC.md

## API 设计
所有 API 均基于 RESTful 风格，采用 JSON 进行数据交互。请求均需携带 `tenant_id` 以实现多租户隔离。所有敏感操作须通过 JWT（Bearer Token）进行身份鉴权，并在后端通过 `check_user_permission` RPC 进行 RBAC 授权。

### 基础约定
- 基础 URL：`https://<your-project>.supabase.co/rest/v1`
- 认证方式：Header 中的 `Authorization: Bearer <jwt_token>` 和 `apikey: <anon_key>`
- 租户隔离：所有资源查询必须加入过滤 `tenant_id=eq.<uuid>`
- 错误响应：统一返回 JSON 格式 `{ "error": "...", "details": "..." }`
- 成功响应：返回资源数组或对象，附带标准 HTTP 状态码。

### 公共端点（无需鉴权）
| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/auth/login` | 用户名密码换取 JWT（由自定义 Edge Function 实现） |
| POST | `/auth/register` | 注册新用户（仅限邀请或开放注册时开放） |
| GET  | `/health` | 健康检查 |

### 受保护资源（需 JWT + tenant_id）
以下所有路径均需要在 Query 中添加 `tenant_id=xxxx` 或 Header `x-tenant-id`。

#### 1. 租户管理（Tenant）
> 仅 SUPER_ADMIN 可访问。
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/tenants` | 列出所有租户（分页） |
| GET | `/tenants/{id}` | 获取单个租户详情 |
| PATCH | `/tenants/{id}` | 更新租户信息（名称、联系方式、计费策略） |
| DELETE | `/tenants/{id}` | 软删除（设置 `is_active = false`） |

#### 2. 用户管理（User）
> 根据角色权限不同，可操作范围受限。
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/users` | 列出当前租户用户 |
| GET | `/users/{id}` | 获取用户详情 |
| POST | `/users` | 创建新用户（需要管理员权限） |
| PATCH | `/users/{id}` | 更新用户信息（角色、状态） |
| DELETE | `/users/{id}` | 停用用户（软删除） |
| POST | `/users/{id}/roles` | 为用户分配角色 |
| DELETE | `/users/{id}/roles/{role_id}` | 移除用户角色 |

#### 3. 角色与权限（Role / Permission）
> 仅 ADMIN 及以上可管理。
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/roles` | 列出所有角色 |
| GET | `/roles/{id}` | 获取角色详情及其权限 |
| POST | `/roles` | 创建自定义角色 |
| PATCH | `/roles/{id}` | 更新角色描述 |
| DELETE | `/roles/{id}` | 删除角色（仅当无用户关联时） |
| GET | `/permissions` | 列出所有可用权限 |
| POST | `/role-permissions` | 授予角色权限 |
| DELETE | `/role-permissions` | 撤销角色权限 |

#### 4. 物料管理（Product）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/products` | 列出当前租户物料（支持过滤、排序、分页） |
| GET | `/products/{id}` | 获取单个物料详情 |
| POST | `/products` | 创建新物料 |
| PATCH | `/products/{id}` | 更新物料信息 |
| DELETE | `/products/{id}` | 软删除物料 |
| GET | `/products/{id}/constraints` | 获取物料约束（危险品、温度等） |
| POST | `/product-constraints` | 创建/更新物料约束 |

#### 5. 库位管理（Location）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/locations` | 列出库位（可按 zone_type、zone_abc_type 过滤） |
| GET | `/locations/{id}` | 库位详情 |
| POST | `/locations` | 创建库位 |
| PATCH | `/locations/{id}` | 更新库位属性 |
| DELETE | `/locations/{id}` | 冻结/解冻库位（通过 `is_frozen` 字段） |
| GET | `/locations/{id}/capacity` | 获取库容量与当前占用率 |

#### 6. 容器管理（Container / LPN）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/containers` | 列出容器（支持按 `lpn_code`、状态过滤） |
| GET | `/containers/{id}` | 容器详情 |
| POST | `/containers` | 创建新容器 |
| PATCH | `/containers/{id}` | 更新容器信息（当前位置、封状态等） |
| DELETE | `/containers/{id}` | 标记为废弃（软删除） |
| POST | `/containers/{id}/seal` | 封箱 / 解封操作 |
| GET | `/containers/{id}/inventory` | 查看容器内库存明细 |

#### 7. 库存管理（Inventory）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/inventory` | 列出库存记录（支持按 sku_id、loc_id、container_id 过滤） |
| GET | `/inventory/{id}` | 库存明细 |
| POST | `/inventory` | 入库登记（自动生成版本号） |
| PATCH | `/inventory/{id}` | 更新库存数量（触发历史记录） |
| POST | `/inventory/reservations` | 创建库存预留（关联订单） |
| DELETE | `/inventory/reservations/{id}` | 取消预留 |
| GET | `/inventory/history/{inv_id}` | 查看库存变动历史 |

#### 8. 订单管理（Order）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/orders` | 列出订单（支持按状态、类型、创建时间过滤） |
| GET | `/orders/{id}` | 订单详情 |
| POST | `/orders` | 创建新订单 |
| PATCH | `/orders/{id}` | 更新订单状态（确认、取消、完成） |
| DELETE | `/orders/{id}` | 软删除订单 |
| POST | `/orders/{id}/allocate` | 触发库存分配（调用 RPC fn_logic_stock_allocation） |
| GET | `/orders/{id}/allocations` | 查看已分配库存明细 |

#### 9. 波次管理（Wave）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/waves` | 列出波次（按状态、策略类型过滤） |
| GET | `/waves/{id}` | 波次详情 |
| POST | `/waves` | 创建新波次 |
| PATCH | `/waves/{id}` | 更新波次状态（规划→拣货→分拣→关闭） |
| DELETE | `/waves/{id}` | 删除波次（仅未开始时可删） |
| POST | `/waves/{id}/orders` | 将订单加入波次 |
| DELETE | `/waves/{id}/orders/{order_id}` | 从波次移除订单 |

#### 10. 作业工单（Work Order）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/work_orders` | 列出工单（按类型、状态、操作人过滤） |
| GET | `/work_orders/{id}` | 工单详情 |
| POST | `/work_orders` | 创建新工单 |
| PATCH | `/work_orders/{id}` | 更新工单状态（派遣、进行中、完成、异常） |
| POST | `/work_orders/{id}/actions` | 记录操作日志（扫描、移动等） |
| GET | `/work_orders/{id}/logs` | 获取操作日志 |

#### 11. 条码映射（Barcode Mapping）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/barcode-mappings` | 列出条码映射（支持按 barcode、target_type 过滤） |
| POST | `/barcode-mappings` | 创建新映射（扫描条码 → 目标资源） |
| DELETE | `/barcode-mappings/{id}` | 删除映射 |

#### 12. 增值服务（VAS / Kitting）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/vas-boms` | 列出 VAS BOM 套件 |
| GET | `/vas-boms/{id}` | BOM 详情 |
| POST | `/vas-boms` | 创建新 BOM |
| PATCH | `/vas-boms/{id}` | 更新 BOM |
| DELETE | `/vas-boms/{id}` | 删除 BOM |
| GET | `/vas-bom-items/{bom_id}` | 查看 BOM 明细 |
| POST | `/vas-bom-items` | 添加 BOM 组件 |
| DELETE | `/vas-bom-items/{id}` | 删除 BOM 组件 |

#### 13. 财务计费（Billing Transaction）
> 仅 FINANCE 或 ADMIN 可查看。
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/billing-transactions` | 列出账单记录（按费用类型、时间范围过滤） |
| GET | `/billing-transactions/{id}` | 账单详情 |
| POST | `/billing-transactions` | 手动记录费用（通常由后台任务自动生成） |

#### 14. 库存锁定（Inventory Lock）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/inventory-locks` | 列出当前锁定记录 |
| POST | `/inventory-locks` | 创建锁定（防止超卖） |
| DELETE | `/inventory-locks/{id}` | 释放锁定 |

#### 15. 报表与分析（只读视图）
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/reports/replenishment-needs` | 获取需要补货的库位视图 |
| GET | `/reports/boss-cockpit` | 老板驾驶舱（人效、异常率等） |
| GET | `/reports/inventory-aging` | 库龄分析 |
| GET | `/reports/turnover-rate` | 周转率统计 |

## 响应示例

### 成功列表（分页）
```json
{
  "data": [
    { "id": "...", "name": "...", "created_at": "..." }
  ],
  "count": 150,
  "page": 2,
  "pageSize": 20
}
```

### 单条对象
```json
{
  "id": "...",
  "name": "...",
  "created_at": "..."
}
```

### 错误响应
```json
{
  "error": "PermissionDenied",
  "details": "User lacks READ permission on resource orders"
}
```

## 版本控制
- 当前实现基于 **v1.0.0**
- 未来向后兼容的变更将使用 `/v2/` 前缀
- 重大变更将通过 `Deprecation` Header 通知客户端

## 安全注意事项
1. 所有请求均必须经过 `check_user_permission` RPC 验证。
2. 防止 SQL 注入：使用 PostgREST 自动参数化。
3. 速率限制：建议在 API 网关（Cloudflare）层添加每 IP 每分钟 120 次限制。
4. 日志：所有访问日志将写入 Supabase `logs` 表（由触发器自动记录）。
5. 数据加密：敏感字段（如 `password_hash`）已在存储层加密。

## 后续扩展
- WebSocket 订阅库存实时变化（通过 Supabase Realtime）
- 文件上传（如产品图片）使用 Supabase Storage
- 第三方物流接口（EDI / API）网关
- AI 需求预测微服务（调用外部模型）