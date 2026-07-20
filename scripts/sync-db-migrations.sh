#!/usr/bin/env bash
# 把 HiWmsSupabase（DBA 团队独立管理的迁移仓库）同步到本地 ./supabase/。
#
# wms7 与 HiWmsSupabase 之间没有 git 层面的关联（无 submodule），本脚本是本地
# 拉取内容的唯一方式；同步结果落地在 gitignore 的 ./supabase/ 目录，不会被提交。
#
# 用法：
#   bash scripts/sync-db-migrations.sh
#   之后可用 `supabase start && supabase db reset` 起本地一次性 Postgres 并应用迁移。

set -euo pipefail

REPO_URL="https://github.com/AaronLucas/HiWmsSupabase.git"
TARGET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase"
TMP_CLONE="$(mktemp -d)"
trap 'rm -rf "$TMP_CLONE"' EXIT

echo "🔄 Cloning HiWmsSupabase (shallow)..."
git clone --quiet --depth 1 "$REPO_URL" "$TMP_CLONE"

if [ ! -d "$TMP_CLONE/supabase" ]; then
  echo "❌ $REPO_URL 里没有 supabase/ 目录，同步中止" >&2
  exit 1
fi

echo "📦 Syncing into $TARGET_DIR ..."
rm -rf "$TARGET_DIR"
cp -r "$TMP_CLONE/supabase" "$TARGET_DIR"

echo "✅ 已同步 $(ls "$TARGET_DIR/migrations" | wc -l | tr -d ' ') 个迁移脚本到 ./supabase/migrations/"
echo "   下一步：supabase start && supabase db reset"
