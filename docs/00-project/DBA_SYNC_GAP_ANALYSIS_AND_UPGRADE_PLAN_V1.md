# DBA 迁移 024-045 × WMS7 应用层 —— ECC 多维差距分析与升级方案 V2

> 日期：2026-09-04（V2，基于 5 个独立视角子会话评审修订：architect / security-reviewer /
> database-reviewer / planner / tdd-guide，各自独立读取本文档 V1 并交叉核实代码，不共享
> 彼此结论。V1 的核心方向判断保留，但 Track A-1 的实施前提被 3 个独立 agent 各自发现
> 是错误的——按 V1 字面执行会得到"测试全绿、验收标准全部通过、生产 bug 原样存在"的
> 结果。V2 全部采纳评审意见后重写。）
>
> 分析基线：`HiWmsSupabase` 迁移 001-045（截至 commit `f8e9a57`）+ 全部 `design-docs/*.md`
> 触发背景：PR #84（迁移 024/026/036 应用层集成）CI 失败排查过程中，发现应用层与
> DBA 侧实现之间存在系统性差距，不止 024/026/036 三层，本文档做一次完整评估。
>
> **本文档定位**：可交给独立子会话执行的实施计划——每个任务自包含背景、目标文件、
> 参考实现、验收标准，子会话不需要依赖本次对话历史即可理解并执行。**但 Track A-0
> 是一个未决的架构/安全决策项，子会话不得自行拍板，必须先获得决策再动工。**

---

## 0. V2 核心结论（V1 结论已被推翻/修正的部分标注 ⚠️）

1. ⚠️ **V1 声称"基础设施 100% 就绪，只是没接完"——这个判断对 device-api 是错的，
   是本文档最重大的修正。** 三个独立 agent（architect、planner、security-reviewer）
   各自读代码核实后一致确认：`req.context.supabaseToken` 只存在于 tenant-api/admin-api
   使用的 `ExpressMiddlewareFactory.authenticate()` 链路，而 Track A-1 要修的
   `applyEvent` 唯一真实调用方是 **device-api**（`src/apps/device-api/routes.ts`），
   它走完全独立的 `DeviceAuthMiddleware`，签发/校验的是 ADR-019 定义的**设备专属
   HS256 JWT**（与 Supabase 项目 JWT 密钥无关），`req.context` 里根本没有
   `supabaseToken` 字段。**按 V1 方案字面执行，`authToken` 参数恒为 `undefined`，
   叠加"未传时行为不变"的向后兼容设计，结果是代码改了、测试绿了、生产路径的
   静默空转 bug 完全没修。这是一个会被验收流程本身掩盖的失败模式。**
   → 新增 **Track A-0（决策项，阻塞 A-1）**：设备身份桥接机制设计。

2. ⚠️ **`src/types/database.ts` 尚未按迁移 037-045 重新生成，是 Track A-2 全部
   任务的隐藏前置阻塞**（architect + planner 独立核实一致：`zones` 类型无
   `warehouse_id`，`warehouses` 表整个不在生成类型里）。V1 把这件事藏在检查清单
   末尾，严重低估——它会同时影响 44 个既有仓储的类型安全。→ 提升为 **Track A-0.5**。

3. **Track A-1 的技术方案本身（authToken 贯通思路）方向正确，但需要 4 处修正**：
   - `authToken` 应设为**必填**而非可选（安全维度 + 架构维度独立提出同一建议）：
     这两个 RPC 已被数据库维度核实**不存在任何合法的无身份调用场景**，"可选"
     只会制造一个"编译能过、运行时静默降级"的死代码分支。
   - `SKIPPED_NOT_PENDING` 语义表遗漏了权威文档明确列出的第 4 种情况（"确已处理
     完，可安全丢弃"），且对现有代码健壮性的诊断有误——现有代码已经通过重查
     `status` 正确处理了这种情况，不需要重写，只需要修一次 authToken 贯通。
   - `resolveException` 与 `applyEvent` 的失败模式不同（前者硬失败抛异常，后者
     静默失败返回正常字符串），严重度不同，`resolveException` 目前在生产代码里
     **零调用方**，降级为独立的 P2 任务，不与 P0 混在一批。
   - **新发现的姊妹问题**：`requireDevicePermission()`（device-api 权限检查）
     同样裸调用无 authToken，与 `check_user_permission` 里"仅在有 JWT 时才生效"
     的条件式防护构成同款问题，必须并入本次修复范围，而不是留到以后单独发现。

4. **Track A-2 大幅调整**：
   - ZoneRepository 的 `warehouse_id` 修复，定性从"新功能"改为"**Sprint 6 遗留
     的回归修复**"（PR #81 已交付 locations 端点，但 warehouse/zone 主干完全
     没做，且现在是坏的）。
   - **仓储拆分粒度修正**：`ILocationTypeRepository.assignLocations` 与既有
     `ILocationRepository` 有职责重叠，需要先决策 `locations.zone_type`（旧字符
     串维度）与 040 新引入的 `location_types`（实体化维度）如何收敛，否则会
     出现两套并行分类体系。`IStorageComplianceRepository` 拆分为
     `IStorageClassRepository`（5 量纲档案 + 危险品规则集）+ `fn_set_product_
     storage_requirement` 归入既有 `IProductConstraintRepository`（避免与"商品
     约束"形成第二个入口）。判定原语改建模为 `ILocationJudgmentQuery`（只读
     Domain Service，不是 Repository），端口层面物理上不允许任何写方法。
   - **不再使用 Sprint N/N+1/N+2 编号**——项目已有两套并行编号体系
     （`ECC_EXECUTION_PLAN.md` 安全线 vs `TENANT_GAP_ANALYSIS.md` 业务线），
     引入第三套会让排期不可读。改为并入 `TENANT_GAP_ANALYSIS.md` 既有编号，
     真实待办是 Sprint 7/8。
   - StorageCompliance（温控/危险品/容量档案）降级为 **P2 条件触发**（出现冷链/
     危险品意向客户或合规审计要求时启动）——当前是供给驱动（因为 DBA 交付了
     才做），零客户需求证据。判定原语（041）**移出本方案**，登记 backlog，
     前置条件是 Sprint 7 拣货/上架流程跑通、有真实作业数据后再评估。
   - **新增测试要求**：RLS 跨租户隔离测试、`p_actor_user_id` 防冒充测试必须列为
     独立可自动回归的验收条目，不能只依赖一次性 code review。补全过期 JWT、
     无租户上下文用户、跨租户 event id 查询防信息泄露（响应必须与"id 不存在"
     完全一致）等安全边缘用例。

5. **Track B 的处理方式基本认可，补 3 条防线**：
   - 不做代码 PoC（技术可行性 DBA 已对标验证过，真正未知的是"客户要不要"）；
     改做**需求侧场景剧本访谈**（把 4 个抽象问题翻译成具体业务场景问一线/客户）
     + **决策 SLA**（建议对齐 Sprint 8 结束）+ **到期默认值**（默认按"专属仓
     单租户模型"继续，写进 ADR）。
   - **新增强制防线**：Track A-2 新建的表字段/RPC 参数，**禁止预留任何多货主/
     多方语义相关的字段或分支**，哪怕注释写"为将来 Track B 准备"——这是本次
     安全评审特别强调的一条，防止在决策落地前用"技术准备"的名义悄悄开口子。
   - 决策请求清单第 5 条补充："查询面必须物理上不可写（视图/RPC 层面强制
     read-only，不依赖应用层自觉）"——常见的越权引入路径是"只读聚合视图长出
     写权限"，应在决策阶段就把这条钉死。

6. 迁移 045（`fn_confirm_shipment` NULL 状态修复）对应用层影响需要**复核**（V1
   写"零影响"不完整）：确认应用层从未直接调用 `fn_confirm_shipment`，但 PR #80
   已交付发货交接端点（`tenant-api/routes.ts` 的 `handover` 相关路由），走的是
   自建路径。"应用层从未调用权威发货函数"+"发货域端点已上线"并存，需要核实这
   是有意为之还是又一处静默分叉，登记为待核实项，不下"零影响"的结论。

---

## 1. ECC 多维度分析（V1 内容基本保留，仅列出被评审修正的判断）

### 1.1 业务维度（planner 评审后修正）

**风险分级理由修正**：Track A-1 的 CRITICAL 定级不应基于"账实不符，一旦上线"
（这是未来态风险的现在时表述——核实项目当前**无任何前端/PDA 客户端存在**，
`ROADMAP.md` 阶段 2「PDA 离线优先前端开发」13 条一条未做，也无试点客户证据，
"货已实收但账不更新"这个场景今天发生概率为 0）。**更准确、更能服人的理由是**：
它正在**阻塞 CI 流水线和 PR #84**，且使 PICK/PUTAWAY/COUNT/PACK/RECEIVE 五个
动作的**全部现有测试证据失效**（测试路径与生产路径不一致）——这是
`TENANT_GAP_ANALYSIS.md` Sprint 7（拣货/打包/分拣）的地基。定级为「上线阻塞级
缺陷（pre-launch blocker）」，优先级保持队首。

**遗漏的更高优先级业务项**（planner 核实自 `TENANT_GAP_ANALYSIS.md` Top-10，
本文档 Track A/B 都未覆盖，此处仅记录不展开，避免与本文档范围混淆）：
拣货交互式 PDA 流（scan-location→scan-product→confirm-qty）、退货/逆向物流
（整个域数据库层未建表，电商 10-30% 退货率，前置周期最长应尽早向 DBA 发起
设计请求）、前端/PDA 最小原型启动（后端已 76+ 端点但零 UI 验证，Track A-1
这个 bug 到今天才被发现的根因正是没有真实设备端在调用）。这些项目优先级明显
高于 Track A-2 的 StorageCompliance/LocationJudgment，建议在团队排期时一并
参考，但不属于本次 DBA 差距分析的范围。

### 1.2-1.7（架构/设计/测试/安全/行业维度）

保留 V1 判断，具体修正内容已整合进第 2/3 节的任务描述中，不再重复罗列。

---

## 2. Track A-0（新增，决策项，阻塞后续一切）

### 2.0.1 设备身份桥接机制（阻塞 Track A-1）

**问题**：`fn_apply_sync_event`/`fn_resolve_exception`/`check_user_permission`
的租户防护都要求调用者会话能被 `fn_current_tenant_id()`/`fn_current_user_id()`
正确解析（依赖 PostgREST 从 Supabase JWT 派生的 GUC）。device-api 当前用完全
独立的设备凭证体系（ADR-019，`src/apps/device-api/auth/device-credentials.ts`
的 `tenantSigningKeys`，HS256，与 Supabase 项目 JWT 密钥无关），PostgREST 无法
识别这种 token。`operator-checkin` 端点（`routes.ts:127-172`）其实拿到过一次
真实的 Supabase `session`（`auth.provider.signIn()` 返回值），但当前实现只用它
验证登录成功就地丢弃，从未透传给设备端或落到 `req.context`。

**这不是"把已建好的管道接上"的体力活，是一个新的信任边界设计，必须先决策
再实施。** 三个候选方案（均已被至少一个 agent 评估过代价）：

| 方案 | 做法 | 代价与风险 |
|---|---|---|
| D1 | operator-checkin 保留并把 `session.access_token` 落到设备侧会话存储，按 device 绑定，后续请求带回 | 语义最干净（真是操作员身份）；但需要服务端 refresh token 托管（Supabase token ~1h 过期 vs 设备 refresh token 7d 生命周期不一致），等于新建一套会话存储，工作量远超"接管道" |
| D2 | 服务端用 `SUPABASE_JWT_SECRET` 自签一个 PostgREST 可识别的短时 JWT（`sub=operator_user_id`, `role=authenticated`） | 技术上可行、成本低；但让 device-api 进程持有"签发任意用户身份"的能力，**必须先过独立安全评审/威胁建模**，与 ADR-018「禁止身份冒用」的既有立场需要正面协调，不能顺手做 |
| D3 | 请 DBA 为后台/设备通道提供受控重载（如 `fn_apply_sync_event(p_event_id, p_tenant_id)`，`SECURITY DEFINER` + 仅 `service_role` 可执行），租户由服务端从已验证的设备凭证派生，不接受客户端自报 | 架构上对"机器身份"最正确，语义与 042 的 fail-open 加固意图一致；跨仓库需要 DBA addendum，周期不可控 |

**重要澄清（推翻 V1 的一处误判）**：V1 §1.6 曾把"退回到用 service_role 硬编码
租户参数"一刀切否定为"绕过 JWT 校验"。这个否定是**混淆概念**——设备 JWT 已经
是被服务端密码学验证过的凭证，租户来自 `devices` 表二次核验
（`DeviceAuthMiddleware.ts:175-186`），不是客户端自报，谈不上"绕过校验"。
真正的安全要求是"租户不得来自未验证输入"，D3 满足这个要求。

**决策产出物**：一份 ADR，选定 D1/D2/D3 之一（或组合），指定决策人与截止时间。
**决策落地前，Track A-1 的实施不得启动。** 同时注意：`processPendingEvents`
未来若由后台 worker 调用，worker 根本没有"用户 JWT"可用，D3 这类机器身份通道
是迟早要建的，不是可以回避的一次性工作。

### 2.0.2（并行处理，不阻塞 A-0.1 决策，但阻塞 A-1 编码）重投 driver 归属决策

`retryable: true` 语义设计出来后，需要有人消费它——当前 `processPendingEvents`
在生产代码里**零调用方**（无 worker/cron/事件总线接入）。三个候选：(a) DB 侧
`pg_cron` 周期调度（DBA 已有退避字段 `BACKOFF_NOT_DUE`，说明设计意图就是有一个
周期性 driver，且此方案不依赖 A-0.1 的结论）、(b) 应用侧独立 worker 进程（依赖
A-0.1 先解决机器身份问题）、(c) 设备端重传（依赖设备协议改动，成本最高）。
**建议优先评估 (a)**，因为它与 DBA 侧退避语义天然吻合、不依赖 A-0.1 决策进度，
可以独立推进。

## 2.1 Track A-0.5（新增，阻塞 Track A-2 全部任务）：重新生成 `src/types/database.ts`

**背景**：`Tables<'zones'>`/`TablesInsert<'zones'>` 等全部由 `database.ts` 生成
类型派生（`IZoneRepository.ts:8-10`），当前该文件落后于迁移 037-045——`zones`
类型没有 `warehouse_id` 字段，`warehouses`/`location_types` 等表整个不存在于
生成类型中。`SupabaseRpcClient.ts:143` 的 `F extends keyof Database['public']
['Functions']` 类型约束意味着新增 RPC 在类型不同步前无法以类型安全的方式调用
——现有代码里 `SupabaseSyncEventRepository.ts:94` 那句
`'fn_apply_sync_event' as RpcFunctionName` 的强制类型转换，就是类型不同步已经
在腐蚀类型安全的证据。

**改动**：`supabase gen types typescript --local > src/types/database.ts`（或
项目既有的生成命令），处理由此产生的全仓库编译错误（**预计影响面覆盖全部 44 个
现有仓储的类型检查**，需要单独跑一次 `tsc --noEmit` 评估爆炸半径，不要假设
"只是加几个新类型不会影响老代码"）。

**验收标准**：`tsc --noEmit` 零错误；`Tables<'warehouses'>`/`Tables<'zones'>`
（含 `warehouse_id`）/`Tables<'location_types'>` 等类型可正常引用。

---

## 3. Track A-1（P0）：sync_events / exceptions / requireDevicePermission 分发器身份贯通

> **本任务的启动条件**：Track A-0.1（设备身份桥接决策）已产出 ADR 并选定方案。
> 在此之前，本节内容仅作为"决策落地后如何实施"的参考，不得提前编码。

### 3.1 背景（不需要重新调研，已被 5 个独立视角核实）

`SupabaseRpcClient`（`src/adapters/supabase/rpc/SupabaseRpcClient.ts`）已有
`rawWithAuth(userToken, functionName, args, options)` 方法（第 143-151 行），
用传入 JWT 构造 per-request authenticated client。DBA 迁移 042 的安全加固要求
调用者会话必须能被 `fn_current_tenant_id()` 正确解析，裸 service_role 调用时
该函数返回 NULL：

- `fn_apply_sync_event` 返回 `SKIPPED_NOT_PENDING`，事件保持 `PENDING`，**HTTP
  层会看到 `success:false`**（`routes.ts` 里 `res.json({event_id, ...result})`，
  不是彻底静默），但**数据库侧零告警**（不调用 `fn_raise_exception`，
  `exceptions` 表零写入，运维侧看不到异常队列条目）——这是数据库维度核实后对
  V1"不报错"措辞的精确化修正。
- `requireDevicePermission()`（`device-api/routes.ts:99-111`）调用
  `permissionChecker.check(...)` 同样不传 authToken，`check_user_permission`
  SQL 定义（`022_security_hardening_batch3.sql`）里的跨租户检查是**条件式**的
  （`IF v_caller_tenant_id IS NOT NULL THEN ... END IF`），裸调用时这段防护
  整段被跳过，退化成"纯按 `p_user_id` 查 RBAC 表"。因为 `p_user_id` 来自服务端
  已验证的设备 JWT payload、非客户端直接可控，**目前还不构成外部可利用的越权**，
  但这是与 `fn_apply_sync_event` 完全同构的安全债务，必须一并纳入本次修复，
  不要留到以后单独发现。
- `fn_resolve_exception`（`SupabaseExceptionRepository.resolveException()`，
  `.ts:242`）同样缺 authToken，**但失败模式不同**：该函数无会话时是
  `RAISE EXCEPTION`（硬失败，会在日志/响应里炸出错误），不是像
  `fn_apply_sync_event` 那样"返回一个看似正常的字符串、什么都不报"的静默失败。
  且**该方法在生产代码里当前零调用方**（只有内部委托和测试）。因此
  **降级为独立 P2 任务**，与本节 P0 范围分开处理，不要混在同一批 PR 里。

**建议向 DBA 提交的契约变更请求**（architect 提出，非阻塞项，可与本次实施并行
提交）：`fn_apply_sync_event` 返回值目前是字符串，应用层需要"RPC 后二次查询
status、三次查询 exceptions"的补偿查询链才能拿到完整语义。建议请 DBA 评估把
返回值改为结构化 `JSONB { outcome, event_status, exception_id, retryable,
retry_after }`，消灭补偿查询、把语义单一真相源留在 DB 侧。在这个契约变更落地
前，应用层的字符串→语义映射必须抽成独立模块（建议
`src/adapters/supabase/sync/syncEventOutcome.ts`），用穷尽式联合类型 + **未知
返回码走 fail-loud 默认分支**，不能内联在仓储方法里。

### 3.2 涉及文件与改动点

| 文件 | 改动 |
|---|---|
| `src/core/ports/db/ISyncEventRepository.ts` | `applyEvent`、`processPendingEvents` 签名的身份参数改为**必填**（不是 `authToken?: string`），类型建议用判别联合 `AuthContext = {kind:'user'; token:string} \| {kind:'service'; tenantId:string}`（区分用户 JWT 通道与 A-0.1 决策产出的机器身份通道，避免像 V1 那样把裸 `string` 参数当成万能兜底） |
| `src/adapters/supabase/repositories/SupabaseSyncEventRepository.ts` | 按 A-0.1 决策结果接入身份；`applyEvent` 内部**全部** `getClient()` 调用（不只是 RPC 那一处，第 76/105/149/182 行都要改）必须带身份，验收时要能机械核查"不存在任何不带身份的 `getClient()` 调用" |
| `src/core/ports/db/IExceptionRepository.ts` / `SupabaseExceptionRepository.ts` | `resolveException` 补 authToken 贯通，**降级 P2**，与本节主体分开提交 |
| `src/apps/device-api/DeviceAuthMiddleware.ts` 或新增桥接模块 | 按 A-0.1 选定方案实现身份桥接，产出可传给 `rawWithAuth`/机器身份通道的凭证 |
| `src/apps/device-api/routes.ts` | 全部 `applyEvent`/`processPendingEvents` 调用处接入新身份参数；`requireDevicePermission()` 同步补齐 authToken 透传 |
| `WmsSupabaseClient.getAuthenticatedClient()` | **新增**：当前每次调用都新建 client 实例不缓存（`SupabaseClient.ts`），贯通后 `processPendingEvents(limit=100)` 会产生约 400 个 client 实例/次调用（4 处 `getClient` × 100 事件）且串行 HTTP 往返。必须做请求级/token 级 memoize（`Map`/LRU + TTL），否则本次修复会顺手引入 GC 压力与延迟问题 |

**参考实现模板**：`SupabaseInventoryRepository.ts` 的 `authToken?: string` +
`getClient(false, authToken)` 模式**在参数可选性上不要照抄**（该模式对有合法
service_role 用例的仓储适用，本次两个函数已确认无合法回退场景，必须必填）。

### 3.3 `applyEvent` 返回值语义修正（完整版，已补全数据库维度核实的第 4 种情况）

`SKIPPED_NOT_PENDING` 覆盖 **4** 种结果（042 迁移文件第 1143-1160 行原文），
不是 V1 写的 3 种：

| RPC 返回值 | 含义 | 事件状态 | 处理 |
|---|---|---|---|
| 最终 `status='APPLIED'` | 已处理成功 | 终态 | `success:true`（**现有代码已经正确处理**，靠重查 `status` 而非解析字符串，见 `.ts:105-113` 注释，不需要重写这部分逻辑） |
| `SKIPPED_NOT_PENDING` 且 `status='APPLIED'`（(a) 确已处理完） | 已处理，可安全丢弃 | 终态 | `success:true`（**同上，现有代码天然兼容，V1 遗漏了这一分支的表格行**） |
| `SKIPPED_NOT_PENDING` 且 `status` 仍 `PENDING`（(b)(c)(d)：无租户上下文/属于别的租户/id 不存在） | 未抢占到 | 非终态，需重投 | 新增 `retryable:true`，**不查 exceptionId**（现有逻辑会为此白白查一次不存在的 exception，改动时要连带去掉这次多余查询，用 spy 断言无多余 DB 调用） |
| `BACKOFF_NOT_DUE` | 退避窗口内 | 非终态，必须重投 | `retryable:true` |
| `TRANSIENT_CONFLICT_RETRY` | 已放回 PENDING 等重试 | 非终态 | `retryable:true` |
| `TRANSIENT_CONFLICT_EXHAUSTED` | 重试预算耗尽 | 终态（非 APPLIED） | 真正业务失败，走现有"`success:false` + 查 exceptionId"逻辑 |
| 最终 `status∈{EXCEPTION,REJECTED}` | 业务异常/拒绝 | 终态 | 现有逻辑正确 |
| `SKIPPED_NOT_PROCESSING`/`REJECTED_UNKNOWN_ACTION`/`COMPLIANCE_EXCEPTION`/`SYSTEM_EXCEPTION` | （数据库维度核实：V1 完全未提及的 4 个返回值） | 终态 | 归入"最终 status∈{EXCEPTION,REJECTED}"分支，功能上因现有代码按 status 重查不会出错，但契约文档需要补全，避免误导只读表格的实现者 |

**认证失败必须与业务 retryable 分开**（安全维度提出）：`processPendingEvents`
批量处理时，若批内跨越 JWT 过期边界，前几个成功、后几个因 401 失败，不能把
"token 过期"和"业务需要重投"合并进同一个 `retryable` 字段——否则会造成"看起来
在重试、实际因为同一个已过期 token 永远不会成功"的隐蔽故障。返回类型建议：

```typescript
{
  success: boolean;
  retryable?: boolean;      // 业务语义：事件仍是 PENDING，需要重投
  authError?: boolean;      // 新增：认证/授权失败，不是业务重试，需要调用方重新获取身份
  result?: unknown;
  error?: string;
  exceptionId?: string;
}
```

### 3.4 测试要求（tdd-guide 评审补全，V1 遗漏项已标注）

**分两批做 TDD**，不要把"身份贯通"（结构性改动）和"返回值语义修正"（业务逻辑）
混在一批测试里，失败时才能判断根因层次：

**第一批：身份贯通**
1. RED→GREEN：`applyEvent(eventId, 有效身份)` → `fn_apply_sync_event` 真正处理，
   最终 `status='APPLIED'`
2. **端到端闭环测试（V1 完全遗漏）**：真实 HTTP 请求打 `POST /sync/events`
   （用真实设备 token，走完整 device-api 认证链路，不是绕过它直接调仓储方法），
   断言事件最终 `status='APPLIED'`。**必须先证明这条用例在修复前失败**——这是
   本次唯一能验证"生产路径真的被修复"而非"repository 单测通过但生产路径没变"
   的测试，是 Track A-1 能否闭环的核心判据。

**第二批：返回值语义（每个分支独立一条测试，不要一条测试断言多个分支）**
3. 裸调用/无身份（合法的机器身份场景，取决于 A-0.1 决策结果）→ `retryable:true`，
   不抛异常不误报成功，**且不触发 exceptionId 查询**（spy 断言无多余 DB 调用）
4. `authToken` 已过期 → 与"业务 retryable"语义分开，返回 `authError:true` 或
   等价的可识别信号（**V1 完全未覆盖**：过期 token 和"合法无身份调用"是两种不同
   语义，混淆会让"用户需要重新登录"的信号被静默吞掉）
5. `authToken` 有效但对应用户**无租户上下文**（`app_metadata.tenant_id` 为空，
   档案未开通）→ SQL 层表现与"无身份"相同，但业务含义是用户配置问题，测试要
   显式构造这个场景（`createTestUser` 不传 `tenantId`），断言至少有区分度的
   日志/错误分类
6. `eventId` 不存在 + 有效身份 → 不应是未捕获异常
7. **安全关键**：`eventId` 存在但属于别的租户（租户 A 身份查租户 B 的事件）→
   响应必须与"id 不存在"**逐字段完全相同**（不能让调用方通过响应差异反推"这个
   id 存在但不是我的"，这正是 DBA 042 想堵的洞的镜像面，V1 完全未覆盖这条）
8. `BACKOFF_NOT_DUE`/`TRANSIENT_CONFLICT_RETRY`/`TRANSIENT_CONFLICT_EXHAUSTED`
   → 各自需要真实数据构造触发条件（不能只断言字符串映射），参考
   `fn_apply_sync_event.concurrency.test.ts` 已有的双并发 PICK 复现手法

**第三批：`requireDevicePermission` 姊妹修复**
9. 对应 4-7 条的镜像测试（权限检查场景下的过期/无租户/跨租户/id 不存在）

**测试分层建议**：5 个 RPC 返回值分支的字符串→语义映射逻辑，应有一层**纯单元
测试**（mock `rawWithAuth` 直接返回各返回值字符串，断言 `applyEvent` 正确分类），
理由：穷举 5 个分支比每次都构造真实并发/退避场景的集成测试更容易做到完整覆盖
且运行更快；集成测试负责验证"真实 RPC 确实会产出这些字符串"，两者职责分离。

**"用真实用户 JWT 替换裸 service_role"的测试改造澄清**（tdd-guide 指出 V1 措辞
歧义）：不是"替换掉"，是**两条路径都要有专属测试常驻**——用户身份路径测试
（验证功能正常）+ 机器身份路径测试（验证优雅降级为 `retryable:true` 而不是被
删除/跳过，这是永久回归防护，因为未来 A-0.2 决定的重投 driver 很可能就是
service_role 场景）。**测试的认证方式必须与生产代码里该方法的真实调用契约保持
一致**，不能脱离真实调用路径单纯为了"测试变绿"选认证方式。

### 3.5 覆盖率验收标准（V1 完全空白，tdd-guide 补全）

**核实发现**：`vitest.config.ts` 当前**没有配置 `coverage.thresholds`**，
CLAUDE.md 的"80% 最低覆盖率"目前在本仓库完全没有被机器强制。且这批集成测试
默认 `RUN_DB_CONCURRENCY_TESTS=true` 才跑，**CI 默认 skip**，意味着即使新测试
再全面，自动化覆盖率报告仍会显示 0%。

**要求**：
1. 不对整仓库设强制阈值（历史代码可能不达标，需独立治理），但对**本次新增/
   修改文件**（`ISyncEventRepository`/`SupabaseSyncEventRepository`/身份桥接
   模块）做增量覆盖率检查。
2. CI 需新增专门起 Docker Postgres + `RUN_DB_CONCURRENCY_TESTS=true` 跑覆盖率
   的 job，或至少要求 PR 描述附本地覆盖率报告作为验证证据（类比 CLAUDE.md 对
   `.sql` 迁移已要求的"附验证证据"模式）。
3. `applyEvent` 的分支逻辑要求**分支覆盖率单独达标**，不能只看行覆盖率（容易
   被"两个测试刷到 90%+ 但只覆盖 2/5 分支"掩盖）——验收时逐条对照 3.3 节表格
   打勾，不看汇总百分比。

### 3.6 验收标准（汇总）

1. Track A-0.1 已产出 ADR 并选定方案（前置条件，不满足不得进入本节）
2. 第一批+第二批+第三批共 9+ 条测试全部通过，覆盖率按 3.5 节要求可验证
3. **端到端 HTTP 测试**（3.4 节第 2 条）通过——这是唯一能证明生产路径修复的证据
4. `SupabaseSyncEventRepository` 内不存在任何不带身份的 `getClient()` 调用
   （可机械核查，建议写进 lint 规则或 code-review checklist）
5. 全仓库普查一遍所有 `this.rpcClient.raw(`/`.rpc(` 裸调用点，核对对应 SQL
   函数是否具备同款"仅在有 JWT 时才生效"的条件式防护模式——`fn_apply_sync_event`
   （修复前）和 `check_user_permission`（现状）已证明这个模式在本仓库不是孤例，
   不要假设"修完这两个就完了"
6. 是否有生产库已堆积的历史 PENDING 事件需要一次性数据修复脚本，需在上线前评估
7. 走 `ecc:code-review` 独立评审；**Track A-0.1 的身份桥接机制额外需要一次多
   视角评审（架构+安全+TDD 并行子会话，不能只是普通代码 review）**，因为这是
   全新的信任边界设计

---

## 4. Track A-2（P1，已重新定级为"Sprint 6 遗留回归修复 + 常规功能"）

### 4.1 Track A-2.1（阻塞性，Sprint 6 补丁，不占新 Sprint 预算）：ZoneRepository `warehouse_id`

**背景修正**：PR #81（Sprint 5+6）已交付 `POST /locations` 等 47 端点，但
**tenant-api 全量端点里没有任何 warehouse/zone 端点**，同时 zone 创建在仓储层
已经必然失败（`warehouse_id NOT NULL`）。即"交付了叶子（locations）却没有主干
（warehouse→zone），且主干目前是坏的"——`TENANT_GAP_ANALYSIS.md` Top-10 第 4
项「租户入驻第一步就是配置仓库布局，当前需要 DBA 直接操作数据库」至今未解决。
这不是新功能，是补链 + 回归修复，应与 Track A-0.5（类型重新生成）同批处理，
不要另起 Sprint。

**关键决策前置**：`locations.zone_type`（既有字符串枚举维度）与 040 新引入的
`location_types`（实体化维度表）如何收敛，必须在写第一行 `IWarehouseRepository`
前决定，三选一：(a) `zone_type` 废弃并迁移到 `location_type_id`、(b) 保留为
冗余展示字段但判定一律以 `location_type_id` 为准、(c) 两者并存但各自适用范围
明确划定。**不决策就上线，会出现"查询面看到的可用库位"与"判定面认可的候选
库位"结论不一致，这在 WMS 里是会导致上架到错误库位的实质业务缺陷**，不是
架构洁癖问题。

**改动**：类型由 A-0.5 重新生成后自动带出 `warehouse_id`，端口/仓储文件按生成
类型调整（不要手写字段——那样和代码生成器打架，下次生成会被覆盖）；补充测试
fixture 里创建 zone 前先创建 warehouse；补一条"删除 warehouse 时下属 zone 该
级联删除还是阻止删除"的完整性测试（需先核实 040 迁移的 `ON DELETE` 策略）。

### 4.2 Track A-2.2：Warehouse / LocationType 仓储与 API（Sprint 6 补丁包）

按修正后的拆分（architect 意见）：

| 文件 | 职责 |
|---|---|
| `src/core/ports/db/IWarehouseRepository.ts` + `Supabase...` | 一表一仓储，CRUD，`authToken` 从一开始按必填/判别联合模式设计，不要重蹈 Track A-1 的覆辙 |
| `src/core/ports/db/ILocationTypeRepository.ts` + `Supabase...` | CRUD + `assignLocations`；`assignLocations` 的写入边界需要与 `ILocationRepository` 明确划清（谁负责改 `locations` 表的归属字段），并纳入上面的 `zone_type` 收敛决策 |

**API 命名**（architect + planner 一致反对 V1 的 `/api/storage/*`）：与既有
`storage_management_policies`（`IStorageManagementPolicyRepository`，磁盘用量
治理，平台管理员专属）语义冲突，且与现有 tenant-api 扁平命名风格（`/api/orders`
`/api/locations`）不一致。改为 `/api/warehouses`、`/api/zones`、
`/api/location-types`。**新增路由文件**（`src/apps/tenant-api/routes/facility.routes.ts`
或按既有惯例命名），不得继续往已 1200+ 行的 `tenant-api/routes.ts` 追加（超过
CLAUDE.md 800 行上限）。新 GET 端点（候选库位查询等）默认**不启用**
`ExpressMiddlewareFactory.cache()`（该中间件默认 key 不含租户/用户，会跨租户
串数据），或必须提供含 tenantId 的 keyGenerator。

**业务可验证的端到端验收标准**（V1 缺失，planner 补充）：一个新租户能**在不
依赖 DBA 手工执行 SQL 的前提下**，完成"建仓库→建库区→建库位类型→建库位→收
第一批货"——这条同时也是 `TENANT_GAP_ANALYSIS.md` Top-10 #4 的关闭条件。

### 4.3 Track A-2.3（降级 P2，条件触发）：存储合规主数据

**定级修正**：ROI 论述是"无法承接冷链/危险品客户"，但当前零客户、零商机证据，
是供给驱动而非需求驱动。合规硬底线已经存在（`fn_trg_enforce_product_constraints`，
迁移 001），038/037 是把它升级为可配置+版本化，属于增强而非从 0 到 1。**降为
P2，条件触发**：出现冷链/危险品意向客户或合规审计要求时启动，同时与 ROADMAP
§1.4 长期悬挂的"危险品/冷链 `ONLINE_ONLY` 合规负责人签字"决策合并处理，不要
分两处挂着。

**若启动，拆分为**（architect 修正 V1 的过粗聚合）：`IStorageClassRepository`
（5 个量纲档案表 + `hazard_rule_sets`，同构、版本化 `DRAFT→ACTIVE→SUPERSEDED`
生命周期）+ `fn_set_product_storage_requirement` **归入既有
`IProductConstraintRepository`**（避免与"商品约束"形成第二个入口，这是商品域
的属性，不是仓储空间域的）。

**数据库层约束（V1 未提及，database-reviewer 核实）**：全部 8 张合规主数据表
挂了 `fn_trg_profile_freeze` 触发器——一旦状态变为 `ACTIVE`，只能整体转
`SUPERSEDED`，不能改任何内容字段；`DRAFT` 记录离开 `DRAFT` 后不能删除。
`IStorageClassRepository` **不应该、也不能设计成通用 `update()` 方法**，实现
者不要在 API 层加一个"编辑"端点直接 UPDATE 这些表——会被触发器硬拒绝。

**安全要求**：全部方法必须走带身份的调用（这些 RPC 内部通过
`fn_assert_storage_actor` 强制 `p_actor_user_id = fn_current_user_id()`，无
合法回退场景）。`p_actor_user_id` 参数**永远取 `req.context.user.id`，不接受
请求体/查询参数传入**（即使 SQL 层会拒绝不符的值，也不该让攻击者有机会用
构造参数探测系统行为/报错信息差异）。**必须写一条显式安全回归测试**：用用户
A 的身份，在 RPC 参数里传入 `p_actor_user_id=用户B的id`，断言被拒绝而非静默
被真实调用者覆盖。

### 4.4 Track A-2.4（移出本方案，登记 backlog）：判定原语（041）

**范围收窄的理由**（三个维度独立指出同一结论）：
- **业务**：零真实作业数据阶段做"智能候选库位推荐"是 premature optimization，
  对标对象（SAP Storage Type Determination/Manhattan Slotting）是成熟期优化
  能力，不是 MVP 能力。
- **架构**：V1 自己写"如果发现只读判定能力依赖尚未决策的货权语义应立即停止
  上报"——这等于承认范围边界未知，范围未知的任务不该进 Sprint 计划。
- 前置条件：Sprint 7 拣货/上架交互流跑通、产生真实作业数据后再评估是否启动。

**若未来启动，建模修正**（architect）：不是 Repository，是独立的只读 Domain
Service/Query（`src/core/ports/query/ILocationJudgmentQuery.ts` +
`src/adapters/supabase/query/SupabaseLocationJudgmentQuery.ts`，新增
`ports/query/` 子目录，与 `ports/db`、`ports/rpc` 并列），端口层面**物理上不
包含任何写方法**（不接 `fn_confirm_location_for_placement` 的加锁写路径），
这比文档警告更能固化范围边界。

**数据库层遗漏参数（database-reviewer 核实）**：`fn_check_hazard_conflict`/
`fn_confirm_location_for_placement` 都带一个 V1 未提到的可选参数
`p_container_id uuid DEFAULT NULL`（容器兼容性校验），未来接入时不要漏掉。
`fn_list_candidate_locations` 返回粒度是**具体货位**而非货位类型（函数注释
明确这是"提交前概念修正"后的真实设计变化）。

**安全要求（与 4.3 同款，database-reviewer 特别提醒）**：判定原语 RPC 同样对
无租户上下文的会话 fail-closed（`RAISE EXCEPTION`），未来实现时**必须重复
4.3 节"全部方法走带身份调用"的要求**——这是本次核实中发现的一处值得警惕的
自相矛盾：本方案本身是为了修"忘记接身份"的 bug 而写，却在这个小节漏写了同样
的提醒，如果照抄模板容易重蹈覆辙。

**测试要求（若启动）**：反直觉行为必须用真实数据构造后断言，不能只复述文档
描述——例如"同一 `location_type_id` 跨不同库区仍会互相冲突占用"，需要真实
在库区 A 的 location 占用容量到阈值，再查库区 B 同 `location_type` 下的候选，
断言库区 B 结果被库区 A 占用影响。

### 4.5 Track A-2 共同的架构/DI 注意事项（V1 完全遗漏，architect 提出）

- **DI 最小权限**：`SupabaseAdapters`（`src/adapters/supabase/index.ts`）当前
  是 44 个仓储的单例 God Object，device-api 和 tenant-api 用同一份工厂。新增
  4-5 个仓储后，设备端进程会持有平台/租户管理员级写能力的实例，扩大攻击面。
  新仓储应按 app 分组注册，不要无脑追加进同一个大对象。
- **`setTenantId()` 是哑弹**：`WmsSupabaseClient.setTenantId()`（`.ts:176`）
  当前全仓库零调用，但 `SupabaseRpcClient.callWithClient`
  （`.ts:161-168`）会把 `getTenantId()` 的值自动注入任何参数名包含
  `tenant_id` 的 RPC 实参。Track A-2 新增大量带 `p_tenant_id` 参数的 RPC——
  一旦未来有人在多租户进程里调一次 `setTenantId`，就是跨租户数据污染。新增
  RPC 调用一律显式 `injectTenantId: false`；`setTenantId`/自动注入机制列为
  技术债，建议废弃。
- **事务边界**：`WmsSupabaseClient.transaction()` 注释里自己承认不支持事务。
  Track A-2 的多步写操作（`fn_assign_locations_to_location_type` 批量改归属、
  "创建 warehouse→创建 zone→创建 location"主数据链路）**必须整体落在单个 DB
  函数内**由 DBA 侧保证原子性，应用层不得用"连续多次 PostgREST 写"模拟事务。
  如果 DBA 侧没有对应复合函数，这是要提给 DBA 的需求，不是应用层自己拼。

---

## 5. Track B：需要产品/业务决策的重大问题（不拆解为工程任务，V2 补 3 条防线）

### 5.1 决策请求（V1 内容保留，此处只列 V2 新增/修正部分）

**处理方式修正（planner）**：不做代码 PoC（技术可行性已由 DBA 的 SAP EWM/
Dynamics/Odoo/OFBiz/GS1 EPCIS 对标验证过，代码验证不出新信息，反而会诱使团队
在未决语义上写代码）。改为：
1. **需求侧场景剧本访谈**：把 4 个抽象决策问题翻译成具体业务场景（例如："A
   货主和 B 货主的货放在同一个货架上，B 的操作员扫到 A 的箱子会发生什么？他
   能看到 A 的库存数量吗？盘点差异算谁的？A 要求把货移到别的仓库，运营方能
   直接操作还是需要 A 授权？"），拿去问 2-3 个目标客户/行业顾问，1-2 周收敛。
2. **决策 SLA**：建议对齐 Sprint 8 结束设截止日期。
3. **到期默认值**：到期未决则默认按"专属仓单租户模型"继续，写进 ADR，登记到
   `ROADMAP.md` 有 owner、有 due date 的位置（项目里已有多个类似决策悬挂多月
   未关闭的先例，纯文档式请求容易烂尾）。

**新增强制防线（安全维度）**：
4. **Track A-2 新建的表字段/RPC 参数，禁止预留任何多货主/多方语义相关的字段
   或分支**，哪怕注释写"为将来 Track B 准备"——这是本次评审特别强调的一条，
   在决策落地前用"技术准备"名义悄悄开口子，本质上是提前替产品做了决策。
5. **决策问题清单补第 5 条**："查询面必须物理上不可写（视图/RPC 层面强制
   read-only，不依赖应用层自觉）"——常见越权引入路径是"只读聚合视图长出写
   权限"（如给视图加 `INSTEAD OF` 触发器），应在决策阶段钉死，不只停留在架构
   讨论层面。

### 5.2 与本次 PR 的边界

保留 V1 判断：PR #84 本身应按原计划推进，不应被 Track B 决策进度阻塞。

---

## 6. 实施顺序（V2 修正版）

```
第 0 批（当前分支/紧邻 PR，不占 Sprint 预算）
  0.1 Track A-0.1：设备身份桥接 —— ADR 决策 spike（D1/D2/D3 三选一）★阻塞 A-1，不得跳过
  0.2 Track A-0.2：重投 driver 归属决策（建议优先评估 pg_cron，不依赖 0.1 进度）
  0.3 Track A-0.5：database.ts 重新生成 + 处理全仓库编译错误 ★阻塞 A-2 全部
        |
        v
第 1 批
  1.1 Track A-1：身份贯通 + 返回值语义修正 + requireDevicePermission 姊妹修复
       （待 0.1 决策产出后实施；resolveException 部分降级 P2 单独提交）
  1.2 Track A-2.1：ZoneRepository warehouse_id 修复（定性为回归修复，随 A-0.5 同批）
        |
        v
第 2 批（Sprint 6 补丁包，不新起 Sprint 编号）
  2.1 Track A-2.2：Warehouse/LocationType 仓储 + API
       验收 = 新租户不靠 DBA 手工 SQL 走完"建仓→建区→建库位→收第一批货"
        |
        v
第 3 批（条件触发，不进固定排期）
  3.1 Track A-2.3 StorageCompliance：冷链/危险品意向客户出现或合规审计要求时启动
  3.2 Track A-2.4 判定原语：Sprint 7 跑通、有真实作业数据后再评估，当前登记 backlog
        |
并行（不阻塞以上任何一项，但 Track A-2 编码期间必须遵守 §5.1 第 4 条防线）
  B.1 Track B 需求侧场景剧本访谈 → 2-3 个客户/顾问 1-2 周收敛
  B.2 决策 SLA（对齐 Sprint 8 结束）+ 默认值（专属仓单租户模型）
  B.3 登记进 ROADMAP.md 带 owner/due date 的位置
```

---

## 7. 给执行子会话的检查清单（V2 修订）

在开始任何任务前：

1. **先确认当前要做的任务属于第几批**（第 0 批）。**如果任务属于 Track A-1
   但 Track A-0.1 尚未有 ADR 决策产出，停止，不要凭自己判断选一个方案实施**
   ——这正是 V1 会被三个独立 agent 一致打回的原因。
2. 确认本地环境：`supabase start`，从 HiWmsSupabase 同步最新 `supabase/` 目录
   （迁移 + `bootstrap-*.sql` 权限脚本 + `seed.sql`），按顺序应用
   `bootstrap-default-privileges.sql`（迁移前）→ `supabase db reset` →
   `bootstrap-roles.sql`（迁移后）。
3. Track A-0.5（`database.ts` 重新生成）**必须在任何 Track A-2 编码前完成**，
   完成后先跑一次 `tsc --noEmit` 评估影响面，不要假设只影响新增代码。
4. 读取本文档对应章节的"背景"小节，不需要重新调研 DBA 设计文档（除非引用的
   行号/文件在最新代码里已不存在，那种情况下需要重新核实并更新本文档）。
5. 涉及函数签名/返回值契约变更、新增/修改客户端可见调用路径——走独立
   `ecc:code-review` 评审，不能自审自过。**Track A-0.1 的身份桥接机制额外
   需要架构+安全+TDD 并行的多视角评审**，不是常规代码 review 能替代的。
6. 提交前对照 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md`（如涉及新
   `.sql` 文件；纯应用层 TS 改动不适用，但仍需遵循 `.claude/rules/ecc/` 标准
   评审流程）。
7. **任何时候发现自己在 Track A-2 的表字段/RPC 参数设计里想"顺便"加一个为
   将来多货主场景准备的字段——停下，这违反 §5.1 第 4 条防线，应在评审中被拦截。**
