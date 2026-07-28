/**
 * Device API 公开认证路由（无需先持有设备凭证）
 * - POST /device/auth/login   - API Key 换 Access/Refresh Token
 * - POST /device/auth/refresh - Refresh Token 换新 Access Token
 *
 * 必须挂载在 DeviceAuthMiddleware.authenticate 之前：这两个端点本身就是
 * "获取凭证"的入口，如果被要求先持有 Authorization/X-API-Key header 才能
 * 到达处理函数，设备将永远无法完成首次登录（鸡生蛋悖论）。修复
 * 2026-07-27：main.ts 此前把整个 createDeviceApiRouter（含本文件抽出前的
 * login/refresh）统一挂在 deviceAuthMiddleware.authenticate 之后，导致
 * login/refresh 端点在生产环境下恒返回 401，经真实 HTTP 请求验证确认。
 */
import { Router, Request, Response } from 'express';
import { DeviceApiDependencies } from './di';
import { validateRequest, deviceAuthLoginSchema, deviceAuthRefreshSchema } from './validation';
import {
  issueTokenPair,
  verifyAndRotateRefreshToken,
  verifyApiKeySecret,
  parseApiKey,
  DEFAULT_DEVICE_CREDENTIALS_CONFIG,
  sharedTenantSigningKeys,
  type DeviceCredentialsConfig,
} from './auth/device-credentials';

export function createDevicePublicAuthRouter(deps: DeviceApiDependencies): Router {
  const router = Router();
  const { supabaseAdapters } = deps;

  // jwtIssuer/jwtAudience 必须与 main.ts 里 DeviceAuthMiddleware 使用的 deps.config.device.*
  // 保持一致（同一份 config 对象），不能各自取 DEFAULT_DEVICE_CREDENTIALS_CONFIG 的硬编码值——
  // 后者是 'hiwms'，而 loadDeviceApiConfig() 在 DEVICE_JWT_ISSUER 环境变量未设置时的真实默认值
  // 是 'hiwms-device-api'，两者不一致会导致登录签发的 token 在 Bearer 验证时因 iss claim
  // 不匹配恒 401（2026-07-28 经代码核查确认：全仓库包括 .env.example 均未设置过该环境变量）。
  const credentialsConfig: DeviceCredentialsConfig = {
    ...DEFAULT_DEVICE_CREDENTIALS_CONFIG,
    jwtIssuer: deps.config.device.jwtIssuer,
    jwtAudience: deps.config.device.jwtAudience,
    tenantSigningKeys: sharedTenantSigningKeys,
  };

  /**
   * POST /device/auth/login
   * API Key 换 Access Token + Refresh Token
   */
  router.post('/device/auth/login',
    validateRequest({ body: deviceAuthLoginSchema }),
    async (req: Request, res: Response) => {
      try {
        const { device_id, api_key, fcm_token } = req.body;

        // 解析 API Key
        const parsed = parseApiKey(api_key, credentialsConfig.apiKeyPrefix);
        if (!parsed || parsed.deviceId !== device_id) {
          return res.status(401).json({ error: 'Authentication failed' });
        }

        // 查询设备并验证 secret_hash
        const { data: device, error } = await supabaseAdapters.client.getAdminClient()
          .from('devices')
          .select('id, tenant_id, is_active, secret_hash, device_type, device_code')
          .eq('id', device_id)
          .single();

        // 统一错误响应，防止设备 ID 枚举和状态泄露
        if (error || !device || !device.is_active || !device.secret_hash) {
          return res.status(401).json({ error: 'Authentication failed' });
        }

        // 验证 API Key secret
        const isValid = await verifyApiKeySecret(parsed.secret, device.secret_hash);
        if (!isValid) {
          return res.status(401).json({ error: 'Authentication failed' });
        }

        // 签发 Token 对
        const tokenPair = await issueTokenPair(device.id, device.tenant_id!, credentialsConfig);

        // 更新 FCM token（如果提供）
        if (fcm_token) {
          // TODO: 存储 FCM token 用于推送通知
        }

        res.json({
          success: true,
          data: {
            access_token: tokenPair.accessToken,
            refresh_token: tokenPair.refreshToken,
            expires_in: tokenPair.accessTokenExpiresIn,
            refresh_expires_in: tokenPair.refreshTokenExpiresIn,
            token_type: tokenPair.tokenType,
            server_time: new Date().toISOString(),
            tenant_id: device.tenant_id,
            device_config: {
              sync_interval_sec: 30,
              auto_sync_on_wifi: true,
              max_offline_days: 7,
              features: ['picking', 'packing', 'receiving', 'inventory', 'shipping'],
            },
            permissions: ['inventory:read', 'work_order:execute', 'task:complete'],
          },
          meta: { request_id: `req_${Date.now()}`, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        console.error('POST /device/auth/login error:', error);
        res.status(500).json({ error: 'Login failed' });
      }
    });

  /**
   * POST /device/auth/refresh
   * Refresh Token 换新 Access Token
   */
  router.post('/device/auth/refresh',
    validateRequest({ body: deviceAuthRefreshSchema }),
    async (req: Request, res: Response) => {
      try {
        const { refresh_token } = req.body;

        // 验证 Refresh Token 并轮换
        const tokenPair = await verifyAndRotateRefreshToken(refresh_token, credentialsConfig);
        if (!tokenPair) {
          return res.status(401).json({ error: 'Authentication failed' });
        }

        res.json({
          success: true,
          data: {
            access_token: tokenPair.accessToken,
            refresh_token: tokenPair.refreshToken,
            expires_in: tokenPair.accessTokenExpiresIn,
            refresh_expires_in: tokenPair.refreshTokenExpiresIn,
            token_type: tokenPair.tokenType,
            server_time: new Date().toISOString(),
          },
          meta: { request_id: `req_${Date.now()}`, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        console.error('POST /device/auth/refresh error:', error);
        res.status(500).json({ error: 'Token refresh failed' });
      }
    });

  return router;
}
