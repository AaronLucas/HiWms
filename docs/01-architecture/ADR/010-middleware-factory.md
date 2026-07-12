# ADR-010: Express 中间件工厂统一横切关注点

## 状态
✅ Accepted (2026-07-09)

## 背景
四个 API 入口（Admin、Tenant、Device、Worker）共享大量横切关注点：
- 认证（JWT 验证、Device Token、Service Role）
- 租户解析（Header、JWT claims、设备关联）
- RLS 上下文注入（PostgREST `x-tenant-id` Header）
- 权限检查（RBAC：resource + action + scope）
- 限流（IP/用户/租户维度）
- 缓存（GET 请求自动缓存、Key 构建）
- 请求追踪（`X-Request-ID` 生成/透传）
- 统一错误处理（AppError 映射 HTTP 状态码、结构化响应）

历史痛点：
- 各入口复制粘贴中间件代码，参数不一致
- 认证逻辑分散：Admin 用 Service Role、Tenant 用 Anon+JWT、Device 用 Device Token、Worker 用 Header
- RLS 注入遗漏导致跨租户数据泄露风险
- 错误响应格式不统一（有的返回 `{error}`、有的 `{message}`、有的 `{code, details}`）
- 限流/缓存策略无法集中配置

## 决策
实现 **ExpressMiddlewareFactory** 单例工厂，集中封装所有横切关注点，四端入口仅组装中间件栈。

### 核心设计
```typescript
class ExpressMiddlewareFactory {
  constructor(
    private authProvider: IAuthProvider,           // 统一认证：signIn/verifyToken/getUser
    private permissionChecker: IPermissionChecker, // 权限检查：check(userId, resource, action, scope)
    private tenantResolver: ITenantResolver,       // 租户解析：resolveTenantId(userId, header?)
    private cacheProvider: ICacheProvider,         // 缓存：get/set/delete/invalidatePattern
    private keyBuilder: ICacheKeyBuilder           // Key 标准化：buildTenant()/buildProduct()/...
  )

  // 1. 请求追踪（必选，最外层）
  correlationId(): RequestHandler

  // 2. 认证（三端复用，策略可配置）
  authenticate(options?: { allowDeviceToken?: boolean; allowServiceRole?: boolean }): RequestHandler

  // 3. 租户解析（认证后自动运行）
  resolveTenant(): RequestHandler

  // 4. RLS 上下文注入（Tenant/Device API 必选）
  injectRlsContext(): RequestHandler

  // 5. 权限守卫（路由级装饰）
  requirePermission(resource: string, action: string, scope?: 'tenant' | 'platform'): RequestHandler

  // 6. 限流（可配置 key 生成器、窗口、上限）
  rateLimit(options: { windowMs: number; max: number; keyGenerator?: (req) => string }): RequestHandler

  // 7. 响应缓存（仅 GET、可配置 TTL、Key 生成）
  cache(options: { ttl: number; keyGenerator?: (req) => string }): RequestHandler

  // 8. 统一错误处理（必选，最内层）
  errorHandler(): RequestHandler
}
```

### 四端中间件栈组装
| 入口 | 文件 | 栈顺序（外→内） | 关键差异 |
|------|------|-----------------|----------|
| **Admin API** | `apps/admin-api/main.ts` | `correlationId` → `authenticate({allowServiceRole:true})` → `platformAdminGuard` → `auditLog` → `errorHandler` | Service Role 认证、无 RLS、平台超管守卫、审计日志 |
| **Tenant API** | `apps/tenant-api/main.ts` | `correlationId` → `authenticate()` → `resolveTenant()` → `injectRlsContext()` → `rateLimit` → `errorHandler` | Anon+JWT、RLS 开启、租户级限流 |
| **Device API** | `apps/device-api/main.ts` | `correlationId` → `authenticate({allowDeviceToken:true})` → `resolveTenant()` → `injectRlsContext()` → `errorHandler` | Device Token、离线同步大 body(50MB)、无限流 |
| **CF Worker** | `apps/worker/index.ts` | 无 Express、轻量实现：`verifyToken` → `checkPermission`(Edge RPC) → `KV.get/set` | 边缘运行时、无中间件链、仅只读缓存+权限代理 |

### 关键接口契约（注入工厂的端口）
```typescript
// 认证端口
interface IAuthProvider {
  signIn(email, password): Promise<AuthResult>
  verifyToken(token): Promise<UserContext | null>
  getUser(userId): Promise<User | null>
  refreshToken(refreshToken): Promise<AuthResult>
}

// 权限端口
interface IPermissionChecker {
  check(userId, resource, action, scope?): Promise<boolean>
}

// 租户端口
interface ITenantResolver {
  resolveTenantId(userId, headerTenantId?): Promise<string>
  isPlatformAdmin(userId): Promise<boolean>
}
```

## 后果

### 正面
- **零重复**：四端共享同一套中间件实现，参数一致性 100% 保证
- **安全基线**：RLS 注入、租户解析、权限检查强制在工厂内实现，无法被入口遗漏
- **可观测性统一**：`X-Request-ID` 全链路透传、错误格式统一、审计日志标准化
- **配置集中**：限流阈值、缓存 TTL、Key 策略在工厂构造时统一配置
- **测试简单**：中间件单元测试覆盖工厂方法，入口仅需集成测试组装正确性

### 负面
- 工厂构造函数依赖 5 个端口，初始化样板代码稍多
- Worker 边缘运行时无 Express，需单独实现轻量版（`WorkerPermissionChecker`、`WorkerTenantResolver`、`KvCacheProvider`）
- 中间件顺序错误会导致安全漏洞（如 `injectRlsContext` 在 `resolveTenant` 前运行），需代码审查守护

## 实施细节
- `src/adapters/express/ExpressMiddlewareFactory.ts` — 核心实现（~300 行）
- 每个中间件方法返回标准 `RequestHandler`，可直接 `router.use(factory.authenticate())`
- `requirePermission` 返回闭包中间件，读取 `req.context.user.id` + `req.context.tenantId`
- `injectRlsContext` 设置 `req.supabaseHeaders = { 'x-tenant-id': tenantId }`，`SupabaseClient` 拦截器自动读取
- 错误处理统一映射：
  ```typescript
  // AppError(code, statusCode) → { error: code, message, details, requestId, timestamp }
  // ZodError → VALIDATION_ERROR (400)
  // PostgrestError(code='PGRST301') → RLS_POLICY_VIOLATION (403)
  // 默认 → INTERNAL_ERROR (500)
  ```

## 相关文档
- `ARCHITECTURE.md` — 中间件工厂架构位置、四端栈对比表
- `API_SPEC.md` — 各端认证 Header、错误码表
- `CONVENTIONS.md` — 中间件使用规范、禁止直接写中间件
- `src/adapters/express/ExpressMiddlewareFactory.ts` — 实现代码
- `apps/*/main.ts` — 四端组装示例

---

*决策者：主工程师 | 评审：架构组 | 生效日期：2026-07-09*