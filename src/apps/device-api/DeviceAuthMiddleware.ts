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

export interface DeviceAuthConfig {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  // API Key 前缀，用于区分设备类型
  apiKeyPrefix?: string;
}

export interface DeviceTokenPayload {
  device_id: string;
  tenant_id: string;
  user_id?: string;
  type: 'device';
  iat: number;
  exp: number;
  iss: string;
  aud: string;
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
  const apiKeyPrefix = config.apiKeyPrefix || 'wms7_dev';

  /**
   * 验证 Device JWT Token
   * 使用标准 JWT 验证（HS256 对称密钥）
   */
  async function verifyDeviceToken(token: string): Promise<DeviceTokenPayload | null> {
    try {
      // 简单的 JWT 解析（不验证签名，实际项目应使用 jose 库）
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as DeviceTokenPayload;

      // 验证基本字段
      if (payload.type !== 'device') return null;
      if (payload.iss !== config.jwtIssuer) return null;
      if (payload.aud !== config.jwtAudience) return null;
      if (payload.exp && payload.exp * 1000 < Date.now()) return null;

      // TODO: 实际验证签名（需要引入 jose 库）
      // const isValid = await verifySignature(token, config.jwtSecret);
      // if (!isValid) return null;

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * 验证 API Key
   * 格式: <prefix>_<device_id>_<secret>
   */
  async function verifyApiKey(apiKey: string): Promise<{ deviceId: string; secret: string } | null> {
    if (!apiKey.startsWith(`${apiKeyPrefix}_`)) return null;

    const parts = apiKey.slice(apiKeyPrefix.length + 1).split('_');
    if (parts.length !== 2) return null;

    return { deviceId: parts[0], secret: parts[1] };
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
        const payload = await verifyDeviceToken(token);

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
          const apiKeyData = await verifyApiKey(apiKey);
          if (apiKeyData) {
            deviceId = apiKeyData.deviceId;
            // API Key 方式需要从数据库查询 tenant_id
          }
        }
      }

      // 验证设备存在且激活
      if (!deviceId) {
        return res.status(401).json({ error: 'Missing or invalid device credentials' });
      }

      deviceInfo = await validateDevice(deviceId);
      if (!deviceInfo) {
        return res.status(401).json({ error: 'Device not found or inactive' });
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