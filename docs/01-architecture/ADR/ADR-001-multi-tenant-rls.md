# ADR-001: 多租户隔离采用 PostgreSQL 行级安全 (RLS)

## 状态
✅ Accepted (2026-07-08)

## 背景
WMS 是面向 3PL/电商仓配一体的多租户 SaaS 系统，核心需求：
- 数据库层面强制租户隔离，防止应用层漏加 `tenant_id` 导致跨租户数据泄露
- Supabase 免费版原生支持 RLS，无需额外成本
- 兼容 Supabase Auth (JWT) 与自建用户表两种认证模式

## 决策
采用 **PostgreSQL Row Level Security (RLS)** 作为多租户隔离的唯一强制机制。

实现要点：
1. 所有带 `tenant_id` 的业务表启用 `ENABLE ROW LEVEL SECURITY`
2. 统一策略名 `tenant_isolation`，`USING (tenant_id = fn_current_tenant_id())` + `WITH CHECK` 同条件
3. 辅助函数 `fn_current_tenant_id()` 优先读取 `request.jwt.claims.app_metadata.tenant_id`，回退查 `users` 表 `auth.uid()`
4. `tenants` 表无 `tenant_id` 列，策略改为 `USING (id = fn_current_tenant_id())`
5. 无 `tenant_id` 的关联表（如 `containers`, `inventory_history`）暂不直接启用 RLS，通过外键关联间接隔离，RPC/视图由 SECURITY DEFINER 服务角色访问

## 替代方案评估
| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 应用层 WHERE 过滤 | 简单 | 易漏写、难审计、无强制性 | ❌ 拒绝 |
| 视图 + SECURITY DEFINER | 可控 | 维护成本高、易绕过 | ❌ 拒绝 |
| **RLS** | **数据库强制、零信任、审计友好** | **需正确配置 JWT** | ✅ 采用 |

## 后果
- 正面：生产级隔离、Supabase 免费版可用、审计合规
- 负面：需在 Supabase Auth 用户 `app_metadata` 配置 `tenant_id`；本地开发需模拟 JWT 或用服务角色
- 风险：`service_role` key 绕过 RLS，严禁前端暴露

## 关联
- 实现见 `supabase/migrations/001_initial_schema.sql` §19
- `fn_current_tenant_id()` 实现细节同文件
