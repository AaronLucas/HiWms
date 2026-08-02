# ADR-017: 平台管理员 RBAC 模型——is_system_user 双语义拆分

**状态**: 草案（待评审）  
**日期**: 2026-08-02  
**决策者**: 项目负责人  
**关联**: ADR-016（scope='platform' 提案）、ROADMAP 4.9

---

## 1. 背景与痛点

### 1.1 当前实现（`is_system_user`）

`public.users.is_system_user` 是一个布尔列，目前在代码中承担两种语义：

| 语义 | 代码位置 | 行为 |
|------|---------|------|
| **A: 平台管理员** | `admin-api/main.ts:70-76` | 放行所有 admin-api 路由 |
| **B: 租户内部系统账号** | `tenant-api` 路由 `isSystemUser` 校验 | 2016-08-01 PR #65 已移除硬编码 bypass |

### 1.2 具体痛点

1. **双重语义复用**：同一个 `true` 既表示"我是平台超管"又表示"我是租户内的系统账号"。这两种身份的操作权限完全不同——平台超管可以跨租户操作，租户系统账号应在自己的租户内受 RBAC 约束。

2. **admin-api 绕过了全部 RBAC**：`admin-api/main.ts` 的鉴权逻辑仅检查 `is_system_user === true`，不经过 `requirePermission()` 中间件。这意味着 admin-api 的租户管理、用户管理、计费规则等敏感操作完全不受权限矩阵约束。

3. **不可审计**：没有记录"哪个平台管理员在什么时间做了什么操作"——`is_system_user` 是静态属性，无法区分"张三用了超管权限"和"李四用了超管权限"。

4. **前向兼容风险**：如果未来引入"平台只读操作员"（platform_operator）角色，当前的布尔值无法表达"是平台角色但不是完全管理员"。

---

## 2. 可选方案

### 方案 A：保持现状（不推荐）

保持 `is_system_user` 布尔值，仅在文档层面声明其两种语义。

- **优点**：零改动成本
- **缺点**：所有痛点持续存在；admin-api 权限不可细分；审计缺失

### 方案 B：scope='platform' RBAC（ADR-016 提议）

在现有 RBAC 表结构中引入 `scope` 维度：
- `role_permissions.scope` 已有定义（`tenant` | `platform`）
- 平台管理员角色关联 `scope='platform'` 的权限
- admin-api 接入 `requirePermission()` 中间件，统一走 `check_user_permission` RPC
- `is_system_user` 降级为"租户内系统账号"标识（单一语义）

**DB 侧变更**：
```sql
-- permissions 表已有，仅需补平台级资源行
INSERT INTO permissions (resource, action) VALUES
  ('tenants', 'CREATE'),
  ('tenants', 'READ'),
  ('tenants', 'UPDATE'),
  ('tenants', 'DELETE'),
  ('users_platform', 'READ'),
  ('users_platform', 'IMPERSONATE'),
  ('billing_rules', 'CREATE'),
  ('billing_rules', 'READ'),
  ('billing_rules', 'UPDATE'),
  ('platform_config', 'READ'),
  ('platform_config', 'UPDATE'),
  ('audit_logs', 'READ');

-- 平台管理员角色（scope='platform'）
INSERT INTO roles (name, scope, description) VALUES
  ('platform_admin', 'platform', '平台超级管理员'),
  ('platform_operator', 'platform', '平台运营（只读+运营操作）');

-- 关联权限
INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, 'platform'
FROM roles r, permissions p
WHERE r.name = 'platform_admin' AND p.resource IN (...);
```

**应用层变更**：
- admin-api 从单文件 184 行重构为分层结构（config/di/routes/validation），Sprint 5 5.2 的一部分
- `POST /auth/login` 加 `rateLimit()`
- 所有 admin 路由接入 `requirePermission(resource, action, 'platform')`
- `is_system_user` 仅在 tenant-api 内使用（区分租户内系统账号 vs 普通用户）

- **优点**：统一 RBAC 模型、可审计、可细分平台权限、`is_system_user` 语义单一化
- **缺点**：需要 DBA 执行种子数据变更 + admin-api 重构（与 Sprint 5 5.2 合并推进）

### 方案 C：方案 B + 限时影子登录 + 审计（完全体）

在方案 B 基础上增加：
1. **限时影子登录**：平台管理员可以"以某租户身份登录"，获得临时 JWT（`app_metadata.impersonating_tenant_id`），操作受该租户 RLS 约束。到期自动失效（max 4 小时）。
2. **审计日志**：所有平台操作写入 `platform_audit_log` 表（操作者 ID、操作类型、目标租户、时间戳、结果）。

- **优点**：完整的合规审计链；影子登录减少"直接操作生产租户数据"的风险
- **缺点**：工程量大；影子登录需要在 GoTrue 层面支持自定义 claim（Supabase 支持 `app_metadata` 写入，可行但需要额外开发）

---

## 3. 推荐路径

**分两期推进**：

### 第一期（当前 Sprint 5）：方案 B —— scope='platform' RBAC
- 与 5.2（admin-api 重构）合并推进
- 改动面可控：permissions 种子数据 + admin-api 路由改造
- 产出：admin-api 具备完整的 RBAC 覆盖 + `is_system_user` 语义单一化

### 第二期（Sprint 6+）：方案 C 增量 —— 影子登录 + 审计
- 依赖第一期完成（RBAC 基础设施就绪）
- 按需启动：等业务侧确认是否需要完整的合规审计链

---

## 4. 决策请求

请项目负责人确认：

1. **是否接受方案 B 作为第一期目标？**（与 Sprint 5 5.2 admin-api 重构合并推进）
2. **permissions 种子数据由哪一方执行？**（DBA 团队通过 HiWmsSupabase 仓库，还是应用层通过 migration？）
3. **平台角色是否需要更细粒度的划分？**（当前方案 B 建议 `platform_admin` + `platform_operator` 两级，是否需要更多？）

---

## 5. 关联文档

- ADR-016: scope='platform' 原始提案
- ROADMAP §4.9（本 ADR 对应的任务项）
- ROADMAP §5.2（admin-api 重构，与本期合并推进）
- `docs/02-api/API_SPEC.md` §7.2（RBAC 权限矩阵）
