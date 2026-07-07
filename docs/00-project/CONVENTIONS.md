# 编码约定与开发规范

> 所有开发人员必须遵守的代码规范、命名约定、架构约束。

---

## 1. 目录结构约定

```
src/
├── index.ts              # 应用入口
├── routes/               # API 路由（每模块一个文件，kebab-case）
│   ├── auth.ts
│   ├── inventory.ts
│   ├── orders.ts
│   ├── work-orders.ts
│   ├── sorting.ts
│   ├── verification.ts
│   ├── packing.ts
│   ├── loading.ts
│   ├── replenishment.ts
│   ├── wave-strategy.ts
│   ├── devices.ts
│   └── reports.ts
├── services/             # 业务逻辑服务（单一职责，依赖注入）
│   ├── BillingEngine.ts
│   ├── RoleManager.ts
│   ├── StockAllocationService.ts
│   ├── WorkOrderService.ts
│   ├── SortingService.ts
│   ├── VerificationService.ts
│   ├── PackingService.ts
│   ├── LoadingService.ts
│   ├── ReplenishmentScheduler.ts
│   ├── ProductConstraintService.ts
│   ├── ActionLogService.ts
│   └── BlackboxReceivingService.ts
├── models/               # TypeScript 接口/类型定义
│   ├── entity.ts         # 核心实体
│   ├── rbac.ts           # RBAC 相关
│   └── fulfillment.ts    # 履约链相关
├── middleware/           # Express 中间件
│   └── AuthMiddleware.ts
├── supabase/             # Supabase 客户端封装
│   └── SupabaseClient.ts
├── workflows/            # 工作流引擎（主项目内部实现）
│   ├── WorkflowManager.ts
│   ├── TaskManager.ts
│   ├── Scheduler.ts
│   ├── types.ts
│   └── tasks.ts
└── __tests__/            # 测试文件（就近原则，同目录或此处）
```

---

## 2. 命名约定

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `work-orders.ts`, `stock-allocation.ts` |
| 类/接口 | PascalCase | `WorkOrderService`, `SortingChute` |
| 函数/变量 | camelCase | `createWorkOrder`, `tenantId` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_ATTEMPTS`, `DEFAULT_PAGE_SIZE` |
| 类型参数 | 单大写字母或 `T` + PascalCase | `T`, `TEntity`, `TResponse` |
| 枚举值 | PascalCase | `OrderStatus.PENDING` |
| 私有成员 | 下划线前缀 | `_privateMethod()` |

---

## 3. 核心设计原则

### 3.1 单一职责原则 (SRP)
- 每个 Service 只处理**一个业务域**
- 例如：`SortingService` 只管分拣，不包含打包逻辑

### 3.2 依赖注入
- 通过构造函数注入依赖，**不直接 import 单例**
- ❌ 错误：`import { supabase } from '../supabase/client'`
- ✅ 正确：`constructor(private supabase: SupabaseClient) {}`

### 3.3 租户隔离（强制）
- 所有数据库操作**必须**带 `tenant_id`
- SupabaseClient 自动注入 `tenant_id`（insert/upsert/update/delete）
- RPC 调用需显式传递 `tenant_id` 参数

### 3.4 错误处理统一
- 使用自定义错误类（`SupabaseError` 及其子类）
- **禁用**直接抛出原生 `Error` 或字符串
- 错误码规范：`CONNECTION_ERROR` | `QUERY_ERROR` | `MUTATION_ERROR` | `RPC_ERROR` | `TENANT_ERROR` | `TRANSACTION_ERROR`

### 3.5 类型安全
- **禁用 `any`**（极少数 `unknown` 允许配合类型收窄）
- 数据库查询必须指定返回类型：`select<UserRow>('*')`
- RPC 参数/返回定义接口：`interface CheckPermissionParams { ... }`

---

## 4. API 路由设计规范

### 4.1 RESTful 端点命名
```
GET    /api/{resource}          # 列表（支持分页、筛选、排序）
POST   /api/{resource}          # 创建
GET    /api/{resource}/{id}     # 详情
PATCH  /api/{resource}/{id}     # 部分更新
DELETE /api/{resource}/{id}     # 删除
```

### 4.2 复合操作使用子资源或动作后缀
```
POST   /api/orders/{id}/allocate      # 订单分配
POST   /api/waves/{id}/execute        # 波次执行
POST   /api/work-orders/{id}/complete # 工单完成
```

### 4.3 查询参数标准化
| 参数 | 说明 | 示例 |
|------|------|------|
| `page` | 页码（从 1 开始） | `?page=2` |
| `page_size` | 每页条数（默认 20，最大 100） | `?page_size=50` |
| `sort` | 排序字段，`-` 前缀降序 | `?sort=-created_at` |
| `filter[field]` | 精确筛选 | `?filter[status]=pending` |
| `search` | 全文搜索 | `?search=sku123` |

### 4.4 统一响应格式
```typescript
// 成功
{
  "data": T | T[],
  "meta": { "page": 1, "page_size": 20, "total": 100 }
}

// 失败
{
  "error": {
    "code": "ERROR_CODE",
    "message": "人类可读的错误信息",
    "details": {}  // 可选，结构化错误详情
  }
}
```

---

## 5. 数据库操作规范

### 5.1 迁移命名
```
{timestamp}_{short_description}.sql
例：20240115000001_create_products_table.sql
```

### 5.2 表/列命名
- 表名：snake_case 复数（`products`, `work_orders`）
- 列名：snake_case（`tenant_id`, `created_at`, `sku_code`）
- 主键：`id` (uuid) 或 `id` (bigserial)
- 外键：`{table}_id`（`product_id`, `location_id`）

### 5.3 RLS 策略
- **所有表必须启用 RLS**
- 策略命名：`{table}_{action}_{role}`（`products_select_tenant_user`）
- 使用 `auth.jwt() ->> 'tenant_id'` 获取当前租户

---

## 6. 测试规范

| 测试类型 | 目标覆盖率 | 工具 | 位置 |
|----------|------------|------|------|
| 单元测试 | ≥ 80% 核心逻辑 | Vitest | `src/__tests__/` 或就近 |
| 集成测试 | 关键流程 100% | Vitest + Supabase Local | `test/integration/` |
| E2E 测试 | 核心业务流程 | Playwright | `test/e2e/` |

- 测试文件命名：`{module}.test.ts`
- 使用 `describe`/`it` 结构化，命名用中文描述行为

---

## 7. Git 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Type 类型
| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更 |
| `style` | 格式调整（不影响逻辑） |
| `refactor` | 重构（非新增/修复） |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖更新 |
| `perf` | 性能优化 |
| `build` | 构建系统变更 |
| `ci` | CI 配置变更 |

### Scope 范围（模块名）
`auth` | `inventory` | `orders` | `waves` | `work-orders` | `sorting` | `verification` | `packing` | `loading` | `replenishment` | `devices` | `reports` | `rbac` | `billing` | `workflow` | `db` | `ci` | `docker` | `k8s`

### 示例
```
feat(inventory): add batch reservation API
fix(sorting): resolve chute assignment race condition
docs(api): update order allocation endpoint spec
refactor(workflow): extract task retry logic to base class
test(billing): add unit tests for tiered pricing
chore(deps): upgrade @supabase/supabase-js to v2.110
```

---

## 8. 代码审查清单

提交 PR 前自检：

- [ ] TypeScript 编译通过（`npm run lint`）
- [ ] 单元测试通过（`npm run test`）
- [ ] 无 `any` 类型（或已加 `// @ts-expect-error` 注释说明原因）
- [ ] 所有数据库操作带 `tenant_id`
- [ ] 错误处理使用自定义错误类
- [ ] 新增 API 有对应类型定义
- [ ] 变更涉及 Schema 时已生成迁移脚本
- [ ] 更新了相关文档（API_SPEC.md, DB_SCHEMA.md 等）

---

## 9. 禁用模式

| 禁用项 | 理由 | 替代方案 |
|--------|------|----------|
| `any` 类型 | 失去类型安全 | 定义接口、用 `unknown` + 类型收窄 |
| 直接 `console.log` | 生产环境污染 | 结构化日志（`logger.info()`） |
| 硬编码字符串（状态、错误码） | 难维护 | 定义常量/枚举 |
| 循环中执行异步操作 | 性能差 | `Promise.all` 批量或数据库批量操作 |
| 业务逻辑写在路由层 | 难测试、复用 | 下沉到 Service 层 |
| 跨 Service 直接调用私有方法 | 破坏封装 | 定义公共接口或事件总线 |

---

*本文档随项目演进持续更新。重大规范变更需团队评审通过。*