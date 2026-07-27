# 后端缺口全面审计报告

> **日期**: 2026-07-27  
> **审计范围**: wms7 项目全部后端代码、数据库 schema、Repository 层、API 层、Use Case 层  
> **审计方法**: ECC multi-agent 全仓库扫描  
> **基线**: ROADMAP.md v2.8.0、REPOSITORY_ROADMAP.md Phase 1-8

---

## 1. 总体完成度

| 层 | 完成度 | 状态 |
|----|--------|------|
| 数据库 Schema + 迁移 | 100% | ✅ 23 个迁移全部部署 |
| 数据库 RPC 函数 | 100% | ✅ 30+ 函数全部就绪 |
| Repository 端口 | 100% | ✅ 45 接口已定义 |
| Repository Phase 1/3/4/5/6/7 | 100% | ✅ 含并发测试证据 |
| Repository Phase 8 | 60% | 🔶 已实现，集成测试不足 |
| **Repository Phase 2** | **~95%** | ✅ 8 个 P0 仓库均已实现且已接线 DI；2026-07-27 已为 7 个仓库补齐并发集成测试（`RUN_DB_CONCURRENCY_TESTS=true` 下 98 passed/1 skipped），过程中额外发现并修复约 40 处状态字面量系统性 bug（见 REPOSITORY_ROADMAP.md「Sprint 1 附带发现」），剩余 3 处结构性/语义未决项见同节 |
| Device API | 95% | ✅ 17 端点 |
| Admin API | 30% | 🔶 基础 CRUD |
| **Tenant API** | **0%** | 🔴 目录不存在 |
| Use Case 层 | 15% | 🔶 6 个 stub |
| **Auth Identity Bridge (ADR-015)** | **10%** | 🔴 设计完成，零代码 |
| Device Identity (ADR-019) | 90% | 🟡 缺 HTTP 集成测试 |
| Workflow Engine (ADR-008) | 0% | 🔴 空目录 |
| Edge Worker | 0% | 🔴 不存在 |
| 外部适配器 | 0% | 🔴 只有端口 |

**后端总体: ~55%**（2026-07-27 更正 Repository Phase 2 评估后，实际完成度略高于本次审计原估算，具体见 §2.2）

---

## 2. 🔴 CRITICAL: 阻塞一切的三个问题

### 2.1 RLS 租户隔离从未生效（ADR-015）

`public.users` 和 Supabase Auth `auth.users` 无触发器同步。`fn_current_tenant_id()` 在所有业务查询中返回 NULL。`ExpressMiddlewareFactory.injectRlsContext()` 设值但 `SupabaseBaseRepository.getClient()` 返回单例 anon client，不是 per-request。所有 authenticated 角色的 RLS 策略从未被触发。

### 2.2 Repository Phase 2 测试覆盖零进度（原「零进度」结论已更正，2026-07-27）

**更正说明**：本节原描述"8 个 P0 仓库端口无实现"经 2026-07-27 复核**不成立**——`SupabaseTenantRepository`、`SupabaseProductRepository`、`SupabaseProductConstraintRepository`、`SupabaseInventoryRepository`、`SupabaseOrderRepository`、`SupabaseWorkOrderRepository`、`SupabaseSortingChuteRepository` 均已完整实现（37-165 行不等），方法签名与对应端口接口逐一比对完全吻合（`SupabaseProductRepository` 甚至多实现了 `findWithConstraints`/`updateAbcClass` 两个方法），且均已在 `src/adapters/supabase/index.ts`/`repositories/index.ts` 正确导出并接入 DI 容器。本次审计（PR #55）未做实际代码核查就下了"0%/未开始"结论，属于误判，特此更正。

**真实缺口**：这 7 个仓库**完全没有测试**（`src/__tests__/` 下零匹配），不符合 Phase 5/6/7 仓库"含并发测试证据"的既有标准。Admin API 通过 service_role 绕过 Repository 层直接查表的技术债描述不变。

### 2.3 Tenant API 不存在

`src/apps/tenant-api/` 目录不存在。前端唯一能调的后端入口缺失。

---

## 3. 🟡 HIGH 级问题

- Use Case 层 6 个 stub 文件，核心业务流程（订单→库存→波次→工单）无实现
- Device API auth 端点缺 HTTP 集成测试
- Phase 8 仓库测试覆盖不足
- DBA Addendum: 4 个函数可绕过 dispatcher 直接调用
- `fn_expire_task_claims` 未注册 pg_cron
- permissions 种子数据缺 7 个 exception 资源

---

## 4. 阻塞链

```
ADR-015 身份桥接
  ├─ 阻塞 → Tenant API
  ├─ 阻塞 → 前端登录
  └─ 阻塞 → Phase 2 RLS 测试

Repository Phase 2
  ├─ 阻塞 → Tenant API
  └─ 阻塞 → Use Case 扩展

Tenant API
  └─ 阻塞 → 前端 Phase 2
```

---

*与 ROADMAP.md、REPOSITORY_ROADMAP.md、ECC_EXECUTION_PLAN.md 联动维护。*
