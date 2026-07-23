/**
 * Device 认证中间件 (ADR-019 修复版)
 * 专门用于 PDA/手持终端设备认证
 * 支持两种认证方式：
 * 1. Device JWT (Authorization: Bearer <token>) - 使用 jose 验签，HS256，拒绝 alg:none
 * 2. API Key (X-API-Key: <key>) - 解析 hiwms_dk_<device_id>_<secret>，查询 devices.secret_hash 用 argon2 验证
 *
 * 认证流程：
 * 1. 解析 token/key
 * 2. 验证签名/哈希、过期时间、issuer、audience
 * 3. 从 devices 表查询设备信息（含 secret_hash），验证设备绑定租户且激活
 * 4. 将 device_id, tenant_id, user_id 注入 req.context
 * 5. 设置 RLS 所需的 x-tenant-id header
 */

import type { Request, Response, NextFunction } from 'express';
import { WmsSupabaseClient } from '../../adapters/supabase/SupabaseClient';
import { IAuthProvider } from '../../core/ports/auth/IAuthProvider';
import { ITenantResolver } from '../../core/ports/auth/ITenantResolver';
import { verifyDeviceAccessToken, verifyApiKeySecret, parseApiKey, DEVICE_TOKEN_CONFIG } from '@core/utils/crypto';
import { ExpressRequestContext } from '../../adapters/express/ExpressMiddlewareFactory';

export interface DeviceAuthConfig {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  // API Key 前缀，用于区分设备类型
  apiKeyPrefix?: string;
}

interface DeviceRowWithSecret {
  id: string;
  device_code: string;
  device_type: string;
  tenant_id: string;
  is_active: boolean | null;
  secret_hash: string | null;
  secret_rotated_at: string | null;
}

/**
 * 创建设备认证中间件
 * @param supabase Supabase 客户端
 * @param authProvider 认证提供者（用于租户签名密钥获取，暂用 jwtSecret 兜底）
 * @param tenantResolver 租户解析器
 * @param config 认证配置
 */
export function createDeviceAuthMiddleware(
  supabase: WmsSupabaseClient,
  authProvider: IAuthProvider,
  tenantResolver: ITenantResolver,
  config: DeviceAuthConfig
) {
  const apiKeyPrefix = config.apiKeyPrefix || DEVICE_TOKEN_CONFIG.apiKeyPrefix;
  // 租户级签名密钥（暂时复用 jwtSecret，后续可从配置中心/tenant_secrets 表获取）
  const tenantAccessSecret = config.jwtSecret;
  const tenantRefreshSecret = config.jwtSecret;

  /**
   * 查询设备信息含密钥哈希（需 admin client 绕过 RLS）
   */
  async function validateDevice(deviceId: string): Promise<DeviceRowWithSecret | null> {
    try {
      const { data, error } = await supabase.getAdminClient()
        .from('devices')
        .select('id, device_code, device_type, tenant_id, is_active, secret_hash, secret_rotated_at')
        .eq('id', deviceId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }
      if (!(data as DeviceRowWithSecret).is_active) return null;
      return data as DeviceRowWithSecret;
    } catch {
      return null;
    }
  }

  const authenticateMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      let deviceId: string | null = null;
      let tenantId: string | null = null;
      let userId: string | undefined;
      let deviceInfo: DeviceRowWithSecret | null = null;

      // ========== 方式 1: Authorization: Bearer <device_jwt> ==========
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const payload = await verifyDeviceAccessToken(token, tenantAccessSecret);

        if (payload) {
          deviceId = payload.device_id;
          tenantId = payload.tenant_id;
          userId = payload.user_id;
        }
      }

      // ========== 方式 2: X-API-Key: hiwms_dk_<device_id>_<secret> ==========
      if (!deviceId) {
        const apiKey = req.headers['x-api-key'] as string;
        if (apiKey) {
          const parsed = parseApiKey(apiKey);
          if (parsed) {
            deviceId = parsed.deviceId;
            // API Key 方式需查询数据库验证 secret_hash
            deviceInfo = await validateDevice(deviceId);
            if (deviceInfo && deviceInfo.secret_hash) {
              const secretValid = await verifyApiKeySecret(parsed.secret, deviceInfo.secret_hash);
              if (!secretValid) {
                return res.status(401).json({ error: 'Invalid API Key secret' });
              }
            } else {
              return res.status(401).json({ error: 'Device has no API Key configured' });
            }
          }
        }
      }

      // ========== 统一设备信息校验 ==========
      if (!deviceId) {
        return res.status(401).json({ error: 'Missing or invalid device credentials' });
      }

      // JWT 方式已有 tenantId，API Key 方式需从设备行获取
      if (!deviceInfo) {
        deviceInfo = await validateDevice(deviceId);
      }
      if (!deviceInfo) {
        return res.status(401).json({ error: 'Device not found or inactive' });
      }

      // JWT 方式需确认租户匹配
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

      // ========== 注入设备上下文 ==========
      const ctx: ExpressRequestContext = {
        deviceId: deviceInfo.id,
        tenantId,
        userId,
        deviceType: deviceInfo.device_type,
        deviceCode: deviceInfo.device_code,
      };
      (req as any).context = ctx;
      // 兼容旧字段名
      (req as any).deviceContext = ctx;

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

    return authenticateMiddleware(req, res, next);
  };

  return {
    authenticate: authenticateMiddleware,
    optionalAuthenticate: optionalAuthenticateMiddleware,
  };
}