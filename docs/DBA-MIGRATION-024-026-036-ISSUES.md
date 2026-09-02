# DBA 迁移 024/026/036 集成问题分析报告

**日期**: 2026-09-02  
**负责人**: 应用层  
**状态**: 需要 DBA 团队验证

## 问题 1: 缺失权限配置（CRITICAL）

### 症状
```
Unknown Error: permission denied for table tenants
```

### 根本原因

**已验证的事实：**
- ✅ 迁移 024/026/036 本身正确应用
- ✅ RLS 策略正确定义（`id = fn_current_tenant_id()`）  
- ✅ 触发器 `handle_new_user()` 正确执行
- ✅ JWT token 正确包含 `app_metadata.tenant_id`
- ❌ **`authenticated` 角色缺少 SELECT/INSERT/UPDATE/DELETE 权限**

权限定义在 `scripts/ci-db-grants.sql`，但不是迁移文件。Supabase Cloud 自动配置，本地 Docker 需要手动执行。

### 问题关键

权限层级 > RLS 层级。即使 RLS 允许访问，缺少表权限也会被拒绝。

**需要 DBA 确认：**应该创建正式迁移 `037_role_grants.sql` 还是继续作为 CI workaround？

---

## 问题 2: 认证方式兼容性（需验证）

### 当前应用代码问题

使用 `auth.setSession()` 方式可能在本地 Docker 中无法正确传递 Authorization header。

### 我们的修复

改用 `global.headers` 方式：
```typescript
const authenticatedClient = createClient<Database>(supabaseUrl, anonKey, {
  global: {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  },
});
```

**需要 DBA/Supabase 团队确认：**
1. `setSession()` 在本地环境是否应该工作？
2. 这是否是 Supabase JS SDK 的预期行为或 bug？
3. `global.headers` 方式是否是推荐用法？

---

## 验证命令

```bash
# 1. 查看权限问题
npx tsx test-setsession.ts

# 2. 验证 JWT 包含 tenant_id
npx tsx test-jwt-content.ts

# 3. 测试修复后的方式
npx tsx test-global-headers.ts
```

---

## 应用层已做改进

✅ 创建 `getAuthenticatedClient()` 测试辅助函数  
✅ 修改 `SupabaseTenantRepository` 支持 `authToken` 参数  
✅ 改用 `global.headers` 传递 JWT token  
✅ 完整问题诊断和文档

---

## 后续期望

1. DBA 确认权限配置交付方式
2. DBA 确认 setSession() 兼容性问题
3. DBA 提供修复或建议方案
4. 更新 CI 流程权限配置步骤
