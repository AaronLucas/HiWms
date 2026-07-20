# 编码约定与开发规范

> 所有开发人员必须遵守的代码规范、命名约定、架构约束。

---

## 1. 目录结构约定

> ⚠️ **2026-07-15 更新**：项目已迁移到六边形架构（Ports & Adapters），下方结构以 `docs/01-architecture/ARCHITECTURE.md` §2 为准（本节为速查摘要，完整拓扑见该文档）。旧版扁平结构（`src/supabase/SupabaseClient.ts` 单文件封装、`src/workflows/` 内部工作流实现）已被取代，**不要**再新建这两处路径下的文件。

```
src/
├── core/                    # 核心领域层（只依赖 ports/ 与 types/，不依赖任何适配器）
│   ├── domain/               # 领域模型（实体、值对象、领域事件）
│   ├── ports/                 # 端口接口（对外契约）
│   │   ├── db/                 # 仓储端口（含离线同步/统一异常领域端口，见 REPOSITORY_ROADMAP.md）
│   │   ├── auth/ cache/ external/ queue/ rpc/ workflow/
│   ├── usecases/               # 用例层（应用服务，按业务域分包）
│   └── workflows/              # 工作流引擎核心
├── adapters/                 # 适配器层（实现 ports/）
│   ├── supabase/
│   │   ├── repositories/       # Repository 实现（Supabase*Repository.ts）
│   │   └── rpc/                 # RPC 客户端实现
│   ├── cloudflare/ express/ external/ device/
├── apps/                      # 应用入口（admin-api/tenant-api/device-api/edge-worker）
├── types/                     # 类型定义（`database.ts` 为 Supabase 生成类型，单一事实来源）
└── __tests__/                 # 测试文件（就近原则，同目录或此处）
```

命名/组织细则：
- 路由文件：kebab-case，每模块一个文件（`inventory.ts`, `work-orders.ts`）
- Repository 端口：`I{Entity}Repository.ts`，实现：`Supabase{Entity}Repository.ts`，两者一一对应
- 依赖注入优先于直接 import 单例（见 §3.2）

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

> **2026-07-20 更新**：迁移脚本的权威版本与提交历史已迁到独立仓库
> [HiWmsSupabase](https://github.com/AaronLucas/HiWmsSupabase)（DBA 团队管理，与本仓库
> 无 git 关联），本仓库 `supabase/migrations/` 目录本身不再跟踪。命名约定仍适用于
> HiWmsSupabase 仓库内的迁移文件；实际已落地的文件用 `{NNN}_{short_description}.sql`
> 三位数序号（如 `001_enterprise_core_schema.sql`），而非本节示例的时间戳前缀——
> 这是既有实践与文档示例之间的历史差异，不在本次改动范围内一并修正。

### 5.2 表/列命名
- 表名：snake_case 复数（`products`, `work_orders`）
- 列名：snake_case（`tenant_id`, `created_at`, `sku_code`）
- 主键：`id` (uuid) 或 `id` (bigserial)
- 外键：`{table}_id`（`product_id`, `location_id`）

### 5.3 RLS 策略
- **所有表必须启用 RLS**
- 策略命名：`{table}_{action}_{role}`（`products_select_tenant_user`）
- 使用 `auth.jwt() ->> 'tenant_id'` 获取当前租户

### 5.4 命名约定补充（V2.1 Schema 对齐）

#### 5.4.1 状态字段
- 统一使用 `status` 列名，值为大写蛇形（`PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `EXCEPTION`）
- **必须**加 `CHECK` 约束（`chk_{table}_status`），允许值显式列出
- 禁止使用 `is_xxx` 布尔列代替状态机

#### 5.4.2 时间戳
- 创建时间：`created_at` (timestamptz, DEFAULT CURRENT_TIMESTAMP)
- 更新时间：`updated_at` (timestamptz, DEFAULT CURRENT_TIMESTAMP) —— **43 表全覆盖**（含 v2.2.0 新增的离线同步/异常领域表），由 `fn_update_updated_at()` 触发器维护
- **故意不加 `updated_at` 的表**（纯追加审计/关联表）：
  `inventory_history`, `wo_action_logs`, `wave_order_mapping`, `role_permissions`, `user_roles`, `permissions`, `inspection_items`, `vas_boms`, `vas_bom_items`, `shipping_documents`, `sync_events`, `exception_events`（后两者是纯追加型事件流水，同一设计约定）

#### 5.4.3 乐观锁
- 核心业务表（`inventory` 等）加 `version bigint DEFAULT 1`
- 更新前检查：`WHERE id = $1 AND version = $2` → `version = version + 1`
- 触发器 `trg_inventory_version_update` (BEFORE UPDATE) 自动维护

#### 5.4.4 版本化设计
- 需历史回溯的规则表（`verification_rules`, `billing_rules`）加：
  - `effective_from` (date, NOT NULL)
  - `effective_to` (date, NULL 表示当前生效)
- 唯一索引保证当前生效唯一：`uq_{table}_current` WHERE `effective_to IS NULL`

#### 5.4.5 UUID 固定值（Seed 数据）
- 系统级固定 UUID：`00000000-0000-0000-0000-000000000001` 等
- 租户级固定 UUID：`00000000-0000-0000-0000-000000000001` (Demo Tenant)
- 角色固定 UUID：SUPER_ADMIN=...0001, ADMIN=...0002, OPERATOR=...0003, INSPECTOR=...0004, PACKER=...0005, LOADER=...0006

#### 5.4.6 JSONB 结构规范
- `billing_strategy` (tenants)：
  ```json
  {
    "storage_stepped": [{min_days, max_days, rate, description, billing_cycle, prorated, min_charge, max_charge, currency, effective_date, expiry_date, escalation, discounts}],
    "currency": "USD"
  }
  ```
- `contact_info` (tenants)：`{email, phone, address}`
- `dims` (package_specs/locations/containers)：`{length, width, height}` (cm/m)
- `label_position` (package_specs)：`{x, y, rotation}`

#### 5.4.7 触发器命名
- `trg_{table}_{action}`：`trg_inventory_version_update`, `trg_inventory_history`, `trg_enforce_product_constraints`
- `trg_{table}_updated_at`：统一由 DO 块批量挂载 `fn_update_updated_at()`

#### 5.4.8 "全局默认 + 租户覆盖"并存字段（v2.2.0 新增约定，来自 `exception_type_catalog` 设计教训）
- 当某字段需要表达"可选按租户覆盖，否则回退全局默认"时（`tenant_id` 需要支持 NULL），**不要把该字段放进主键**——主键列隐含 `NOT NULL`，无法表达"全局默认"这个 NULL 语义。
- 正确做法：改用两条局部唯一索引分别约束"全局唯一"（`WHERE tenant_id IS NULL`）与"租户内唯一"（`WHERE tenant_id IS NOT NULL`），参照 `exception_type_catalog` 的 `uq_{table}_global` / `uq_{table}_tenant` 命名。
- 幂等锁/竞争性资源同理：用局部唯一索引表达"某状态下最多一条"（如 `task_claims` 的 `uq_task_claims_active` WHERE status='ACTIVE'），比应用层加锁更可靠，见 `task_claims` 设计（`DB_SCHEMA.md` §2.10）。

---

## 6. 测试规范

| 测试类型 | 目标覆盖率 | 工具 | 位置 |
|----------|------------|------|------|
| 单元测试 | ≥ 80% 核心逻辑 | Vitest | `src/__tests__/` 或就近 |
| 集成测试 | 关键流程 100% | Vitest + Supabase Local | `test/integration/` |
| E2E 测试 | 核心业务流程 | Playwright | `test/e2e/` |

- 测试文件命名：`{module}.test.ts`
- 使用 `describe`/`it` 结构化，命名用中文描述行为
- **测试结构（ECC 采纳，2026-07-18）**：遵循 Arrange-Act-Assert（准备-执行-断言）三段式，用注释显式标出三段边界
- **测试命名（ECC 采纳）**：用描述行为的完整语句，而非函数名缩写，例如"对已存在库存行的同一 (location, product, batch) 并发发起 5 个加/减请求时，最终库存等于串行执行的预期值"，不要写成"test adjust inventory"这类不描述具体行为的名字

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
`auth` | `inventory` | `orders` | `waves` | `work-orders` | `sorting` | `verification` | `packing` | `loading` | `replenishment` | `devices` | `reports` | `rbac` | `billing` | `workflow` | `db` | `ci` | `docker` | `k8s` | `sync`（离线同步：task_claims/sync_policies/sync_events/device_sync_state） | `exception`（统一异常领域）

### 示例
```
feat(inventory): add batch reservation API
fix(sorting): resolve chute assignment race condition
docs(api): update order allocation endpoint spec
refactor(workflow): extract task retry logic to base class
test(billing): add unit tests for tiered pricing
chore(deps): upgrade @supabase/supabase-js to v2.110
```

### PR 提交流程（ECC 采纳，2026-07-18）
详细操作步骤见 `docs/04-workflows/WORKFLOWS.md` §3.1，本节保留类型/scope 定义作为唯一事实来源，不重复维护流程细节。

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
- [ ] **涉及 `.sql` 文件的 PR，必须按 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 的 8 条自查清单逐条验证并在 PR 描述中附上证据（本地空库全跑一遍零 ERROR、字段名核对、并发测试、可空唯一索引处理等）；缺失证据的 PR 评审人有权直接打回，不需要先读代码细节**（2026-07-16 新增，源于 DBA 团队评审开发团队 PR 时发现的真实 bug：语法错误、字段名凭记忆写错、并发丢单、可空唯一索引失效等）
- [ ] 更新了相关文档（API_SPEC.md, DB_SCHEMA.md 等）
- [ ] **严重级别分级（ECC 采纳，2026-07-18）**：评审意见按 CRITICAL（安全漏洞/数据丢失风险，必须阻断合并）/ HIGH（bug 或显著质量问题，应修复后合并）/ MEDIUM（可维护性，建议修复）/ LOW（风格建议，可选）分级，定义见 `.claude/rules/ecc/common/code-review.md`；`ci.yml` 的 lint/test/build 门禁已从"允许失败"改为硬拦截（2026-07-18 起），CRITICAL/HIGH 级问题应在合并前解决，而非依赖人工记忆

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

## 10. 不可变性、文件组织与代码坏味道（ECC 采纳，2026-07-18）

> 来源：`.claude/rules/ecc/common/coding-style.md`。§2/§3.1-3.3（命名、SRP、依赖注入、租户隔离）是本项目专属约定，ECC 未覆盖，继续保留不变；本节是现状空白处的补充，映射依据见 `docs/06-agents/AGENTS.md` §8.3.1。

### 10.1 不可变性（强制）
- 始终创建新对象，不直接修改已有对象（尤其是函数参数、Redux/状态对象）
- 错误：`function updateUser(user) { user.name = newName; return user }`（原地修改）
- 正确：`function updateUser(user) { return { ...user, name: newName } }`（返回新副本）
- 理由：不可变数据避免隐藏的副作用，让调试更容易，也让并发场景更安全

### 10.2 文件行数上限
- 单文件典型 200-400 行，硬上限 800 行；超过时按职责拆分为多个小文件（高内聚低耦合），而不是继续往一个文件里堆

### 10.3 代码坏味道清单
- **深层嵌套**：超过 4 层缩进时改用提前返回（early return）
- **魔法数字**：有业务含义的阈值/延迟/上限用命名常量，不直接写字面量
- **长函数**：超过 50 行的函数拆分为职责更聚焦的小函数

## 11. 安全检查清单（ECC 采纳，2026-07-18）

> 来源：`.claude/rules/ecc/common/security.md` + `.claude/rules/ecc/typescript/security.md`。与 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md`（DBA 专属，聚焦 SQL/迁移安全）是并列关系，不互相替代——本清单是通用安全自检，DBA 清单是数据库变更专属自检，两者都要过。

提交前必查：
- [ ] 无硬编码密钥/密码/Token（改用环境变量：`process.env.API_KEY`，缺失时启动即抛错，不使用静默默认值兜底）
- [ ] 所有用户输入已校验（Zod schema，见 §12.2）
- [ ] 数据库查询使用参数化查询，无字符串拼接 SQL
- [ ] 渲染用户输入的地方已做 XSS 防护（转义/净化）
- [ ] 鉴权/授权逻辑已验证（路由是否漏掉权限检查）
- [ ] 错误信息不泄露内部实现细节（堆栈、SQL 语句、内部路径）

安全响应流程：发现安全问题 → 立即停止 → 用 `security-reviewer` agent 复查 → 修复 CRITICAL 级问题后才能继续 → 若密钥已泄露需轮换 → 检查代码库中是否有同类问题。

## 12. TypeScript 类型设计补充（ECC 采纳，2026-07-18）

> 来源：`.claude/rules/ecc/typescript/coding-style.md`。§3.5（禁用 `any`、类型安全）继续保留，本节补充现状未覆盖的细则。

### 12.1 interface 与 type 的选择
- 可能被扩展/实现的对象形状（如 Repository、Service 接口）用 `interface`
- 联合类型、交叉类型、元组、映射类型用 `type`
- 字符串字面量联合优先于 `enum`，除非需要与外部系统互操作

### 12.2 Zod 校验（强制）
- 所有系统边界的输入（HTTP 请求体、外部 API 响应、用户上传文件）必须用 Zod schema 校验，类型用 `z.infer<typeof schema>` 推导，不手写重复的 interface

```typescript
const userSchema = z.object({ email: z.string().email() })
type UserInput = z.infer<typeof userSchema>
const validated: UserInput = userSchema.parse(input)
```

## 13. 开发前调研复用（ECC 采纳，2026-07-18）

> 来源：`.claude/rules/ecc/common/development-workflow.md`。现状完全空白，直接采纳。

编写新实现前（尤其是新工具函数、新集成、新算法）：
1. 先用 `gh search repos` / `gh search code` 找项目内或开源生态里是否已有可复用的实现或范式
2. 查 npm/PyPI 等包注册表，优先用经过实战检验的库而非手写工具函数
3. 库版本相关的行为以官方文档/Context7 为准，不凭记忆假设 API 签名
4. 找到能覆盖 80% 需求的现成实现时，优先移植/包装，而不是从零重写

---

*本文档随项目演进持续更新。重大规范变更需团队评审通过。*

*2026-07-15：同步 ADR-011（离线同步操作日志 + 统一异常领域）——更新 §1 目录结构约定为六边形架构实际拓扑，§5.4.2 updated_at 覆盖范围，§5.4.8 新增"全局默认+租户覆盖"字段设计约定，§7 Git scope 补充 `sync`/`exception`。*

*2026-07-18：ECC 治理试点第 4 项（转正）——按 `docs/06-agents/AGENTS.md` §8.3.1 映射表，新增 §10-§13 吸收 ECC 规则中现状空白的条目（不可变性/文件组织/代码坏味道、安全检查清单、TS 类型设计补充、开发前调研复用），§6/§7/§8 追加对 ECC 规则的引用（不重复维护定义）。*
