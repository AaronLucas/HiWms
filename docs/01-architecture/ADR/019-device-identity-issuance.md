# ADR-019：设备身份签发子系统设计（注册/签发/轮换/吊销）

**状态**：设计已定稿（2026-07-23，项目负责人确认），待实施
**日期**：2026-07-23

## 背景

ADR-018 修复"解决人身份不再信任 `req.body`"时，独立评审（`ecc:architect`/
`ecc:security-reviewer`）发现更根本的问题：`DeviceAuthMiddleware` 从未验证
设备 JWT 签名/API Key secret——**不是验证逻辑写错了，是签发这一侧从来没有
被设计实现过**。`docs/02-api/DEVICE_PROTOCOL_SPEC.md` 早就在纸面上设计过
注册/登录/刷新三个接口（标注"草案待评审"），但既没有应用层代码，也没有
数据库 schema 支撑，且从未提交给 DBA 团队评估（`docs/03-database/
DBA_ADDENDUM_REQUEST_DEVICE_IDENTITY_2026-07-23.md` 已补交这个请求）。

项目目前处于开发阶段、尚未上线，这是"设计并补齐一个从未存在过的子系统"，
不是修复线上事故。

## 决策

### 凭证分层（三层，各自用途不同）

| 层级 | 生命周期 | 用途 | 使用时机 |
|---|---|---|---|
| API Key（长期，"密钥"） | 直到轮换/吊销 | 设备身份本身 | 只在登录/重新登录时用一次 |
| Refresh Token（中期） | 7 天 | 换发新 Access Token | Access Token 过期后静默换新 |
| Access Token（短期） | 15 分钟 | 实际业务请求 | 每次调用 device-api |

设备离线时不需要任何凭证（本地队列，见 `PDA_OFFLINE_SYNC_DESIGN.md`）；重新
联网时优先用 Refresh Token 静默续期，Refresh Token 也过期了才退回用 API Key
重新登录——全程不需要人工介入，7 天有效期已经过项目负责人确认足够覆盖正常
离线场景（区别于合规策略里的 `max_offline_duration_seconds`，那是另一套业务
规则，与令牌过期无关）。

### 密钥独立性（2026-07-23 确认）

- **API Key：按设备独立**（`hiwms_dk_<device_id>_<随机数>`，服务端只存哈希，
  见 addendum 请求 1）——这是设备身份本身，泄露只影响这一台设备。
- **Access/Refresh Token 的签名密钥：按租户独立**（不是全局共享，也不是
  按设备）——理由：真正的设备身份边界已经由 API Key 承担；如果签名密钥也要
  做到按设备独立，意味着每次验签前先要查出"这个 token 声称是哪台设备"再
  决定用哪把密钥验证，等于把签名密钥体系并入了 API Key 体系本身，增加大量
  密钥管理/轮换编排的复杂度，换来的收益边际很小（因为设备身份的独立性已经
  由 API Key 提供）。按租户独立签名密钥是两者之间的平衡点：一个租户的签名
  密钥泄露不会波及其他租户，同时不需要为每台设备单独管理签名密钥的生命周期。
  **这是本 ADR 明确做出的折中决定，不是回避独立密钥的要求**——如果未来发现
  按租户还不够（例如某个租户内部也需要设备间隔离），可以在此基础上升级到
  按设备，代价是需要引入类似 API Key 的密钥查找机制。

### 注册/配发流程

- **租户自助配发**（2026-07-23 确认）：租户运营角色可自行注册本租户设备，
  不需要走平台运营工单。需要新增 RBAC `devices` 资源（见 addendum 请求 2）。
- **注册端点从 device-api 移到需要人类登录态的接口**：原草案把
  `POST /device/provision` 放在 device-api 自身，存在"设备还没有身份却要用
  设备身份认证"的先有鸡还是先有蛋问题，本次修正为挂在人类用户认证的接口上
  （管理员/租户运营人员登录后操作）。

### 密钥分发到物理设备

**二维码一次性配对**：管理界面生成配发结果后，展示一次性、短 TTL 的二维码
（编码 `device_id` + API Key），PDA 首次启动时用摄像头/内置扫码枪扫码完成
绑定。仓库手持设备普遍自带摄像头/扫码枪，比手动输入长密钥可靠。手动输入作为
兜底方案保留，MDM 批量推送作为未来阶段选项（当前不存在 MDM 基础设施）。

### 轮换/吊销

- 不对长期 API Key 做强制定期轮换（仓库地板设备可能长期绑定同一物理终端，
  强制轮换与"多日离线"的现实场景冲突）；轮换只在怀疑泄露时手动触发。
- 需要一个真正的"上报设备丢失/被盗"工作流，而不是只有管理员手动关
  `is_active`——触发人：租户运营角色（贴近一线，响应快）+ 平台运营可越权
  处理；触发后台需要一次性作废该设备 `secret_hash`（改写为新哈希或标记
  失效）+ 记录触发人/时间。

## 应用层 vs DBA 层划分

**应用层（wms7 直接实现）**：`POST /device/provision`（挂在人类登录态接口
上）、`POST /device/auth/login`、`POST /device/auth/refresh`、密钥生成与
哈希、JWT 签名验证修复（`jose`，算法锁定 HS256，拒绝 `alg: none`）、修复
`SupabaseDeviceRepository.ts` 现有的字段漂移（查询了 `code`/`status`/
`current_task_id`/`last_heartbeat_at` 等 `devices` 表里不存在的列）。

**DBA 层（`HiWmsSupabase`，已提交 `DBA_ADDENDUM_REQUEST_DEVICE_IDENTITY_
2026-07-23.md`）**：`devices.secret_hash`/`secret_rotated_at` 两列；RBAC
`devices` 权限资源行。

## 与 ADR-018 的关系

ADR-018 解决的是"解决人身份不该信任 `req.body`"，前提是 `req.context.userId`
本身可信；ADR-019 解决的正是"这个前提目前不成立"的根本问题（设备身份从未
被真正签发/验证过）。ADR-018 的价值不受影响——即使设备身份验证还没修好，
"客户端不能在请求体里直接指定任意 resolver 身份"这条防线依然值得先收紧；
两者是同一条信任链上下游两个独立的加固点。

## 尚待实施（不阻塞本设计定稿）

- `SupabaseDeviceRepository.ts` 字段漂移修复
- 密钥生成/哈希/JWT 验签的具体代码实现
- 二维码配对流程的前端/PDA 端实现（不在本仓库范围内，需与 PDA 客户端团队
  对齐）
- DBA 团队处理 addendum 请求后，回填 `secret_hash` 相关的应用层调用代码

## 关联文档

- `docs/01-architecture/ADR/018-resolver-identity-trust-fix.md`
- `docs/03-database/DBA_ADDENDUM_REQUEST_DEVICE_IDENTITY_2026-07-23.md`
- `docs/02-api/DEVICE_PROTOCOL_SPEC.md` §2.1/§2.2/§7.1（草案设计来源）
- `docs/01-architecture/ARCHITECTURE.md` §11
