# ADR-018：异常处理"解决人身份"改为从已验证会话派生，不再信任调用方自报

**状态**：应用层已实施（含独立评审发现的第 4 处遗漏路由已补齐）；数据库层防御性
加固已提交 DBA Addendum 请求，待 DBA 团队处理
**日期**：2026-07-23

> **⚠️ 2026-07-23 独立评审重要澄清（不要略过）**：本文档标题里的"已验证会话"
> 措辞过强，需要澄清范围。独立评审（`ecc:code-reviewer`，见 PR #42 评审记录）
> 发现 `DeviceAuthMiddleware.ts` **从未真正校验设备 JWT 的签名**（`verifyDeviceToken`
> 内有 `// TODO: 实际验证签名`，2026-07-17 引入，早于本次改动）——API Key 路径
> 的 secret 分量同样没有对任何存储值做校验（`devices` 表压根没有 secret/hash 列）。
> 也就是说 `req.context.userId`/`tenantId` 目前**并不是密码学意义上"已验证"**的
> 身份，本 ADR 只解决了"客户端能否在请求体里直接指定任意 `resolver_user_id`"
> 这一层——如果设备 JWT 本身可以被伪造，那么连 `req.context.userId` 自己都不可信，
> 是一个范围更大、更根本的问题，不在本 ADR 处理范围内，已作为独立的 CRITICAL 项
> 跟踪（见文末「已知遗留问题」）。本 ADR 的价值仍然成立——它消除了"即使设备认证
> 将来补上签名校验，客户端也还能在请求体里绕过它自称身份"这一路径——但不应该
> 被理解为"resolver 身份现在已经端到端可信"。

## 背景

对 `HiWmsSupabase`（DBA 团队独立维护，本仓库只读）迁移 009-016 做跨仓库复核时，
发现 `fn_resolve_exception`（005 引入，未被 009-016 任一版本修正）存在一个身份
信任问题：它把"谁解决了这个异常"（`p_resolver_user_id`）作为**调用方直接传入
的参数**，而不是从可信的会话上下文推导——与 013 修复的 `check_user_permission`
跨租户信息泄露是同一类漏洞模式（"SECURITY DEFINER/信任边界内的函数信任调用方
自称的身份，而不是校验真实身份"）。

进一步核实发现，这不只是一个数据库层的理论风险：

1. `fn_resolve_exception` 目前**没有直接对应的 HTTP 路由**（`resolveException()`
   TS 封装存在，但 device-api/admin-api 都没有接 `/exceptions/{id}/resolve`）。
2. 但 `fn_confirm_label_applied`（004）与 `fn_identify_unidentified_goods`（004）
   两个函数**内部会调用 `fn_resolve_exception` 关闭异常**（见
   `src/__tests__/integration/exceptions/fn_generate_internal_lpn.concurrency.test.ts`
   / `fn_receive_unidentified_goods.concurrency.test.ts` 的注释确认），而这两个
   函数**已经通过 `POST /missing-label/confirm`、`POST /unidentified/identify`
   两条真实可达的 device-api 路由暴露在外**。
3. 核对这两条路由的实现（`src/apps/device-api/routes.ts`）发现：`resolver_user_id`
   直接从 `req.body` 读取，而不是从 `DeviceAuthMiddleware` 已验证、挂在
   `req.context.userId` 上的真实设备/用户身份派生——**应用层本身就已经把这个
   漏洞模式暴露在生产可达的 API 上**，不是"数据库层有个理论缺口，应用层没碰到"。
   `POST /unidentified/receive`（`actor_user_id`，不经过 `fn_resolve_exception`，
   但是同一套身份来源问题）也是同样写法。

## 决策

**分两层处理，应用层立即修复、数据库层走既有的跨仓库 addendum 流程：**

### 应用层（本仓库，已实施）

`src/apps/device-api/routes.ts` 的 `POST /missing-label/confirm`、
`POST /unidentified/receive`、`POST /unidentified/identify`，以及独立评审发现
遗漏的第四条同类路由 `POST /missing-label/generate`（`actor_user_id`，供
`fn_generate_internal_lpn` 使用），共四条路由不再从 `req.body` 读取
`resolver_user_id`/`actor_user_id`，改为：

```ts
const resolverUserId = (req as any).context?.userId;
if (!resolverUserId) {
  return res.status(400).json({ error: 'user_id not available in context, cannot record resolver identity' });
}
```

`confirm`/`identify` 两条路由要求 `context.userId` 必须存在（原 schema 就是必填
字段，语义上"必须知道是谁解决的"）；`receive` 路由保持 `actorUserId` 可选（原
`unidentifiedReceiveSchema` 就是 `.optional()`——纯 API Key 设备认证场景下
`context.userId` 本就可能不存在，这是既有的合法场景，不是本次要收紧的对象）。

配套修改 `src/apps/device-api/validation.ts`：从
`missingLabelConfirmSchema`/`unidentifiedReceiveSchema`/`unidentifiedIdentifySchema`
三个 Zod schema 中移除 `resolver_user_id`/`actor_user_id` 字段。由于这几个
schema 都没有用 `.strict()`，Zod 默认剥离未声明字段——老客户端继续在请求体里
传这个字段不会报错，只是不再被采信，是非破坏性变更。

**验证**：`npx tsc --noEmit` 零错误（唯一报错是 `supertest` 模块未安装，
`git diff` 确认与本次改动无关的预先存在环境问题）；`npx vitest run` 59
个既有非 DB 用例全部通过，无回归（相关测试直接调用 repository 方法，不经过
这几条路由，不受影响）。

### 数据库层（`HiWmsSupabase`，DBA 团队所有权范围，只提请求不改代码）

`fn_resolve_exception` 本身仍然信任 `p_resolver_user_id` 参数，没有独立于应用层
的防御。应用层修复后，今天已知的两条可达路径已经收口，但如果未来有新的调用方
（内部工具、直接 RPC、新路由）绕开这几个 Express 中间件直接调用
`fn_resolve_exception`，同样的问题会重演。已通过
`docs/03-database/DBA_ADDENDUM_REQUEST_2026-07-23.md`「新发现 1」正式提出，
参照 013 `check_user_permission` 的修复模式（不信任参数，从会话身份推导 /
显式比对）作为方向性建议，具体 DDL 由 DBA 团队决定。

## 为什么不等 DBA 修完数据库层再动手

应用层的漏洞是**今天真实可达**的，而数据库层修复需要 DBA 团队评估、走迁移
流程、需要时间。应用层收紧是本仓库自己的代码、低风险、不改变合法调用方的
行为（就是把"客户端自报身份"换成"服务端已验证身份"，对遵守协议的客户端
无感），没有理由等数据库层修完才做——两层修复独立生效，互不依赖，都到位后
才是完整的纵深防御。

## 替代方案考虑

- **只等 DBA 修数据库层，应用层不动**：否决。数据库层修复时间不可控，而应用层
  漏洞已经可达，拖延窗口期没有必要的收益。
- **应用层用 `RAISE EXCEPTION` 让 DB 层拒绝不匹配的身份（复刻 013 模式）**：
  数据库层不做，理由见上——这是数据库层该做的事，应用层的修复是"根本不给
  客户端伪造身份的机会"，比"传了假身份、数据库层再拒绝"更彻底，两者不冲突，
  数据库层修复仍建议 DBA 补上作为纵深防御。
- **把 `resolver_user_id`/`actor_user_id` 做成 `.strict()` schema 直接拒绝多余
  字段**：否决——会让老客户端（仍在 body 里传这个字段的）请求 422 失败，
  是不必要的破坏性变更；默认剥离已经能达到"不采信"的效果。

## 已知遗留问题（2026-07-23 独立评审发现，不在本 ADR 范围内解决）

- **CRITICAL——`DeviceAuthMiddleware` 从未真正验证设备 JWT 签名/API Key
  secret**：见文首澄清。这比本 ADR 解决的问题更根本——如果设备身份本身可以
  伪造，`tenantId`/`userId` 的可信度都要打问号，影响面不限于异常处理流程。
  需要独立立项（建议 ADR-019），且需要架构/安全视角的多方评审，不应该在这份
  ADR 里顺手带过。**这是否已经在生产环境造成实际暴露，取决于 device-api 目前
  的部署/网络暴露面——需要产品/运维侧确认，不是纯工程问题能单方面判断的。**
- Phase 5-7 集成测试目前没有覆盖这三/四条路由新增的 400 守卫分支，也没有测试
  "客户端传入的 `resolver_user_id`/`actor_user_id` 会被忽略"这一行为本身
  （独立评审 MEDIUM 项）。

## 关联文档

- `docs/03-database/DBA_ADDENDUM_REQUEST_2026-07-23.md`「新发现 1」
- `docs/01-architecture/ARCHITECTURE.md` §11「待决策架构问题」
- `docs/00-project/ROADMAP.md`「HiWmsSupabase 009-016 跨仓库综合分析与任务规划」架构视角 P0
- ADR-015（登录/注册身份模型桥接，同一类"身份来源是否可信"问题的姊妹篇）
- PR #42 独立评审记录（`ecc:code-reviewer`，2026-07-23）——发现遗漏路由 +
  JWT 验证缺失 + 测试覆盖缺口
