# WMS7 独立项目健康度诊断 V1

> 日期：2026-09-05
> 方法论：5 个独立视角子会话（架构/安全/数据库/业务规划/测试），**各自从项目源头
> （代码库全量 + WMS7 全部产品文档 + DBA 独立仓库 HiWmsSupabase 全部 45 个迁移与
> 设计文档）直接探索，互不知道彼此存在，不共享任何预设结论或分类框架**。
>
> **本文档取代 `DBA_SYNC_GAP_ANALYSIS_AND_UPGRADE_PLAN_V1.md` 作为当前的权威诊断**。
> 那份文档的方法论缺陷：先由单人（本会话）写出 Track A-1/A-2/B 三分框架，再让 5 个
> agent"评审"这份框架——即使评审很努力（也确实挑出了草稿里的致命错误），agent 的
> 视野仍被框架边界锁定。本次重做后，5 个独立诊断分别发现了框架外的、量级更大的
> 问题（两个真实可触发的 CRITICAL 安全漏洞、一个从未被任何客户端调用过的后端、
> 一套设计上就不会拦截问题的 CI），证实了这个方法论顾虑是对的。
>
> **交叉验证说明**：下文标注"[N 个独立视角交叉验证]"的条目，是不同 agent 用不同
> 方法各自独立发现、结论一致的问题——这是本文档里置信度最高的部分。未标注的是
> 单一视角独家发现，同样附有具体证据，但范围/影响面评估相对单一视角。

---

## 0. 执行摘要

**这不是一个"应用层需要追赶 DBA 交付"的项目状态，而是一个更根本的状况**：

1. WMS7 用"作业可闭环度"标尺衡量，**没有任何业务能力越过 L2（有服务端接口但无
   人机界面）**——约 100 个 HTTP 端点，0 个界面，0 个真实用户，0 个部署产物。
2. 存在至少 **2 个真实的、当前代码库里就能复现的 CRITICAL 级跨租户安全漏洞**
   （非理论风险），影响面从"单条记录泄露"到"平台全部租户数据可被任意篡改"。
3. 核心业务链路（PDA 离线同步：拣货/上架/盘点/打包/异常处理）**很可能已经静默
   失效**，[3 个独立视角用 3 种不同方法交叉验证]：代码路径分析、实际连库/跑测试、
   CI 配置审计，结论一致。
4. 这一切之所以没有被发现，是因为**测试体系与 CI 设计上就不会因此报红**：80% 的
   测试文件默认被跳过，覆盖率报告显示的是 ~11%（而非文档承诺的 80%），且没有任何
   阈值会让 CI 失败。
5. 类型系统（`database.ts`）落后于数据库真实 schema **25% 的表、58% 的业务函数**
   [2 个独立视角交叉验证]，这不是一次性疏漏，是一个持续性的流程断点，且断点位置
   与"应用层零对接"的范围高度重叠——即从这个时间点起，DBA 交付的一切对应用层都
   变得"编译不出、只能用 `as any` 强行绕过"。
6. 计费系统自项目第一个迁移起 44 个迁移**零演进**，`CalculateStorageFeeUseCase`
   全仓库零调用方——3PL 唯一的收入凭据和续约抓手端到端不存在。
7. **需求来源本身是倒置的**：项目"业务需求与功能规格说明书"自称是"反推版——从
   历史 SQL 脚本逆向整理而来"，没有客户、没有试点、没有一线访谈。这是几乎所有
   其他症状的根因，但至今没有任何文档把它列为风险项。

---

## 1. CRITICAL 级安全问题（真实可触发，需要最优先处理）

### 1.1 admin-api 把"租户内系统账号"标志误判为"平台超级管理员"（安全维度独家发现）

**影响面：平台全部租户的全部数据（读取+篡改），含跨租户密码重置**

- 数据库侧 `is_system_user` 是**租户内**标志（用于识别历史遗留的租户管理员账号，
  五次独立的 DBA 迁移 024/029/039/042/043 都在处理这个真实存在的历史数据模式）。
  数据库真正的"平台管理员"概念是 `fn_is_platform_admin()`，且**只授予 `postgres`/
  `service_role` 执行权限**——DBA 一侧的定义精确、受控。
- 应用层 `SupabaseTenantResolver.isPlatformAdmin()`（`src/adapters/supabase/auth/
  SupabaseTenantResolver.ts:164-165`）完全不调用这个真正的判断，而是直接写
  `is_system_user === true || role === 'platform_admin'`。
- 这个错误判断决定了**整个 admin-api** 的登录准入（`src/apps/admin-api/routes.ts:38`）
  与默认 compat 模式下**全部受保护路由**的唯一门禁（`routes.ts:59-65`，条件是
  `req.context?.user?.isSystemUser`）。admin-api 的数据操作全部走 service_role
  （`getAdminClient()`），**完全不受 RLS 约束**。
- **代码自证**：`ExpressMiddlewareFactory.ts:125-127`（ADR-016 注释）明确记录
  tenant-api 已经把这个错误做法改掉了，理由正是"`is_system_user` 语义是租户内
  账号，不该被当平台超管"——但 admin-api 完全没跟着修，**同一份代码库内两套
  自相矛盾的标准并存至今**。

**关联问题（同一根因，HIGH）**：`SupabaseTenantResolver.resolveFromUser()` 与
`validateTenantOwnership()` 在 tenant-api 侧同样把 `is_system_user` 当平台级豁免；
目前之所以没有直接造成数据泄露，是因为 RLS 仍是实际生效的边界，但这意味着
`routes.ts` 里大量"应用层第二道防线"检查（如 `routes.ts:184/219/265/301`）对这类
账号**形同虚设**——是脆弱的单点防线伪装成双层防御。

### 1.2 `POST /api/containers` 创建的容器落入跨租户读写漏洞（架构维度独家发现）

**影响面：单条容器记录的跨租户可见/可篡改（比 1.1 影响面小，但是当前正常业务
流程就能触发，不需要任何特殊权限）**

三段证据链：
1. `src/apps/tenant-api/routes.ts:1052-1062` 构造容器插入时没有写入 `tenant_id`。
2. 根因：`src/types/database.ts` 里 `containers.Insert` 类型没有 `tenant_id`
   字段（该列是 DBA 迁移 036 加的，类型生成停在迁移 026——见第 3 节）。
3. DBA 迁移 036 的四条 RLS 策略全部是 `tenant_id = fn_current_tenant_id() OR
   tenant_id IS NULL`（NULL 分支设计初衷是"全新未被使用的共享池容器"，语义
   本身自洽，问题出在应用层把"租户作用域的创建动作"错误映射成了共享池写入）。

**后果**：该 INSERT 成功落库为 NULL 租户；任意其他租户的已认证用户可以
SELECT/UPDATE/DELETE 这条记录；同时功能本身也是断的——创建方自己用
`findByTenant()` 查询时反而查不到刚创建的容器（创建即失联）。

### 1.3 device-api 的凭证兑换端点全仓库唯一没有速率限制（安全维度独家发现，HIGH）

`/device/auth/login`（API Key 换 token）与 `/device/auth/refresh`——三个 API 面里
唯一支持"长期共享密钥"认证方式、理应是节流优先级最高的入口，全仓库搜索未发现
任何 `rateLimit()` 调用。可被离线暴力破解 `secret`。

### 1.4 一处可被普通租户用户触发的 DoS（架构维度独家发现，HIGH）

`SupabaseContainerRepository.getHierarchy()` 调用一个数据库里不存在的 RPC
（`get_container_hierarchy`），失败后 catch 回退到 **无深度限制** 的 N+1 递归查询
（`.ts:185-207`，`max_depth: 20` 只存在于永远走不到的 RPC 分支里）。`PATCH
/api/containers/:id/move` 不做环检测，构造 A.parent=B、B.parent=A 后调用
`GET /containers/:id/hierarchy` 即可导致无限递归、进程栈溢出。

---

## 2. 核心业务链路疑似失效 [3 个独立视角交叉验证]

**结论（中高置信度，需 DBA/后端负责人共同核实确认，非单方面定论）**：PDA 离线
同步（拣货/上架/盘点/打包/异常处理）这一整条链路，在当前代码下可能已经在
"什么都不做"。

**三种独立方法收敛到同一结论**：

1. **架构维度**（代码路径分析）：device-api 用完全独立的设备凭证体系（自签
   HS256，与 Supabase 项目 JWT 密钥无关），`req.context` 里没有 `supabaseToken`
   字段；`SupabaseSyncEventRepository`/`SupabaseExceptionRepository` 调用 RPC
   时用的是全局 service_role client，DBA 迁移 042 的安全加固要求
   `tenant_id = fn_current_tenant_id()`（JWT 驱动），裸调用时该函数返回 NULL。
2. **安全维度**（同一发现，从"条件式防护绕过"角度）：`check_user_permission`
   的跨租户检查是条件式的（`IF v_caller_tenant_id IS NOT NULL THEN`），device-api
   裸调用时这段防护整段被跳过。
3. **测试维度**（实际连库验证 + 跑测试，独立于前两者的方法）：直接对一条全新
   `PENDING` sync_event 用无会话上下文调用 `fn_apply_sync_event`，返回
   `SKIPPED_NOT_PENDING`，事件状态原地未变；仓库自带的
   `fn_apply_sync_event.concurrency.test.ts`（走生产同样代码路径）14 个用例
   9 个失败；`fn_resolve_exception.concurrency.test.ts` 3/7 直接抛出
   `RpcError: 必须通过已认证会话调用`。数据库里引用同一守卫函数
   （`fn_current_tenant_id()`）的函数共 **22 个**，风险面可能不止这两个。

**为什么这个问题活到了今天**：`fn_apply_sync_event` 的静默失败模式（不抛错、
不登记异常，只返回一个看起来正常的字符串）比 `fn_resolve_exception` 的硬失败
（抛异常）更危险——调用方容易把它当成"已被别的 worker 处理过"的正常情况。
且能揪出这个问题的测试文件（`fn_apply_sync_event.concurrency.test.ts`）写得
很好、有真实历史 bug 记录和回归防护注释，但被 `describe.skipIf` 挡在默认
`npm run test` 之外（见第 4 节），CI 里唯一会运行它的 workflow 又明确"未加入
硬门禁"。**这条链路即便已经坏了，也不会阻止任何 PR 合并。**

---

## 3. 类型系统与 DBA 对接现状 [2 个独立视角交叉验证，数据库维度给出精确量化]

### 3.1 `src/types/database.ts` 落后的精确范围（数据库维度独立核实）

以运行中的真实数据库为唯一真相源（`docker exec` 直接查询 `information_schema`/
`pg_proc`，不依赖任何文档）：

- **真实 76 张基表，`database.ts` 只有 57 张，缺失 19 张（25%）**
- **真实 82 个非触发器业务函数，`database.ts` 只覆盖约 33 个，缺失约 48 个（58%）**
- 缺失范围与"应用层零对接的表"（见 3.2）**高度重叠**，说明类型生成流程没有
  跟上 DBA 迁移节奏，是持续性流程断点，不是一次性疏漏。断点起点是迁移 026
  之后（架构维度、数据库维度两个独立核实的结论一致）。
- 反向没有"数据库没有但类型里有"的幽灵条目，说明不是命名对不上，纯粹是没
  重新生成。

**掩盖机制**：`SupabaseContainerRepository.ts`/`SupabaseWaveRepository.ts` 等
多处系统性使用 `(this.getClient() as any)` 绕过类型检查——这使数据库漂移
**不产生任何编译错误**，是第 1.2 节漏洞、以及未来更多类似漏洞得以存在而不被
编译器捕获的直接原因。

### 3.2 表/函数对接覆盖率（数据库维度独立扫描，按业务域分组）

**表**：约 53/76（~70%）有对接，23 张零引用，分组如下：

| 业务域 | 零覆盖表 | 说明 |
|---|---|---|
| VAS 增值服务（整域） | `vas_boms`、`vas_bom_items` | 有端口接口 `IVasBomRepository`，但**从未有过实现类**，也没有在任何 DI 组合根注册——不是"漏了"，是"从未接入" |
| 危险品/环境合规主数据（整域，9 张） | `hazard_*`（4）、`humidity/temperature/volume/quantity/weight_classes`（5） | DBA 迁移 037 专门设计的合规能力 |
| 仓库空间模型新两层 | `warehouses`、`location_types` | 迁移 040 |
| Cross-Dock D-Core 支撑表 | `cross_dock_dispositions`/`offers`/`staging_reservations` | 迁移 039/041 |
| 收货行级真相账 | `inbound_receipt_lines`、`receipt_items`、`receipt_line_stage_events`、`order_line_events` | **业务上最新最核心的"计划 vs 实收偏差"记账能力**，迁移 028-030/042 |
| 承运商主数据 | `carriers` | 迁移 032 |
| 分拣波次 | `sorting_waves` | 迁移 007；注意不是 `waves`，是完全不同的表，`SupabaseClient.ts` 定义了常量但从未被任何仓储使用 |

**函数**：全代码库仅调用 31 个函数名，其中 **2 个数据库里根本不存在**（幽灵
RPC，见第 1.4 节及下方 3.3），真实覆盖率约 35%（29/82）。零覆盖函数群与上表
零覆盖的表高度对应，说明是**整块业务域**缺失，不是零散遗漏。

**正面旁证（数据库维度专门核查）**：迁移 024（RBAC 权限种子）/026（auth 身份
桥接）/036（租户隔离加固）——即本次 PR #84 分支名对应的三层——**应用层同步
状态良好**，均有仓储覆盖、清晰注释、专门的并发测试。**真正的对接缺口集中在
更晚的第 32-44 层。**

### 3.3 两个调用不存在函数的真实 bug [2 个独立视角交叉验证]

- `SupabaseLocationRepository.findReplenishmentNeeded()` 调用 `calculate_
  replenishment_threshold`——数据库、全部迁移文件、设计文档里都不存在，且把
  一个未 `await` 的 RPC 调用对象直接传给 `.lt()` 当过滤值，**静默返回错误的
  补货结果而非报错**。团队其实已经在 `SupabaseInventoryRepository.
  findReplenishmentNeeded()` 修好了同一业务需求（正确复用 DBA 提供的
  `v_replenishment_needs` 视图），但坏版本从未被删除，接口仍导出它。
- `SupabaseContainerRepository.getHierarchy()` 调用 `get_container_hierarchy`
  ——同样不存在，见第 1.4 节的 DoS 后果。

### 3.4 RPC 客户端的重复实现与潜在跨租户地雷（数据库维度独家发现，P2）

`SupabaseClient.rpc()` 与 `SupabaseRpcClient.callWithClient()` 几乎逐字重复同一段
"自动注入 tenant_id"逻辑，且用**子串匹配**（`key.includes('tenant_id')`）而非
精确匹配。目前没有函数签名同时出现两个含 `tenant_id` 字样的参数，所以还不是
活跃 bug，但这是一个未被任何测试或类型约束防住的地雷——一旦未来出现（比如
cross-dock 场景的"来源租户"/"目标租户"），会静默注入错误的值造成跨租户串号。

---

## 4. 测试与 CI：为什么以上问题都能存活至今 [测试维度独家，方法论性发现]

- `vitest.config.ts` **没有 `coverage.thresholds`**；CI 的 `test` job 不设置
  `RUN_DB_CONCURRENCY_TESTS`。
- 全仓库 41 个测试文件，**33 个（80%）默认被 `describe.skipIf` 跳过**；实测
  `npx vitest run`：345 个用例里 **260 个（75%）被跳过**，只有 85 个真正执行。
- 唯一会设置 `RUN_DB_CONCURRENCY_TESTS` 去跑这些测试的 `db-integration.yml`，
  其文件头注释自认"未加入 `ci.yml` 的 `ci-success` 硬门禁"。
- 实测覆盖率（正常 `npm run test:coverage`，即 CI 实际会跑出的数字）：
  **Statements 11.45%、Branches 2.84%、Functions 7.74%**——与文档反复强调的
  "80%+" 相差极大，且 `codecov` 上传设置了 `fail_ci_if_error: false`。
- `src/apps/device-api/routes.ts`（880 行，全部 PDA 端点）覆盖率 **0.34%**；
  `src/core/usecases/*`（9 个用例类）、`src/core/workflows/*` **全部 0%**。
- 并发测试套件对"脏/共享数据库环境"零容错——只在 CI 一次性沙盒里可信，普通
  开发者在本地长期开发库上主动跑一遍来自查，成功率本身没有保障，进一步降低
  了"有人会在合并前主动跑它"的概率。
- 一处自证性假测试：`migration-023-types.test.ts` 的运行时断言对着自己手写的
  字面量对象断言，不管数据库真实返回什么，永远通过（编译期类型断言部分是
  有效的，问题只在运行时部分）。
- 好消息：全部 41 个测试文件都有真实 `expect()` 断言（无"零断言"的纯摆设文件），
  问题不是"测试造假"，是"测试写得对但从不被强制执行"。

---

## 5. 业务能力完成度全景（业务规划维度独家，L0-L4 标尺）

标尺：L0 无数据库对象 / L1 有表无接口 / L2 有接口无界面 / L3 有界面可操作 /
L4 真实作业验证过且能计费对账。

| 业务能力 | 评级 | 关键证据 |
|---|---|---|
| 入库/收货 | L2− | 收货行级真相账仅在越库路径写入，普通收货仍是表头账 |
| 上架 | L2− | DBA 判定原语（041）应用层零调用 |
| 仓库/库区/货位主数据 | **L1** | 三个 API 全文搜索"warehouse"零命中 |
| 库存管理 | L2 | 端点齐全但零 HTTP 测试 |
| 订单/波次 | L2 | 相对最完整 |
| 拣货 | **L1.5** | 无交互式三步流，没有"我的任务列表"接口 |
| 二次分拣 | L1 | 三张表在，零端点 |
| 打包 | L1.5 | 无面单生成能力 |
| 发货/装车 | L2− | 绕过权威函数 `fn_confirm_shipment`，走自建路径 |
| 越库 | **L1** | DBA 投入最大（六轮迁移），应用层零端点，且 DBA 侧已主动冻结 |
| 质检 | L2 | 端点齐，但"记录质检结果"这一步实际忘挂路由（见架构维度 P1-5） |
| 计费 | **L1−** | 三张表 44 个迁移零演进；`CalculateStorageFeeUseCase` 零调用方 |
| 退货/逆向 | **L0** | 数据库无表、无设计文档 |
| 补货 | L0/L1 | 只有一个视图 |
| 采购/供应商 | L0 | 一张表都没有 |
| **租户人员/角色管理** | **L0** | 仓库经理无法创建一个拣货员账号 |
| 客户门户/多方协同 | L0 | 3PL 门面完全空白 |

**核心结论**：整个项目**没有任何业务能力越过 L2**。100 个端点从未被任何客户端
调用过——第 2 节的核心链路失效事故，正是这个"零客户端真空"的必然产物，只要
真空还在，类似问题会不断复现而不被发现。

---

## 6. 项目治理/需求来源问题（业务规划维度独家，根因性发现）

1. **需求来源倒置**：项目"业务需求与功能规格说明书"自称"反推版——基于对三份
   历史数据库脚本的逆向分析整理而成"，没有客户、没有试点、没有一线访谈。这
   解释了几乎全部下游症状：供给驱动的优先级排序、几十个悬挂数月的
   `OPEN_QUESTION`。**至今没有任何文档把这条列为风险项，它却是根因**。
2. **DBA 侧已自己发现产品定位站不住**：`tenant_id` 同时承担安全隔离/经营者/
   货主三种语义在真 3PL 共仓下不成立，Cross-Dock D-Core 的 Phase 4 已被 DBA
   主动冻结 3 周以上（截至本次诊断），但 ROADMAP 等文档仍按"3PL SaaS"描述
   产品全篇，这个决策悬而不决正在拖累一切下游排期判断。
3. **"两个团队"实际是一个人**：ROADMAP 自证"仓库唯一协作者即项目负责人本人"。
   跨仓库（WMS7 ↔ HiWmsSupabase）走 Issue/addendum 流程在真正的多团队场景里
   是必要治理，在单人项目里主要产出的是**延迟**。
4. **前端技术栈决策自相矛盾**：ROADMAP 写 Uniapp Vue3，但 `package.json`
   生产依赖里躺着 react/react-dom/react-redux，零 UI 代码。
5. **运维/上线就绪度约等于 0**：无 Dockerfile、无 docker-compose、无 CD
   workflow；DBA 文档记有"Supabase 项目 7 天自动暂停问题数据库层无法解决"；
   一旦有真实客户数据，没有回滚路径、没有恢复演练。
6. **文档与代码严重漂移**：`TENANT_GAP_ANALYSIS.md` 写"Tenant API 7 端点"，
   实际是 75+；同文件把"质检结果录入"标记 ✅，但该路由从未被挂载。

---

## 7. 本文档与既有分析的关系

- **不推翻** `DBA_SYNC_GAP_ANALYSIS_AND_UPGRADE_PLAN_V1.md` 里关于 Track A-1
  （sync_events）技术方案细节的部分（authToken 贯通思路、返回值语义表等）——
  这些细节在本文档第 2 节的结论下依然适用，会被下一步的方案设计阶段吸收。
- **推翻**该文档"基础设施 100% 就绪，只是没接完"这一核心前提，以及"用
  Track A-1/A-2/B 三分框架覆盖全部问题范围"这个隐含假设——本文档第 1、5、6
  节的问题完全在那个框架之外。
- **下一步**：基于本诊断，用 ECC 多维方式（不预设分类框架、允许跨维度自由
  排列组合优先级）重新设计详细方案与实施计划。

---

## 附：全部证据文件索引（按 5 个独立诊断合并去重）

**架构/安全（应用层代码）**：
`src/apps/admin-api/routes.ts`、`src/apps/admin-api/config.ts`、
`src/adapters/supabase/auth/SupabaseTenantResolver.ts`、
`src/adapters/express/ExpressMiddlewareFactory.ts`、
`src/apps/tenant-api/routes.ts`（1305 行，多处证据行号见原始 agent 报告）、
`src/apps/tenant-api/di.ts`、`src/apps/device-api/routes.ts`、
`src/apps/device-api/DeviceAuthMiddleware.ts`、
`src/apps/device-api/auth/device-credentials.ts`、
`src/apps/device-api/publicAuthRoutes.ts`、
`src/adapters/supabase/index.ts`、`src/adapters/supabase/SupabaseClient.ts`、
`src/adapters/supabase/repositories/SupabaseBaseRepository.ts`、
`src/adapters/supabase/repositories/SupabaseContainerRepository.ts`、
`src/adapters/supabase/repositories/SupabaseLocationRepository.ts`、
`src/adapters/supabase/repositories/SupabaseWaveRepository.ts`、
`src/adapters/supabase/rpc/SupabaseRpcClient.ts`、
`src/types/database.ts`

**测试/CI**：
`vitest.config.ts`、`.github/workflows/ci.yml`、`.github/workflows/db-integration.yml`、
`src/__tests__/integration/sync/fn_apply_sync_event.concurrency.test.ts`、
`src/__tests__/integration/exceptions/fn_resolve_exception.concurrency.test.ts`、
`src/__tests__/types/migration-023-types.test.ts`、
`src/core/usecases/`（9 个文件）、`src/core/workflows/`

**产品/文档**：
`docs/00-project/ROADMAP.md`、`docs/00-project/TENANT_GAP_ANALYSIS.md`、
`docs/00-project/ECC_EXECUTION_PLAN.md`、`docs/00-project/BACKEND_GAP_ANALYSIS.md`

**DBA 侧（只读参考）**：
`/tmp/HiWmsSupabase/supabase/migrations/`（001-044）、
`/tmp/HiWmsSupabase/design-docs/unWMS_Full_Init_Schema_V2.1.md`（主索引）、
`/tmp/HiWmsSupabase/design-docs/unWMS_3PL_Multi_Party_Fusion_Architecture_V1.md`、
`/tmp/HiWmsSupabase/design-docs/unWMS_3PL_Conversation_Handoff_V1.md`
