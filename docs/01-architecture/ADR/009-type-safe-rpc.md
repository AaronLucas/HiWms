# ADR-009: 类型安全 RPC 从数据库类型推导

## 状态
✅ Accepted (2026-07-09)

## 背景
Supabase Edge Functions（RPC）是核心业务逻辑承载层（库存分配、重量校验、交叉理货、滑道分配、计费规则等）。历史痛点：
- RPC 参数/返回类型在 TypeScript 侧手写，易与数据库函数签名漂移
- 修改数据库函数后，TypeScript 调用端编译通过但运行时失败
- 无单一事实来源，文档与代码不同步
- IDE 无法提供参数提示、重构支持

## 决策
建立 **数据库 → TypeScript 端到端类型推导链路**：

```
supabase/migrations/*.sql
        ↓  (supabase gen types typescript --local > src/types/database.ts)
src/types/database.ts  ← 唯一事实来源：包含 Tables、Functions、Enums、Composite Types
        ↓
src/core/ports/rpc/*.ts  ← 手动映射 Functions 接口为端口（IRpcClient 聚合）
        ↓
src/adapters/supabase/rpc/SupabaseRpcClient.ts  ← 实现端口，编译期类型检查
```

### 关键约定
1. **database.ts 为源头**：所有 RPC 类型源自 `database.ts` 的 `Functions` 接口
2. **端口手动映射**：`ports/rpc/IStockAllocationRpc.ts` 显式引用 `database.ts` 类型：
   ```typescript
   import type { Functions } from '../../types/database'
   
   export interface IStockAllocationRpc {
     allocate(params: Functions['fn_allocate_stock']['Args']): Promise<Functions['fn_allocate_stock']['Returns']>
   }
   ```
3. **实现类编译期验证**：`SupabaseRpcClient` 实现 `IRpcClient`，TS 编译器强制参数/返回匹配
4. **CI 门禁**：`npm run typecheck` (tsc --noEmit) 必须通过，任何签名不匹配即阻断

### RPC 函数列表（12 个核心 + 5 维护）
| 数据库函数 | Edge Function 路径 | 端口接口 | 用途 |
|------------|-------------------|----------|------|
| `fn_allocate_stock` | `/fn_logic_stock_allocation` | `IStockAllocationRpc` | 库存分配（乐观锁） |
| `fn_process_blackbox_receipt` | `/fn_logic_blackbox_receiving` | `IBlackboxReceivingRpc` | 黑盒收货解析 |
| `fn_match_cross_dock` | `/fn_match_cross_dock` | `ICrossDockRpc` | 交叉理货匹配 |
| `fn_allocate_chute` | `/fn_allocate_chute` | `IChuteAllocationRpc` | 滑道分配 |
| `fn_verify_weight` | `/fn_verify_weight` | `IWeightVerificationRpc` | 重量校验 |
| `fn_get_active_billing_rule` | `/fn_get_active_billing_rule` | `IBillingRuleRpc` | 计费规则查询 |
| `check_user_permission` | `/check_user_permission` | `IPermissionCheckRpc` | RBAC 权限检查 |
| `fn_current_tenant_id` | `/fn_current_tenant_id` | `ICurrentTenantRpc` | 获取当前租户 ID |
| `fn_adjust_inventory` | `/fn_adjust_inventory` | `IInventoryAdjustRpc` | 库存调整 |
| `fn_sync_inventory` | `/fn_sync_inventory` | `IInventorySyncRpc` | 库存同步 |
| `fn_check_replenishment_needed` | `/fn_check_replenishment_needed` | `IInventoryAdjustRpc` | 补货需求检查 |
| `fn_handle_cross_dock_timeout` | `/fn_handle_cross_dock_timeout` | `ICrossDockTimeoutRpc` | 交叉理货超时处理 |
| `fn_purge_old_logs` | `/fn_purge_old_logs` | `IPurgeOldLogsRpc` | 旧日志清理 |

## 后果

### 正面
- **零运行时类型错误**：数据库函数签名变更 → `database.ts` 更新 → TS 编译报错 → 开发期发现
- **IDE 全程智能提示**：参数名、类型、必填字段全部已知
- **重构安全**：重命名数据库函数参数，TS 追踪所有调用点
- **文档即代码**：`database.ts` 是永远同步的活文档

### 负面
- 需维护 `supabase gen types` 工作流（本地开发、CI、部署前）
- 新增 RPC 函数需：SQL 迁移 → 生成 types → 手动添加端口映射 → 实现适配器（约 10 分钟流程）
- `database.ts` 文件较大（~2000 行），需配置 `skipLibCheck` 避免类型检查过慢

## 实施细节
- `package.json` scripts:
  ```json
  "gen:types": "supabase gen types typescript --local > src/types/database.ts",
  "typecheck": "tsc --noEmit"
  ```
- CI 流水线包含 `gen:types` → `typecheck` 步骤
- 预提交钩子运行 `typecheck`（快速模式仅检查变更文件）

## 相关文档
- `ARCHITECTURE.md` — 类型安全 RPC 架构图、代码示例
- `API_SPEC.md` — 12 个 RPC 端点完整参数/返回定义
- `DB_SCHEMA.md` — 17 个核心 RPC 函数签名表
- `src/types/database.ts` — 生成的类型文件（Git 忽略，CI 生成）
- `src/core/ports/rpc/` — 12 个端口接口文件
- `src/adapters/supabase/rpc/SupabaseRpcClient.ts` — 统一实现

---

*决策者：主工程师 | 评审：架构组 | 生效日期：2026-07-09*