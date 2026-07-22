# DBA Addendum 请求 —— 设备身份签发子系统 schema 缺口（2026-07-23）

> **性质**：新功能使能请求，不是对已有迁移的缺陷复核（区别于同日的
> `DBA_ADDENDUM_REQUEST_2026-07-23.md`，那份是对迁移 009-016 的复核）。
> **只读请求**——本文档不修改、不触碰 `HiWmsSupabase` 仓库任何文件，具体 DDL
> 由 DBA 团队编写。
>
> **背景（为什么这个缺口从来没被发现过）**：`docs/02-api/DEVICE_PROTOCOL_SPEC.md`
> 早就在纸面上完整设计过设备注册（§7.1 `POST /device/provision`）、登录
> （§2.1 `POST /device/auth/login`）、刷新令牌（§2.2）三个接口，且标注为
> "草案待评审"。但这份草案从未真正落地——既没有对应的应用层代码实现（`src/apps/
> device-api/` 里完全没有这几个端点），对应的数据库列也从未存在过，
> **也没有人把这个 schema 缺口提交给 DBA 团队评估**（本项目的架构文档索引里
> 直到本次复核之前都没有任何一份 ADR/Addendum 提到过这件事）。本次是在排查
> `DeviceAuthMiddleware` 验签缺失问题时，顺带发现草案与真实代码/schema 状态
> 完全对不上，才第一次把这个缺口正式记录下来。

---

## 背景问题：设备身份认证目前只有"验证"没有"签发"

`src/apps/device-api/DeviceAuthMiddleware.ts` 试图验证设备 JWT/API Key，但：
1. JWT 签名验证从未实现（另案，见 `docs/01-architecture/ADR/018-resolver-identity-trust-fix.md`「已知遗留问题」）。
2. **无论签名验证修不修，API Key 认证从一开始就无法工作**——因为 `devices`
   表压根没有任何列可以存储/比对密钥。

本项目目前处于开发阶段、尚未正式上线，这是一次"把缺失的功能设计补齐"的请求，
不是紧急安全事件。

---

## 请求 1：`devices` 表补充密钥存储列

**对应现有表**：`devices`（`001_enterprise_core_schema.sql`，当前列：`id`,
`device_code`, `device_type`, `tenant_id`, `is_active`, `created_at`,
`updated_at`）

**需求**：按 `docs/02-api/DEVICE_PROTOCOL_SPEC.md` §7.1 的既有设计，每台设备在
"注册/绑定"时会拿到一把形如 `hiwms_dk_<device_id>_<随机数>` 的密钥。**已经过
项目负责人确认（2026-07-23）：按设备独立**（不共享），理由：多租户 SaaS 场景
下单点泄露不应该波及其他租户/设备。这把密钥服务端只应存哈希，不存明文。

**请求的修复方向**：
```sql
ALTER TABLE devices
  ADD COLUMN secret_hash TEXT,
  ADD COLUMN secret_rotated_at TIMESTAMPTZ;
```
- `secret_hash`：存储密钥的哈希值（哈希算法由 DBA 团队决定，应用层配合，建议
  argon2/bcrypt 而非可逆加密）
- `secret_rotated_at`：记录密钥最近一次轮换时间，供"密钥轮换前签发的令牌是否
  应该被拒绝"这类判断使用（不必等旧令牌自然过期）

**是否需要 RLS/GRANT 复核**：`secret_hash` 列绝不能被 `anon`/`authenticated`
读到——请在加列的同时确认 `devices` 表现有 RLS 策略（若有）覆盖到这个新列，
或者这条读取路径本来就该走 `service_role`/专用 RPC，不依赖行级策略。

---

## 请求 2：RBAC 补充 `devices` 权限资源

**背景**：`docs/03-database/DB_SCHEMA.md` 现有的 `permissions`/`role_permissions`
覆盖 products/orders/inventory/waves/tenants 等资源，**没有 `devices` 这个
资源**——意味着"谁能注册/管理设备"这件事目前没有 RBAC 可以挂载。

**已确认的业务方向（2026-07-23，项目负责人拍板）**：采用**租户自助配发**模式
——租户运营角色可以自行注册/管理本租户的设备，而不是必须走平台运营工单。

**请求的修复方向**：
```sql
-- 新增资源行（具体命名/粒度由 DBA 团队按现有 permissions 表约定决定）
-- resource: 'devices', actions: CREATE/READ/UPDATE/DELETE
```
授权对象：租户范围内的运营角色（tenant-scoped，通过既有 `user_roles` 机制），
而非只授予平台级角色——这是与此前 `products`/`orders` 等资源一致的租户自助
模式，不需要新的权限体系。

---

## 暂不请求的部分（应用层自己处理，供 DBA 团队知情）

- 设备注册/签发/刷新三个端点本身（`POST /device/provision`、
  `POST /device/auth/login`、`POST /device/auth/refresh`）是应用层
  代码，不需要 DBA 改动。注册端点将从 device-api 移到需要人类登录态的接口上
  （原草案把 `/device/provision` 放在 device-api 自身，存在"设备还没有身份
  却要用设备身份认证"的先有鸡还是先有蛋问题，本次一并修正）。
- JWT 签名验证修复（`jose`/`jsonwebtoken` 接入，会话令牌 15 分钟、刷新令牌
  7 天，已经过项目负责人确认）是应用层代码。
- 密钥轮换的具体触发条件（"上报设备丢失"由谁操作）是应用层 RBAC + 业务
  流程决定，不影响本请求的两处 schema 加列。

---

## 处理建议

两处 schema 请求相对独立、风险可控（新增可空列 + 新增权限资源行，不改变任何
既有列的语义），可以合并成一次迁移处理，也可以分开。请按 DBA 团队自有的
`design-docs/unWMS_PR_Pre_Submission_Checklist_V1.md` 逐条自查并附验证证据。

**关联文档**：`docs/01-architecture/ADR/018-resolver-identity-trust-fix.md`
「已知遗留问题」（发现本缺口的起因）；`docs/01-architecture/ARCHITECTURE.md`
§11；`docs/02-api/DEVICE_PROTOCOL_SPEC.md` §2.1/§2.2/§7.1（草案设计来源）；
ADR-019（设备身份签发子系统，2026-07-23 定稿）；
[HiWmsSupabase#19](https://github.com/AaronLucas/HiWmsSupabase/issues/19)（本文档的镜像 Issue）。
