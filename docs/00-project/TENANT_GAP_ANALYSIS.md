# 租户端业务功能完整性审计

> **日期**: 2026-08-02  
> **审计方法**: ECC multi-agent 双维度分析（architect 行业对标 + planner 功能评分+路线图）  
> **对比基线**: Blue Yonder/JDA、Manhattan Associates、SAP EWM、Oracle WMS、富勒 FLUX WMS、通天晓 TTX  
> **数据源**: DB_SCHEMA.md v2.9.0、API_SPEC.md v2.1.0、ARCHITECTURE.md v2.4.0、ROADMAP.md、BACKEND_GAP_ANALYSIS.md

---

## 1. 核心结论：倒金字塔结构

```
数据库层    ████████████████████████████████  53 表 + 44 RPC  (~85%)
仓储层      ████████████████████████████████  44 适配器      (~98%)
UseCase 层  ██████                             6 个           (~25%)
Tenant API  ██                                 7 端点         (~8%)
Device API  ████████████████                  17 端点         (~57%)
Admin API   ░                                  0 路由         (~0%)
```

**根本问题**：数据库和仓储层建设超前，但应用层（UseCase + API）严重滞后。44 个 Repository 适配器已全部实现，数据读写能力就绪，但通过 API 暴露的不足 10%。

**这不是设计缺陷——`API_SPEC.md` 已经规划了 15 个域 200+ 端点，是实施进度问题。**

---

## 2. 18 个 WMS 核心流程：逐项评分

| # | 业务流程 | 评分 | DB | Repo | UseCase | Tenant API | Device API | 严重度 |
|---|---------|------|-----|------|---------|-----------|------------|--------|
| 1 | 入库/收货 | 1.5/5 | ✅ | ✅ | ❌ | ❌ 0/10 | 🟡 1 端点 | **CRITICAL** |
| 2 | 上架 | 1.5/5 | ✅ | ✅ | ❌ | ❌ 0 | ✅ sync_events | **CRITICAL** |
| 3 | 库存管理 | 2.5/5 | ✅ | ✅ | 🟡 1 stub | 🟡 2/13（只读） | 🟡 count | **CRITICAL** |
| 4 | 订单管理 | 3.5/5 | ✅ | ✅ | ✅ 2 impl | ✅ 4/4 | ❌ | MEDIUM |
| 5 | 波次管理 | 2.0/5 | ✅ | ✅ | 🟡 1 impl | 🟡 2/6 | ❌ | **HIGH** |
| 6 | 拣货作业 | 1.5/5 | ✅ | ✅ | ❌ | ❌ 0/2 | ❌ 0 direct | **CRITICAL** |
| 7 | 二次分拣 | 1.5/5 | ✅ | ✅ | ❌ | ❌ 0/3 | ❌ 0 direct | **HIGH** |
| 8 | 打包作业 | 2.0/5 | ✅ | ✅ | ❌ | ❌ 0/4 | 🟡 1 sync | **HIGH** |
| 9 | 发货管理 | 1.0/5 | ✅ | ✅ | ❌ | ❌ 0/5 | ❌ | **CRITICAL** |
| 10 | 越库/直通 | 1.5/5 | ✅ | ✅ | ❌ | ❌ 0/6 | ❌ | **HIGH** |
| 11 | 补货管理 | 1.0/5 | 🟡 Partial | 🟡 Partial | ❌ | ❌ 0/5 | ❌ | **HIGH** |
| 12 | 退货/逆向 | 0/5 | ❌ **不存在** | ❌ | ❌ | ❌ | ❌ | **HIGH** |
| 13 | 质检管理 | 1.5/5 | ✅ | ✅ | ❌ | ❌ 0/5 | ❌ | **HIGH** |
| 14 | 增值服务 | 1.0/5 | ✅ | ✅ | ❌ | ❌ | ❌ | LOW |
| 15 | 计费管理 | 2.0/5 | ✅ | ✅ | 🟡 1 stub | ❌ 0/4 | ❌ | MEDIUM |
| 16 | 报表分析 | 1.0/5 | ✅ Views | ✅ Partial | ❌ | ❌ 0/6 | ❌ | MEDIUM |
| 17 | 快递/面单 | 1.0/5 | ✅ | ✅ | ❌ | ❌（规划在 Edge） | ❌ | MEDIUM |
| 18 | 库位/容器 | 1.0/5 | ✅ | ✅ | ❌ | ❌ ~17 端点全空 | ❌ | **HIGH** |

**加权平均分：1.28/5.0（~26%）**

---

## 3. 用户角色能力矩阵

| 角色 | 今天能做什么 | 今天不能做什么 | 覆盖率 |
|------|------------|--------------|--------|
| **仓库经理** | 查订单/库存/商品，创建订单，生成波次 | 管理入库/出库全流程，派发工单，看报表，管设备 | **10%** |
| **入库操作员** | PDA 上架、处理无码/未识别货物 | 查看 ASN，确认收货，录质检，得上架指引 | **15%** |
| **拣货员** | 领用任务（PDA） | 按步骤扫码拣货，缺货上报异常，查看进度，推荐下一任务 | **10%** |
| **打包员** | 批量提交打包动作（sync_events） | 交互式扫箱→加品→封箱，重量校验，面单打印 | **15%** |
| **发货员** | 无 | 一切——零发货端点 | **0%** |
| **质检员** | 无 | 查看质检任务，录入结果，处理不合格品（REJECT/QUARANTINE） | **0%** |
| **库存管理员** | 查库存列表和明细 | 调整/移库/预留/锁定/盘点/补货/库龄分析 | **10%** |
| **租户管理员** | 几乎无 | 配置库位/容器/设备，管理用户角色，看报表 | **6%** |

---

## 4. Top 10 致命缺口（按业务影响排序）

| 排名 | 缺口 | 影响 | 用户侧表现 |
|------|------|------|-----------|
| **1** | 入库收货 Tenant API | 阻塞 | 整个正向物流链路无起点——不能创建 ASN、不能确认收货、不能触发质检上架 |
| **2** | 拣货交互式 PDA 流 | 阻塞 | 没有 scan-location→scan-product→confirm-qty 三步确认，只能通过泛化 sync_events |
| **3** | 发货全链路 | 阻塞 | 打包完的货出不去——无承运商分配、无面单打印、无交接、无装车 |
| **4** | 库位/容器管理 | 严重 | 租户入驻第一步就是配置仓库布局——当前需要 DBA 直接操作数据库 |
| **5** | 库存写操作 | 严重 | 13 个规划端点只实现了 2 个只读——不能调整/移库/预留/锁定 |
| **6** | 波次释放→工单生成断裂 | 严重 | `ReleaseWaveUseCase` 返回空 `workOrderIds: []` |
| **7** | 退货/逆向物流 | 严重 | 整个域不存在——数据库都没建表，电商 10-30% 退货率无系统支撑 |
| **8** | 质检管理 | HIGH | 收货后不能触发质检、不能录入结果 |
| **9** | 补货管理 | HIGH | `v_replenishment_needs` 视图存在但无管理端点——靠人工巡逻 |
| **10** | 装车/运输 | HIGH | 不能登记车辆、不能创建装车任务、不能确认发运 |

---

## 5. 架构建议：Device API vs Tenant API 职责划分

**结论：保持现有分离，不做端点复制，但要补齐各自的盲区。**

| 层 | 职责 | 当前状态 |
|----|------|---------|
| **Tenant API** | 流程编排 + 进度监控 + 异常复核 + 主数据管理 | 🔴 极薄，盲区巨大 |
| **Device API** | 扫码/称重/GPS/离线同步——执行层 | 🟡 覆盖尚可，缺拣货交互流 |

**两个 API 都应该有的端点**：状态变更确认（收货确认、交接确认）、进度查询。共享底层 RPC + DB 触发器保证一致性，**绝不走 API-to-API HTTP 调用**。

**只应在一侧的端点**：硬件交互（扫码、称重）仅 Device API；流程编排（创建单据、生成波次、派发任务）、主数据管理仅 Tenant API。

---

## 6. 推荐 Sprint 实施路线

### Sprint 4：出库闭环（订单→波次→工单→发货）🟡 5-6 天
- 订单状态更新、波次详情/订单管理/状态/释放
- 工单 CRUD、派发、操作日志
- 发货单 CRUD、交接承运商
- 车辆登记/列表
- **新增 UseCase**: `AssignWorkOrderUseCase`, `HandoverShippingUseCase`, `UpdateOrderStatusUseCase`, `ReleaseWaveUseCase`（修复）

### Sprint 5：入库全链路（ASN→收货→质检→上架）✅ Tenant API 部分已完成（2026-08-03），DBA 决策问题已落地（2026-08-08）
- ✅ 入库单 CRUD+状态更新+收货+上架触发（14 个新端点，含 ASN 3 个 + 入库单 6 个 + 质检单 5 个）
- ✅ ASN 创建/列表/详情
- ✅ 质检单 CRUD+明细项录入+结果录入（完成质检并入结果录入，PASS/REJECT/QUARANTINE/REWORK 均为终态）
- ✅ **入库单明细行（inspection_items）已接入**：DBA 决策 Issue [HiWmsSupabase#64](https://github.com/AaronLucas/HiWmsSupabase/issues/64) 已关闭，方案为在 `quality_inspections` 表加 `receipt_id` 外键 + 复合索引（PR #65 已合并）。应用层同步修复：`src/types/database.ts` 添加字段及外键关系；`SupabaseInboundReceiptRepository.ts` 两跳查询重写（`findWithItems()`/`getInspectionSummary()` 改为先查 `quality_inspections.receipt_id` 再查 `inspection_items.inspection_id`），TypeScript 编译通过、单元测试 85 passed。
- ⏳ Device API 补充收货/质检端点——未做，留待后续
- ✅ **新增 UseCase**: `ReceiveInboundReceiptUseCase`, `GeneratePutawayWorkOrderUseCase`, `RecordInspectionResultUseCase`

### Sprint 6：库存操作 + 主数据（库位/容器/商品写）🟡 4-5 天
- 库存调整/移库/预留/锁定/历史/可用量
- 库位 CRUD+状态/容量/利用率/按区查询
- 容器 CRUD+封箱/移动/内容物/层级树/LPN 查询
- 商品写操作 CRUD+条码+约束+ABC分类
- **新增 UseCase**: `AdjustInventoryUseCase`, `TransferInventoryUseCase`, `MoveContainerUseCase`

### Sprint 7：执行增强（拣货/打包/分拣/异常/越库）🟡 4-5 天
- 拣货任务列表+确认、打包任务完整流、分拣任务+滑道分配
- 装车任务+确认
- 异常登记/查看/解决
- 越库 CRUD+匹配+暂存+发货
- Device API 补充拣货三步确认流
- **新增 UseCase**: `ConfirmPickUseCase`, `StartPackUseCase`, `CompletePackUseCase`, `ExecuteSortUseCase`, `ResolveExceptionUseCase`

### Sprint 8：计费+报表+设备+面单 🟡 3-4 天
- 计费规则/交易记录
- 库龄分析/周转率/空间利用率/老板驾驶舱
- 设备列表/详情/状态
- 面单模板管理
- **新增 UseCase**: `GetBillingTransactionsUseCase`, `GenerateInventoryAgingReportUseCase`

### 后续 Sprint（需先完成设计）
- **退货/逆向物流**：需新建 RMA 表+退货单表+退货质检规则——先做 ADR + DB Schema 设计
- **补货管理**：需补充 `replenishment_rules` 表+仓储——先做 DB 设计
- **Edge Worker 面单打印**：ZPL/PDF 生成

---

## 7. 前置风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| ~~ADR-015 auth bridge DB 侧触发器仍未落地~~ | ~~新 Tenant API 端点 RLS 可能不生效~~ | ✅ 已落地（2026-08-01 复核确认） |
| ~~`authToken` 未贯通到 Repository 业务方法~~ | ~~可能绕过 RLS~~ | ✅ 已贯通（Sprint 4.10，2026-08-02，所有业务方法补齐 `authToken` 参数） |
| Repository Phase 2 仓库无测试 | 8 个 P0 仓库行为未验证 | Sprint 3 测试补齐（已有 PR #58 基础） |
| 退货域需全新设计 | 不能直接写代码 | 先出 ADR + DB Schema，再开工 |

---

## 8. 关键数据摘要

| 指标 | 数值 |
|------|------|
| 数据库表 | 53+ |
| RPC 函数 | 30+ |
| Repository 端口 | 45 |
| Repository 适配器 | 44 |
| UseCase 实现 | 6 |
| Tenant API 已实现端点 | 7（API_SPEC 规划 200+） |
| Device API 已实现端点 | 17 |
| Admin API 已实现路由 | 0 |
| WMS 核心流程平均成熟度 | 1.28/5.0 |
| 整体应用层完成度 | ~20% |

---

*分析执行者：ecc:architect + ecc:planner*
*本次分析关联文档：ROADMAP.md、API_SPEC.md、ARCHITECTURE.md、BACKEND_GAP_ANALYSIS.md、DB_SCHEMA.md*
