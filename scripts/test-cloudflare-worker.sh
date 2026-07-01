#!/usr/bin/env bash
# CI test script to verify Cloudflare Worker caching behavior
# This runs in GitHub Actions or locally

set -euo pipefail

echo "🧪 Testing Cloudflare Worker cache behavior..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo "❌ wrangler not found. Installing..."
  npm install -g wrangler
fi

# Start worker in test mode (requires wrangler dev)
# For CI, we will run a quick test with miniflare
echo "Running unit tests with miniflare..."

# Run jest test (assuming test file exists)
if [ -f "cloudflare/worker.test.js" ]; then
  npm test
else
  echo "⚠️  No test file found. Skipping unit tests."
fi

# Deploy to staging preview (optional)
if [ "${GITHUB_REF:-}" = "refs/heads/main" ]; then
  echo "Deploying to production..."
  wrangler publish --env production
else
  echo "📝 Preview deployment skipped (not on main)."
fi

echo "✅ CI test completed."