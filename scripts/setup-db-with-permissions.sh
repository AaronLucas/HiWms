#!/bin/bash
# 本地数据库初始化 — 应用正确的权限脚本
# 
# 这个脚本确保本地测试环境与真实 Supabase 环境的权限配置一致
# 关键流程：权限脚本 → 迁移 → 权限脚本

set -e

POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/postgres"

echo "🚀 DBA 迁移本地验证 — 权限配置流程"
echo ""

# 检查脚本文件
if [ ! -f "supabase/tests/harness/bootstrap-default-privileges.sql" ]; then
  echo "❌ 找不到 supabase/tests/harness/bootstrap-default-privileges.sql"
  exit 1
fi

if [ ! -f "supabase/tests/harness/bootstrap-roles.sql" ]; then
  echo "❌ 找不到 supabase/tests/harness/bootstrap-roles.sql"
  exit 1
fi

echo "✅ 权限脚本已就位"
echo ""

# 步骤 1: 启动 Supabase
echo "📝 步骤 1: 启动本地 Supabase..."
if ! supabase status &> /dev/null; then
  supabase start --workdir ./supabase
  sleep 10
else
  echo "   (Supabase 已运行)"
fi

echo "✅ Supabase 就绪"
echo ""

# 步骤 2: 应用迁移前权限
echo "📝 步骤 2: 应用迁移前权限配置（ALTER DEFAULT PRIVILEGES）..."
if psql "$DB_URL" -f supabase/tests/harness/bootstrap-default-privileges.sql; then
  echo "✅ 迁移前权限配置成功"
else
  echo "⚠️  迁移前权限配置失败，继续..."
fi
echo ""

# 步骤 3: 重置数据库（应用所有迁移）
echo "📝 步骤 3: 应用所有数据库迁移..."
supabase db reset
echo "✅ 迁移成功应用"
echo ""

# 步骤 4: 应用迁移后权限（补回被跳过的条件式 GRANT/REVOKE）
echo "📝 步骤 4: 应用迁移后权限配置（补回被跳过的 GRANT/REVOKE）..."
if psql "$DB_URL" -f supabase/tests/harness/bootstrap-roles.sql; then
  echo "✅ 迁移后权限配置成功"
else
  echo "⚠️  迁移后权限配置失败，继续..."
fi
echo ""

echo "════════════════════════════════════════════════════════════════"
echo "✅ 本地数据库初始化完成！"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "🧪 现在可以运行测试："
echo "   RUN_DB_CONCURRENCY_TESTS=true npm run test"
echo ""
