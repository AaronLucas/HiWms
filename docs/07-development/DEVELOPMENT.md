# 开发手册：命令速查、本地环境、调试指南

> 日常开发常用命令、环境搭建、常见问题排查。

---

## 1. 快速开始

### 1.1 环境要求
```bash
# Node.js 版本
node --version  # >= 20.0.0

# 依赖安装
npm ci

# 环境变量配置（复制模板并填写）
cp .env.example .env
# 编辑 .env 填入 Supabase 凭钥
```

### 1.2 本地开发服务
```bash
# 启动开发服务器（热重载）
npm run dev

# 仅类型检查
npm run lint

# 完整构建
npm run build

# 运行所有测试
npm run test

# 监听模式测试
npm run test:watch

# 带覆盖率测试
npm run test:coverage

# CI 全流程（本地模拟）
npm run ci
```

---

## 2. 项目专用命令

### 2.1 构建与类型检查
```bash
npm run lint          # TypeScript 类型检查 (tsc --noEmit)
npm run prebuild      # 预构建 workflow-engine workspace
npm run build         # 完整构建（含 workflow-engine）
```

### 2.2 测试
```bash
npm run test          # 运行所有测试 (vitest run)
npm run test:watch    # 监听模式测试
npm run test:coverage # 带覆盖率测试
npm run ci            # CI 全流程 (lint + test:coverage + build)
```

### 2.3 数据库迁移
```bash
# 安装 Supabase CLI
npm i -g supabase

# 登录（需个人访问令牌）
supabase login

# 关联项目
supabase link --project-ref <project-ref>

# 创建新迁移
supabase migration new <name>

# 推送迁移到远程
supabase db push

# 重置本地数据库（需 Docker）
supabase db reset

# 生成 TypeScript 类型
supabase gen types typescript --project-id <project-id> > src/types/supabase.ts

# 本地开发数据库（需 Docker）
supabase start
supabase stop
```

### 2.4 代码生成
```bash
# 从 OpenAPI 生成客户端（如需）
npx openapi-typescript ./docs/02-api/openapi.yaml -o src/types/api.d.ts
```

---

## 3. Docker 本地全栈

### 3.1 启动完整栈
```bash
# 构建并启动（前台）
docker compose up --build

# 后台运行
docker compose up -d --build

# 查看日志
docker compose logs -f api
docker compose logs -f frontend
```

### 3.2 常用操作
```bash
# 停止并删除容器
docker compose down

# 停止并删除卷（清数据库数据）
docker compose down -v

# 重启单个服务
docker compose restart api

# 进入容器调试
docker compose exec api sh
docker compose exec db psql -U postgres
```

### 3.3 服务端口映射
| 服务 | 容器端口 | 宿主端口 | 说明 |
|------|----------|----------|------|
| API | 3000 | 3000 | Express 后端 |
| Frontend | 5173 | 5173 | Vite 开发服务器 |
| PostgreSQL | 5432 | 5432 | Supabase 本地 DB |
| Kong (API Gateway) | 8000 | 8000 | Supabase 网关 |
| Studio | 54323 | 54323 | Supabase Dashboard |

---

## 4. 部署脚本（待实现）

```bash
# 部署到 Staging
./scripts/deploy.sh staging

# 部署到 Production
./scripts/deploy.sh production

# 回滚
./scripts/rollback.sh

# 蓝绿部署
./scripts/blue-green-deploy.sh

# 金丝雀发布
./scripts/canary-deploy.sh
```

---

## 5. 常见问题排查

### 5.1 TypeScript 编译错误
```bash
# 查看详细错误
npx tsc --noEmit --pretty false 2>&1 | head -100

# 常见原因：
# 1. 类型定义缺失 → 运行 supabase gen types
# 2. 导入路径错误 → 检查 tsconfig.json paths
# 3. 版本不匹配 → 删除 node_modules 重新 npm ci
```

### 5.2 Supabase 连接失败
```bash
# 检查环境变量
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY

# 测试连接
curl -H "apikey: $SUPABASE_ANON_KEY" "$SUPABASE_URL/rest/v1/"

# 本地数据库未启动
supabase start
```

### 5.3 测试失败
```bash
# 单独运行某测试文件
npx vitest run src/__tests__/AuthMiddleware.test.ts

# 查看测试详细输出
npx vitest run --reporter=verbose

# 更新快照
npx vitest run -u
```

### 5.4 端口冲突
```bash
# 查找占用端口进程
lsof -i :3000
lsof -i :5432

# 杀死进程
kill -9 <PID>
```

### 5.5 依赖问题
```bash
# 清理重装
rm -rf node_modules package-lock.json
npm ci

# 检查过时依赖
npm outdated

# 审计安全漏洞
npm audit
npm audit fix
```

---

## 6. 开发工作流

### 6.1 功能分支流程
```bash
# 从 dev 切出功能分支
git checkout dev
git pull origin dev
git checkout -b feature/inventory-batch-reserve

# 开发...
# 提交（遵循 Conventional Commits）
git add .
git commit -m "feat(inventory): add batch reservation API"

# 推送并创建 PR
git push origin feature/inventory-batch-reserve
# 在 GitHub 创建 PR 到 dev
```

### 6.2 发布流程
```bash
# 从 dev 切 release 分支
git checkout dev
git pull origin dev
git checkout -b release/v1.2.0

# 仅修 bug、更新版本号、CHANGELOG
npm version minor  # 或 patch/major
# 生成 CHANGELOG
npx conventional-changelog -p angular -i CHANGELOG.md -s

# 合并到 main 并打标签
git checkout main
git merge release/v1.2.0
git tag v1.2.0
git push origin main --tags

# 删除 release 分支
git branch -d release/v1.2.0
git push origin --delete release/v1.2.0
```

---

## 7. 调试技巧

### 7.1 VS Code 调试配置
`.vscode/launch.json`：
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "console": "integratedTerminal",
      "env": {
        "NODE_ENV": "development"
      }
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["vitest", "run", "--inspect-brk"],
      "console": "integratedTerminal"
    }
  ]
}
```

### 7.2 结构化日志
```typescript
// 使用统一日志格式
import { logger } from './utils/logger';

logger.info('Order allocated', {
  orderId: 'ord_123',
  tenantId: 'tenant_456',
  items: 5,
  durationMs: 120
});

// 输出：{"level":"info","message":"Order allocated","orderId":"ord_123","tenantId":"tenant_456","items":5,"durationMs":120,"timestamp":"2024-01-15T10:30:00.000Z"}
```

### 7.3 数据库调试
```sql
-- 查看当前租户上下文
SELECT current_setting('app.current_tenant_id', true);

-- 查看 RLS 策略
SELECT * FROM pg_policies WHERE tablename = 'products';

-- 查看慢查询
SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

---

## 8. 环境变量完整列表

参考 `.env.example`：

```env
# 必需
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # 仅服务端
JWT_SECRET=your-super-secret-key-min-32-chars

# 可选
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
REDIS_URL=redis://localhost:6379

# Supabase 本地开发（supabase start 自动生成）
# SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres
# SUPABASE_STUDIO_URL=http://localhost:54323
```

---

## 9. 相关文档链接

- 架构设计：`docs/01-architecture/ARCHITECTURE.md`
- API 规范：`docs/02-api/API_SPEC.md`
- 数据库：`docs/03-database/DB_SCHEMA.md`
- 工作流/部署：`docs/04-workflows/WORKFLOWS.md`
- 运维体系：`docs/05-operations/OPS.md`
- 编码约定：`docs/00-project/CONVENTIONS.md`
- 任务树：`docs/00-project/ROADMAP.md`

---

*本手册随工具链演进更新。新增常用命令请及时补充。*