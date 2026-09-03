#!/bin/bash
set -e

echo "🚀 DBA 迁移本地验证 — 权限配置流程"
echo ""

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

# 启动 Supabase
echo "📝 步骤 1: 启动本地 Supabase..."
if ! supabase status &> /dev/null; then
  supabase start --workdir ./supabase
  sleep 10
else
  echo "   (Supabase 已运行)"
fi
echo "✅ Supabase 就绪"
echo ""

# 获取正确的容器名称（project_id 从 supabase/.branches 读取，但这里直接用 hiwms-supabase）
DB_CONTAINER="supabase_db_hiwms-supabase"

# 应用迁移前权限
echo "📝 步骤 2: 应用迁移前权限配置..."
cat supabase/tests/harness/bootstrap-default-privileges.sql | docker exec -i $DB_CONTAINER psql -U postgres -d postgres > /dev/null 2>&1 && \
  echo "✅ 迁移前权限配置成功" || echo "⚠️  迁移前权限配置失败（可能已存在），继续..."
echo ""

# 应用迁移
echo "📝 步骤 3: 应用所有数据库迁移..."
supabase db reset
echo "✅ 迁移成功应用"
echo ""

# 应用迁移后权限
echo "📝 步骤 4: 应用迁移后权限配置..."
cat supabase/tests/harness/bootstrap-roles.sql | docker exec -i $DB_CONTAINER psql -U postgres -d postgres > /dev/null 2>&1 && \
  echo "✅ 迁移后权限配置成功" || echo "⚠️  迁移后权限配置失败，继续..."
echo ""

echo "════════════════════════════════════════════════════════════════"
echo "✅ 本地数据库初始化完成！"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "🧪 现在可以运行测试："
echo "   RUN_DB_CONCURRENCY_TESTS=true npm run test"
echo ""
