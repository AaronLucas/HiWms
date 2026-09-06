#!/bin/bash
# 从 HiWmsSupabase 同步权限脚本
#
# DBA 的权限脚本是在 HiWmsSupabase 中管理的，本脚本用于同步到本地
# 这两个脚本对于本地测试环境与真实 Supabase 权限配置一致至关重要

set -e

echo "📥 从 HiWmsSupabase 同步权限脚本..."
echo ""

# 临时目录
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Clone HiWmsSupabase
echo "🔄 克隆 HiWmsSupabase 仓库..."
git clone --depth=1 https://github.com/AaronLucas/HiWmsSupabase.git "$TEMP_DIR" > /dev/null 2>&1

# 创建目标目录
mkdir -p supabase/tests/harness

# 复制权限脚本
if [ -f "$TEMP_DIR/supabase/tests/harness/bootstrap-default-privileges.sql" ]; then
  cp "$TEMP_DIR/supabase/tests/harness/bootstrap-default-privileges.sql" supabase/tests/harness/
  echo "✅ bootstrap-default-privileges.sql 已同步"
else
  echo "❌ 找不到 bootstrap-default-privileges.sql"
  exit 1
fi

if [ -f "$TEMP_DIR/supabase/tests/harness/bootstrap-roles.sql" ]; then
  cp "$TEMP_DIR/supabase/tests/harness/bootstrap-roles.sql" supabase/tests/harness/
  echo "✅ bootstrap-roles.sql 已同步"
else
  echo "❌ 找不到 bootstrap-roles.sql"
  exit 1
fi

echo ""
echo "✅ 权限脚本同步完成"
echo ""
echo "🎯 下一步："
echo "   bash scripts/setup-db-with-permissions.sh"
