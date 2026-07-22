#!/usr/bin/env bash
# 把 HiWmsSupabase（DBA 团队独立管理的迁移仓库）同步到本地 ./supabase/ 和 .readonly/。
#
# HiWms 与 HiWmsSupabase 之间没有 git 层面的关联（无 submodule），本脚本是本地
# 拉取内容的唯一方式；取代此前"DBA 手工把文件丢进 .readonly/"的人工流程——
# .readonly/ 现在是本脚本从 HiWmsSupabase 拉取生成的只读镜像，不再手工维护。
# 同步结果落地在 gitignore 的 ./supabase/ 与 .readonly/ 目录，均不会被提交。
#
# 用法：
#   bash scripts/sync-db-migrations.sh
#   之后可用 `supabase start && supabase db reset` 起本地一次性 Postgres 并应用迁移。
#
# 注意：同步会整个替换 ./supabase/ 目录，包含 Supabase CLI 自己维护的本地 link
# 状态（./supabase/.temp/project-ref 等）。本脚本会在替换前记下旧的 project-ref，
# 替换完成后尝试用 `supabase link` 自动恢复同一个连接；如果本机 CLI 未登录或
# 恢复失败，只打印手动恢复命令，不会导致本次同步失败。

set -euo pipefail

REPO_URL="https://github.com/AaronLucas/HiWmsSupabase.git"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE_TARGET="$ROOT_DIR/supabase"
READONLY_TARGET="$ROOT_DIR/.readonly"
TMP_CLONE="$(mktemp -d)"
trap 'rm -rf "$TMP_CLONE"' EXIT

echo "🔄 Cloning HiWmsSupabase (shallow)..."
git clone --quiet --depth 1 "$REPO_URL" "$TMP_CLONE"

if [ ! -d "$TMP_CLONE/supabase" ]; then
  echo "❌ $REPO_URL 里没有 supabase/ 目录，同步中止" >&2
  exit 1
fi

PREV_PROJECT_REF=""
if [ -f "$SUPABASE_TARGET/.temp/project-ref" ]; then
  PREV_PROJECT_REF="$(cat "$SUPABASE_TARGET/.temp/project-ref")"
fi

echo "📦 Syncing migrations into $SUPABASE_TARGET ..."
rm -rf "$SUPABASE_TARGET"
cp -r "$TMP_CLONE/supabase" "$SUPABASE_TARGET"

echo "📦 Syncing design docs + ops scripts into $READONLY_TARGET ..."
rm -rf "$READONLY_TARGET"
mkdir -p "$READONLY_TARGET"
[ -d "$TMP_CLONE/design-docs" ] && cp "$TMP_CLONE"/design-docs/*.md "$READONLY_TARGET/" 2>/dev/null || true
[ -d "$TMP_CLONE/design-docs/diagrams" ] && cp "$TMP_CLONE"/design-docs/diagrams/* "$READONLY_TARGET/" 2>/dev/null || true
[ -d "$TMP_CLONE/ops-scripts" ] && cp "$TMP_CLONE"/ops-scripts/*.sql "$READONLY_TARGET/" 2>/dev/null || true

echo "✅ 已同步 $(ls "$SUPABASE_TARGET/migrations" | wc -l | tr -d ' ') 个迁移脚本到 ./supabase/migrations/"
echo "✅ 已同步 $(ls "$READONLY_TARGET" | wc -l | tr -d ' ') 份设计文档/图表/运维脚本到 ./.readonly/"

if [ -n "$PREV_PROJECT_REF" ] && command -v supabase >/dev/null 2>&1; then
  echo "🔗 检测到同步前已 link 到 $PREV_PROJECT_REF，尝试自动恢复本地 Supabase CLI 链接..."
  if supabase link --project-ref "$PREV_PROJECT_REF"; then
    echo "✅ 已恢复链接到 $PREV_PROJECT_REF"
  else
    echo "⚠️  自动恢复链接失败（可能是 CLI 未登录 supabase login，或网络问题），如需要请手动执行：" >&2
    echo "     supabase link --project-ref $PREV_PROJECT_REF" >&2
  fi
elif [ -n "$PREV_PROJECT_REF" ]; then
  echo "⚠️  同步前已 link 到 $PREV_PROJECT_REF，但本机未找到 supabase CLI，无法自动恢复，请自行安装后执行：" >&2
  echo "     supabase link --project-ref $PREV_PROJECT_REF" >&2
fi

echo "   下一步：supabase start && supabase db reset"
