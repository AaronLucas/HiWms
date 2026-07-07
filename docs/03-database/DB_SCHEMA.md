# DB_SCHEMA.md

## 1. 租户 (tenants)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| name           | text               | not null                             |
| contact_email  | text               |                                      |
| plan_type      | enum('free','member','enterprise') |
| is_active      | boolean            | default true                         |
| created_at     | timestamp          | default now()                        |
| updated_at     | timestamp          | default now()                        |
| deleted_at     | timestamp          | nullable                             |

## 2. 用户 (users)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| email          | text               | unique, not null                     |
| password_hash  | text               | not null                             |
| full_name      | text               |                                      |
| is_active      | boolean            | default true                         |
| created_at     | timestamp          | default now()                        |
| updated_at     | timestamp          | default now()                        |
| deleted_at     | timestamp          | nullable                             |

## 3. 角色 (roles)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| name           | text               | not null                             |
| description    | text               |                                      |
| is_default     | boolean            | default false                        |
| created_at     | timestamp          | default now()                        |

## 4. 权限 (permissions)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| name           | text               | unique, not null                     |
| description    | text               |                                      |

## 5. 角色‑权限关联 (role_permissions)
| role_id        | permission_id      |
|----------------|--------------------|
| uuid (FK)      | uuid (FK)          |
*PK = (role_id, permission_id)*

## 6. 用户‑角色关联 (user_roles)
| user_id        | role_id            |
|----------------|--------------------|
| uuid (FK)      | uuid (FK)          |
*PK = (user_id, role_id)*

## 7. 商品 (products)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| sku            | text               | not null, unique per tenant          |
| name           | text               | not null                             |
| description    | text               |                                      |
| unit_weight    | numeric            |                                      |
| is_active      | boolean            | default true                         |
| created_at     | timestamp          | default now()                        |
| updated_at     | timestamp          | default now()                        |

## 8. 商品约束 (product_constraints)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| product_id     | uuid (FK)          | references products(id) on delete cascade |
| constraint_type| enum('dangerous','temperature','humidity') |
| value          | jsonb              | 约束参数（如温度范围）               |

## 9. 库位 (locations)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| code           | text               | not null, unique per tenant          |
| zone_type      | text               |                                      |
| zone_abc_type  | text               |                                      |
| capacity       | integer            |                                      |
| is_frozen      | boolean            | default false                        |
| created_at     | timestamp          | default now()                        |

## 10. 容器 (containers)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| lpn_code       | text               | not null, unique per tenant          |
| status         | enum('empty','filled','sealed','discarded') |
| current_location_id | uuid (FK)    | references locations(id) nullable     |
| created_at     | timestamp          | default now()                        |
| updated_at     | timestamp          | default now()                        |

## 11. 库存 (inventory)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| product_id     | uuid (FK)          | references products(id) on delete cascade |
| location_id    | uuid (FK)          | references locations(id) on delete cascade |
| container_id   | uuid (FK)          | references containers(id) on delete cascade |
| quantity       | integer            | not null, check (quantity >= 0)      |
| version        | bigint             | default 1                                 |
| created_at     | timestamp          | default now()                        |
| updated_at     | timestamp          | default now()                        |

## 12. 库存预留 (inventory_reservations)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| inventory_id   | uuid (FK)          | references inventory(id) on delete cascade |
| order_id       | uuid (FK)          | references orders(id) on delete cascade |
| reserved_qty   | integer            | not null, check (reserved_qty > 0)      |
| expires_at     | timestamp          | nullable                              |
| created_at     | timestamp          | default now()                        |

## 13. 订单 (orders)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| status         | enum('draft','confirmed','allocated','picked','shipped','cancelled','completed') |
| buyer_user_id  | uuid (FK)          | references users(id) on delete cascade |
| total_amount   | numeric            |                                      |
| currency       | text               |                                      |
| created_at     | timestamp          | default now()                        |
| updated_at     | timestamp          | default now()                        |

## 14. 波次 (waves)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| status         | enum('planned','picking','sorting','closed') |
| strategy_type  | text               |                                      |
| scheduled_at   | timestamp          |                                      |
| created_at     | timestamp          | default now()                        |
| updated_at     | timestamp          | default now()                        |

## 15. 工单 (work_orders)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| type           | enum('inventory','maintenance','audit') |
| status         | enum('new','assigned','in_progress','completed','exception') |
| assigned_user_id | uuid (FK)        | references users(id) on delete cascade |
| related_order_id | uuid (FK)        | references orders(id) on delete cascade |
| created_at     | timestamp          | default now()                        |
| updated_at     | timestamp          | default now()                        |

## 16. 条码映射 (barcode_mappings)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| barcode        | text               | not null, unique per tenant          |
| target_type    | enum('product','location','container') |
| target_id      | uuid               |                                      |
| created_at     | timestamp          | default now()                        |

## 17. 增值服务 (vas_boms / vas_bom_items)
- `vas_boms` (id, tenant_id, name, description, created_at, updated_at)
- `vas_bom_items` (id, bom_id, product_id, quantity, created_at, updated_at)

## 18. 计费 (billing_transactions)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| tenant_id      | uuid (FK)          | references tenants(id) on delete cascade |
| order_id       | uuid (FK)          | references orders(id) on delete cascade |
| amount         | numeric            |                                      |
| currency       | text               |                                      |
| status         | enum('pending','paid','failed','refunded') |
| created_at     | timestamp          | default now()                        |
| paid_at        | timestamp          | nullable                              |

## 19. 库存锁定 (inventory_locks)
| 列名            | 类型                | 约束                                 |
|----------------|--------------------|--------------------------------------|
| id             | uuid (PK)          | default gen_random_uuid()            |
| inventory_id   | uuid (FK)          | references inventory(id) on delete cascade |
| locked_by      | uuid (FK)          | references users(id) on delete cascade |
| lock_reason    | text               |                                      |
| expires_at     | timestamp          |                                      |
| created_at     | timestamp          | default now()                        |

## 20. 报表视图（只读）
- `report_replenishment_needs`（物料、库位、缺货阈值）
- `report_boss_cockpit`（关键 KPI：入库/出库速率、异常率、用户活跃度）
- `report_inventory_aging`（库存年龄分布）
- `report_turnover_rate`（周转率统计）

---

### 关键点

1. **多租户隔离**：所有业务表均带 `tenant_id`，并在 RLS (Row‑Level Security) 策略中使用 `auth.uid()` 与 `jwt.claims.tenant_id` 进行过滤。
2. **软删除**：共用 `is_active` / `deleted_at` 字段，以便业务层实现回收站。
3. **乐观锁**：`inventory.version` 用于防止并发更新导致库存超卖。
4. **审计日志**：统一写入 `logs`（Supabase 自动触发器），记录表名、操作类型、用户、时间、旧值/新值。
5. **状态机**：`orders.status`、`waves.status`、`work_orders.status` 均采用枚举，实现业务流转控制。

---

### RLS 策略状态 (需在 Supabase Dashboard 启用)

| 表名 | 策略名称 | 启用状态 | 说明 |
|------|----------|----------|------|
| tenants | `tenants_tenant_isolation` | ⏳ 待启用 | 仅 SUPER_ADMIN 可见所有 |
| users | `users_tenant_isolation` | ⏳ 待启用 | 租户内用户可见 |
| roles | `roles_tenant_isolation` | ⏳ 待启用 | 租户内角色可见 |
| products | `products_tenant_isolation` | ⏳ 待启用 | 租户内商品可见 |
| locations | `locations_tenant_isolation` | ⏳ 待启用 | 租户内库位可见 |
| containers | `containers_tenant_isolation` | ⏳ 待启用 | 租户内容器可见 |
| inventory | `inventory_tenant_isolation` | ⏳ 待启用 | 租户内库存可见 |
| orders | `orders_tenant_isolation` | ⏳ 待启用 | 租户内订单可见 |
| waves | `waves_tenant_isolation` | ⏳ 待启用 | 租户内波次可见 |
| work_orders | `work_orders_tenant_isolation` | ⏳ 待启用 | 租户内工单可见 |
| billing_transactions | `billing_tenant_isolation` | ⏳ 待启用 | FINANCE/ADMIN 可见 |

> **⚠️ 重要**：生产环境部署前必须在 Supabase Dashboard 或通过迁移脚本启用所有 RLS 策略，并验证租户隔离生效。

---

### 迁移脚本对应关系

| 迁移文件 | 包含表 | 状态 |
|----------|--------|------|
| `supabase/migrations/001_enterprise_core_schema.sql` | 1-19 核心表 | ✅ 已执行 |
| `supabase/migrations/002_fulfillment_chain.sql` | Phase A 履约链表 (15+) | ✅ 已执行 |
| `supabase/migrations/003_rls_policies.sql` | RLS 策略定义 | ⏳ 待创建/执行 |

---

### 版本记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-07-01 | 初始 Schema 定义 |
| 1.1.0 | 2025-07-07 | 新增 RLS 策略状态表、迁移脚本对应关系 |