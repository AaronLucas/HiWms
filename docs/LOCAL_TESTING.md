# 本地测试 — DBA 迁移 024/026/036

本文档说明如何在本地环境中正确测试 DBA 迁移，确保应用层与新的 RLS 安全模型兼容。

## 关键点

**问题**：本地 PostgreSQL（Docker）没有 Supabase 项目的默认角色（anon/authenticated/service_role）和隐式权限配置。这会导致本地测试出现**假绿**现象。

**解决方案**：使用两个权限脚本在正确的时机应用：
1. **迁移前**：`bootstrap-default-privileges.sql` — 建立角色和默认授权
2. **迁移后**：`bootstrap-roles.sql` — 补回被跳过的条件式 GRANT/REVOKE

## 本地测试流程

### 第一次设置（或重置）

\`\`\`bash
# 1. 同步权限脚本（从 HiWmsSupabase）
bash scripts/sync-permission-scripts.sh

# 2. 初始化本地数据库（按正确顺序应用权限 → 迁移 → 权限）
bash scripts/setup-db-with-permissions.sh

# 3. 运行集成测试
RUN_DB_CONCURRENCY_TESTS=true npm run test
\`\`\`

### 日常开发（数据库已初始化）

\`\`\`bash
# 运行测试
RUN_DB_CONCURRENCY_TESTS=true npm run test
\`\`\`

## 权限脚本说明

这两个脚本来自 HiWmsSupabase（DBA 仓库），通过 `sync-permission-scripts.sh` 同步到本地。

### 为什么需要两个脚本？

\`ALTER DEFAULT PRIVILEGES\` 必须在迁移前执行（只影响之后创建的对象）。条件权限补偿必须在迁移后执行（确保表/函数已存在）。顺序很重要。

## 相关资源

- HiWmsSupabase Issue #83: DBA 的完整问题分析
- scripts/sync-permission-scripts.sh: 获取权限脚本
- scripts/setup-db-with-permissions.sh: 完整初始化流程
