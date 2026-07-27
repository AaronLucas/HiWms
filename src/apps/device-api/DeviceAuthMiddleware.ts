/**
 * Device 认证中间件
 * 专门用于 PDA/手持终端设备认证
 * 支持两种认证方式：
 * 1. Device JWT (Authorization: Bearer <token>)
 * 2. API Key (X-API-Key: <key>)
 *
 * 认证流程：
 * 1. 解析 token/key
 * 2. 验证签名、过期时间、issuer、audience
 * 3. 从 devices 表查询设备信息，验证设备绑定租户且激活
 * 4. 将 device_id, tenant_id, user_id 注入 req.context
 * 5. 设置 RLS 所需的 x-tenant-id header
 */

import type { Request, Response, NextFunction } from 'express';
import { IAuthProvider } from '../../core/ports/auth/IAuthProvider';
import { ITenantResolver } from '../../core/ports/auth/ITenantResolver';
import { WmsSupabaseClient } from '../../adapters/supabase/SupabaseClient';
import type { Database } from '../../types/database';
import {
  verifyDeviceToken,
  verifyApiKeySecret,
  parseApiKey,
  type DeviceTokenPayload,
  type DeviceCredentialsConfig,
  DEFAULT_DEVICE_CREDENTIALS_CONFIG,
  sharedTenantSigningKeys,
} from './auth/device-credentials';

export interface DeviceAuthConfig extends Omit<DeviceCredentialsConfig, 'tenantSigningKeys'> {
  // API Key 前缀，用于区分设备类型
  apiKeyPrefix: string;
}

export interface DeviceAuthContext {
  deviceId: string;
  tenantId: string;
  userId?: string;
  deviceType?: string;
  deviceCode?: string;
}

/** 扩展 Express Request 类型 */
declare global {
  namespace Express {
    interface Request {
      deviceContext?: DeviceAuthContext;
    }
  }
}

interface DeviceRow {
  id: string;
  device_code: string;
  device_type: string;
  tenant_id: string;
  is_active: boolean;
}

/**
 * 创建设备认证中间件
 */
export function createDeviceAuthMiddleware(
  supabase: WmsSupabaseClient,
  authProvider: IAuthProvider,
  tenantResolver: ITenantResolver,
  config: DeviceAuthConfig
) {
  const apiKeyPrefix = config.apiKeyPrefix || 'hiwms_dk';

  // 合并配置
  const credentialsConfig: DeviceCredentialsConfig = {
    ...DEFAULT_DEVICE_CREDENTIALS_CONFIG,
    apiKeyPrefix,
    jwtIssuer: config.jwtIssuer,
    jwtAudience: config.jwtAudience,
    tenantSigningKeys: sharedTenantSigningKeys, // 进程内单例，需与签发 token 的一侧共享同一份，见 device-credentials.ts 注释
  };

  /**
   * 验证 Device JWT Token
   * 使用 jose 库进行 HS256 签名验证，锁定 alg 拒绝 none
   */
  async function verifyDeviceTokenMiddleware(token: string): Promise<DeviceTokenPayload | null> {
    return verifyDeviceToken(token, credentialsConfig);
  }

  /**
   * 验证 API Key
   * 格式: <prefix>_<device_id>_<secret>
   * 解析格式 -> 从数据库查询设备 secret_hash -> argon2 验证
   */
  async function verifyApiKeyMiddleware(apiKey: string): Promise<{ deviceId: string; tenantId: string } | null> {
    const parsed = parseApiKey(apiKey, apiKeyPrefix);
    if (!parsed) return null;

    const { deviceId, secret } = parsed;

    // 查询设备的 secret_hash
    const { data: device, error } = await supabase.getAdminClient()
      .from('devices')
      .select('id, tenant_id, is_active, secret_hash')
      .eq('id', deviceId)
      .single();

    if (error || !device) return null;
    if (device.is_active !== true) return null;
    if (!device.secret_hash) return null; // 未配置密钥

    // 验证 argon2 哈希
    const isValid = await verifyApiKeySecret(secret, device.secret_hash);
    if (!isValid) return null;

    return { deviceId: device.id, tenantId: device.tenant_id! };
  }

  /**
   * 查询设备信息并验证绑定租户
   */
  async function validateDevice(deviceId: string): Promise<DeviceRow | null> {
    try {
      const { data, error } = await supabase.getAdminClient()
        .from('devices')
        .select('id, device_code, device_type, tenant_id, is_active')
        .eq('id', deviceId)
        .single();

      if (error || !data) return null;
      if (!(data as DeviceRow).is_active) return null;

      return data as DeviceRow;
    } catch {
      return null;
    }
  }

  const authenticateMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      let deviceId: string | null = null;
      let tenantId: string | null = null;
      let userId: string | undefined;
      let deviceInfo: DeviceRow | null = null;

      // 方式 1: Authorization: Bearer <device_jwt>
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const payload = await verifyDeviceTokenMiddleware(token);

        if (payload) {
          deviceId = payload.device_id;
          tenantId = payload.tenant_id;
          userId = payload.user_id;
        }
      }

      // 方式 2: X-API-Key: <api_key>
      if (!deviceId) {
        const apiKey = req.headers['x-api-key'] as string;
        if (apiKey) {
          const apiKeyData = await verifyApiKeyMiddleware(apiKey);
          if (apiKeyData) {
            deviceId = apiKeyData.deviceId;
            tenantId = apiKeyData.tenantId;
          }
        }
      }

      // 无有效凭证（统一消息防设备 ID 枚举）
      if (!deviceId) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      deviceInfo = await validateDevice(deviceId);
      if (!deviceInfo) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      // 确认租户匹配（JWT 方式）
      if (tenantId && tenantId !== deviceInfo.tenant_id) {
        return res.status(403).json({ error: 'Device tenant mismatch' });
      }

      // 最终确定的租户 ID
      tenantId = deviceInfo.tenant_id;

      // 验证租户有效性
      const isValidTenant = await tenantResolver.validateTenant(tenantId);
      if (!isValidTenant) {
        return res.status(403).json({ error: 'Invalid or inactive tenant' });
      }

      // 注入设备上下文
      (req as any).context = {
        deviceId: deviceInfo.id,
        tenantId,
        userId,
        deviceType: deviceInfo.device_type,
        deviceCode: deviceInfo.device_code,
      };

      // 设置 RLS header（供 Supabase 客户端使用）
      req.headers['x-tenant-id'] = tenantId;

      next();
    } catch (error) {
      console.error('Device authentication error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  };

  const optionalAuthenticateMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];

    if (!authHeader?.startsWith('Bearer ') && !apiKey) {
      return next(); // No auth provided, continue without auth
    }

    // Delegate to full authenticate
    return authenticateMiddleware(req, res, next);
  };

  return {
    authenticate: authenticateMiddleware,
    optionalAuthenticate: optionalAuthenticateMiddleware,
  };
}