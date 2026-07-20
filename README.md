<!---  Wms (Warehouse Management System) 项目概述 ---

**项目核心目标**
- 为创业公司提供高效的多租户仓储管理解决方案
- 支持免费版、会员版和高级定制版三种计费模式
- 基于 Supabase (PostgreSQL) 的免费云基础设施
- 主前端框架为 Uniapp (Vue3)，方便多端开发
- 提供完整的开发工作流程：从需求到部署的一站式服务

---

## 项目环境与工具

- **版本控制**：Git，主分支 `main`
- **开发语言**：TypeScript + Node.js
- **前端框架架架**：Uniapp (Vue3)
- **后端数据库**：Supabase (PostgreSQL)
- **构建工具**：Vite
- **状态管理**：Redux Toolkit
- **测试框架**：Jest
- **代码检查**：ESLint、Prettier
- **文档生成**：GitHub Pages + Markdown

---

## 快速开始

1. 克隆仓库并安装依赖
   ```bash
   git clone <repository_url>
   npm install
   ```

2. 设置环境变量（参考 `.env.example`）
   ```bash
   cp .env.example .env
   # 编辑 .env，填入 Supabase URL、匿名密钥等配置
   ```

3. 启动开发服务器
   ```bash
   npm run dev
   ```

4. 运行测试
   ```bash
   npm test
   ```

5. 构建生产版本
   ```bash
   npm run build
   ```

---

## 项目架构

```
/src/
├── models/          # 数据模型定义 (TypeScript 接口)
├── services/        # 业务逻辑服务
├── clients/         # Uniapp 前端代码
├── middlewares/     # 认证/权限中间件
├── workflows/       # 工作流编排系统
├── supabase/        # Supabase 扩展与迁移
├── tools/           # 开发工具脚本
├── docs/            # 文档
│   ├── API.md       # API 接口文档 (中文)
│   ├── ROADMAP.md   # 实现路线图 (中文)
│   └── workflows.md  # 工作流文档 (中文)
└── .github/         # GitHub Actions CI/CD 配置
```

---

## 主要模块

### 1. RBAC 系统 (角色权限)
- 用户认证与授权
- 角色分配管理
- 权限控制与审计

### 2. 工作流编排系统
- 库存同步工作流
- 订单处理流程
- 任务依赖管理
- 并行与序列任务执行

### 3. 前端 (Uniapp)
- 用户界面组件
- 数据可视化组件
- 实时数据更新

### 4. 云函数 (Cloudflare Workers)
- 边缘缓存与权限检查
- API 网关转发
- 辅助处理逻辑

### 5. 数据库 (Supabase)
- 多租户数据隔离
- 角色权限管理表
- 库存、订单等工作表
- 审计日志

---

## 团队协作

本项目采用自动化的工程实践：

1. **Git 分支策略**
   - `main` (生产) – 稳定版本
   - `dev` (开发) – 日常开发
   - `feature/*` – 特性分支
   - `release/*` – 发布分支
   - `hotfix/*` – 紧急修复

2. **CI/CD 流程**
   - PR 检查 (Lint、格式、单元测试)
   - 自动部署到暂存环境
   - 版本发布与 Tag 管理

3. **代码审查**
   - 通过 PR 请求进行代码审查
   - 使用标准注释风格与文档
   - 遵循 ESLint 等规范

---

## 贡献指南

1. **分支**：从 `main` 分支开始
2. **提交**：遵循 Conventional Commits 规范
3. **Pull Request**：提交并关联问题描述
4. **代码审查**：确保通过 CI/CD 检查
5. **合并**：合并无冲突的代码

---

## 法律法规与隐私

- **数据隐私**：尊重用户隐私，加密存储敏感数据
- **许可证**：本项目遵循 MIT 许可证
- **开源协议**：使用 Apache 2.0 许可的大部分外部组件

---

## 联系方式

- **GitHub**：https://github.com/AaronLucas/HiWms
- **邮箱**：<aaronlucas@126.com>
- **文档**：见 `/docs/` 目录

---

### 鸣谢

感谢所有为本项目做出贡献的开发者。

### 变更日志

#### 版本 1.0.0
- 初步版本发布
- 核心功能：多租户、RBAC、工作流编排

---

*本 README 文件由自动化脚本生成，随时更新。*