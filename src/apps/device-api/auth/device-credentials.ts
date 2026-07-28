/**
 * 设备凭证核心库
 * 负责 API Key 生成、哈希验证、JWT 签发/验签
 *
 * 三层凭证体系（ADR-019）：
 * - API Key（长期，按设备独立）：`hiwms_dk_<device_id>_<random>`，服务端存 argon2id 哈希
 * - Refresh Token（中期 7 天，按租户独立签名密钥）：用于静默续期
 * - Access Token（短期 15 分钟，按租户独立签名密钥）：实际业务请求使用
 *
 * 调用者：
 * - DeviceAuthMiddleware.ts: verifyDeviceToken(), verifyApiKey()
 * - routes.ts (device-api): POST /device/auth/login, POST /device/auth/refresh
 * - routes.ts (admin-api): POST /admin/devices/{id}/pairing-qr, POST /device/provision
 */
import { SignJWT, jwtVerify, type JWTPayload, type FlattenedJWSInput } from 'jose';
import { hash, verify } from 'argon2';
import { compare as compareBcrypt } from 'bcryptjs';

/** 设备 Token 载荷 */
export interface DeviceTokenPayload extends JWTPayload {
  device_id: string;
  tenant_id: string;
  type: 'device';
  user_id?: string;
}

/** Refresh Token 载荷 */
export interface RefreshTokenPayload extends JWTPayload {
  device_id: string;
  tenant_id: string;
  type: 'refresh';
}

/** 凭证配置 */
export interface DeviceCredentialsConfig {
  /** API Key 前缀 */
  apiKeyPrefix: string;
  /** JWT Issuer */
  jwtIssuer: string;
  /** JWT Audience */
  jwtAudience: string;
  /** Access Token 过期时间（秒） */
  accessTokenTtlSec: number;
  /** Refresh Token 过期时间（秒） */
  refreshTokenTtlSec: number;
  /** 租户级签名密钥存储：tenantId -> { keyId, secret, rotatedAt, revokedAt } */
  tenantSigningKeys: Map<string, TenantSigningKey>;
}

/** 租户签名密钥 */
export interface TenantSigningKey {
  keyId: string;           // 如 "tenant_<uuid>_v1"
  secret: Uint8Array;      // HS256 密钥
  rotatedAt: Date;         // 密钥轮换时间
  revokedAt?: Date;        // 撤销时间（可选）
  isActive: boolean;       // 当前是否激活
}

/** API Key 生成结果 */
export interface GeneratedApiKey {
  /** 完整 API Key（仅返回一次） */
  apiKey: string;
  /** 设备 ID */
  deviceId: string;
  /** 哈希值（存入数据库） */
  secretHash: string;
  /** 密钥轮换时间 */
  rotatedAt: Date;
  /** 生成时间 */
  createdAt: Date;
}

/** 登录结果 */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;           // Access Token TTL (秒)
  refreshExpiresIn: number;    // Refresh Token TTL (秒)
  tokenType: 'Bearer';
  serverTime: string;          // ISO8601 UTC
  tenantId: string;
  deviceConfig: DeviceConfig;
  permissions: string[];
}

/** 设备配置 */
export interface DeviceConfig {
  syncIntervalSec: number;
  autoSyncOnWifi: boolean;
  maxOfflineDays: number;
  features: string[];
}

/** 刷新结果 */
export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  serverTime: string;
}

/** 默认配置 */
export const DEFAULT_DEVICE_CREDENTIALS_CONFIG: Omit<DeviceCredentialsConfig, 'tenantSigningKeys'> = {
  apiKeyPrefix: 'hiwms_dk',
  jwtIssuer: 'hiwms',
  jwtAudience: 'hiwms-devices',
  accessTokenTtlSec: 15 * 60,      // 15 分钟
  refreshTokenTtlSec: 7 * 24 * 60 * 60, // 7 天
};

/**
 * 进程内共享的租户签名密钥存储。
 *
 * 之前 publicAuthRoutes.ts（签发 login/refresh token）和 DeviceAuthMiddleware.ts
 * （验证 Bearer access token）各自 `new Map()` 了一份 tenantSigningKeys，两份互不
 * 可见——登录时生成并缓存的密钥，验证请求时在另一个空 Map 里永远查不到，导致
 * Bearer JWT 认证恒为 401（2026-07-27 经真实 HTTP 请求验证确认，是修复 tenant_id
 * 提取 bug 后暴露出的第二层问题）。这里改为进程级单例，所有 DeviceCredentialsConfig
 * 构造处统一引用同一个 Map。仅内存缓存，进程重启即丢失（同 ensureTenantSigningKey
 * 注释所述，未来应迁移到数据库持久化，多实例部署前必须先做这件事）。
 */
export const sharedTenantSigningKeys: Map<string, TenantSigningKey> = new Map();

/** 生成 API Key
 * 格式: hiwms_dk_<device_id>_<random_base64url>
 * 返回明文 Key（仅此一次）和哈希值（存数据库）
 */
export async function generateApiKey(
  deviceId: string,
  config: Pick<DeviceCredentialsConfig, 'apiKeyPrefix'>
): Promise<GeneratedApiKey> {
  // 生成 32 字节随机数 -> base64url (约 43 字符)
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const randomPart = Buffer.from(randomBytes).toString('base64url');

  const apiKey = `${config.apiKeyPrefix}_${deviceId}_${randomPart}`;
  const secretHash = await hash(randomPart, {
    type: 2,           // argon2id
    memoryCost: 65536, // 64 MiB
    timeCost: 3,       // 3 iterations
    parallelism: 4,    // 4 lanes
  });

  return {
    apiKey,
    deviceId,
    secretHash,
    rotatedAt: new Date(),
    createdAt: new Date(),
  };
}

/** 验证 API Key 明文对比哈希 */
export async function verifyApiKeySecret(
  secretPlaintext: string,
  secretHash: string
): Promise<boolean> {
  try {
    return await verify(secretHash, secretPlaintext);
  } catch {
    return false;
  }
}

/** 验证操作员签到密码（`users.password_hash`，bcrypt 格式，migration 022 CHECK 约束）
 *  与 API Key（argon2id）是两套不同的哈希算法，不可混用验证函数。
 */
export async function verifyOperatorPassword(
  passwordPlaintext: string,
  passwordHash: string
): Promise<boolean> {
  try {
    return await compareBcrypt(passwordPlaintext, passwordHash);
  } catch {
    return false;
  }
}

/** 解析 API Key 格式
 *  使用 indexOf 而非 split('_')，因为 base64url 字母表包含下划线，
 *  random 部分中约 49.4% 的 key 含至少一个下划线，split 会产生 >2 段导致解析失败。
 */
export function parseApiKey(
  apiKey: string,
  expectedPrefix: string
): { deviceId: string; secret: string } | null {
  if (!apiKey.startsWith(`${expectedPrefix}_`)) return null;

  const remainder = apiKey.slice(expectedPrefix.length + 1);
  const firstUnderscoreIdx = remainder.indexOf('_');
  if (firstUnderscoreIdx === -1) return null;

  const deviceId = remainder.slice(0, firstUnderscoreIdx);
  const secret = remainder.slice(firstUnderscoreIdx + 1);
  if (!deviceId || !secret) return null;

  return { deviceId, secret };
}

/** 获取租户当前激活的签名密钥 */
export function getActiveTenantSigningKey(
  tenantId: string,
  config: DeviceCredentialsConfig
): TenantSigningKey | null {
  const key = config.tenantSigningKeys.get(tenantId);
  if (!key || !key.isActive || key.revokedAt) return null;
  return key;
}

/** 确保租户有签名密钥（如不存在则生成） */
export async function ensureTenantSigningKey(
  tenantId: string,
  config: DeviceCredentialsConfig
): Promise<TenantSigningKey> {
  let key = config.tenantSigningKeys.get(tenantId);

  if (!key || !key.isActive || key.revokedAt) {
    // 生成新密钥
    const keyId = `tenant_${tenantId}_v${Date.now()}`;
    const secret = crypto.getRandomValues(new Uint8Array(32)); // 256-bit for HS256

    key = {
      keyId,
      secret,
      rotatedAt: new Date(),
      isActive: true,
    };
    config.tenantSigningKeys.set(tenantId, key);
  }

  return key;
}

/** 签发 Access Token (15 min, HS256, 租户级密钥) */
export async function issueAccessToken(
  deviceId: string,
  tenantId: string,
  config: DeviceCredentialsConfig,
  userId?: string
): Promise<string> {
  const signingKey = await ensureTenantSigningKey(tenantId, config);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    device_id: deviceId,
    tenant_id: tenantId,
    type: 'device',
    user_id: userId,
  } as DeviceTokenPayload)
    .setProtectedHeader({ alg: 'HS256', kid: signingKey.keyId })
    .setIssuedAt(now)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setExpirationTime(now + config.accessTokenTtlSec)
    .sign(signingKey.secret);
}

/** 签发 Refresh Token (7 天, HS256, 租户级密钥) */
export async function issueRefreshToken(
  deviceId: string,
  tenantId: string,
  config: DeviceCredentialsConfig
): Promise<string> {
  const signingKey = await ensureTenantSigningKey(tenantId, config);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    device_id: deviceId,
    tenant_id: tenantId,
    type: 'refresh',
  } as RefreshTokenPayload)
    .setProtectedHeader({ alg: 'HS256', kid: signingKey.keyId })
    .setIssuedAt(now)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setExpirationTime(now + config.refreshTokenTtlSec)
    .sign(signingKey.secret);
}

/**
 * 从 jose 动态密钥解析回调收到的原始（未验证）JWS 输入里取出 tenant_id claim，
 * 用于按租户选密钥。回调收到的第二个参数是 { protected, payload, signature }
 * 的 base64url 编码原文（jose 文档："No token components have been verified at
 * the time of this function call"），不是解码后的 payload 对象——之前代码直接
 * 对它做 `(jwtPayload as unknown as DeviceTokenPayload).tenant_id` 永远读到
 * undefined，导致 getActiveTenantSigningKey 永远查不到密钥、验签恒失败
 * （2026-07-27 经真实 HTTP 请求 + jose 类型定义交叉验证确认）。
 * 这里读出的 tenant_id 只用来"挑一把候选密钥"，实际信任仍然来自后续用该密钥
 * 对签名的密码学校验（与标准 JWKS kid 选密钥模型一致，被篡改的 claim 无法通过
 * 签名校验）。
 */
function extractUnverifiedTenantId(token: FlattenedJWSInput): string | undefined {
  try {
    const payloadB64 = typeof token.payload === 'string' ? token.payload : Buffer.from(token.payload).toString('base64url');
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return typeof claims?.tenant_id === 'string' ? claims.tenant_id : undefined;
  } catch {
    return undefined;
  }
}

/** 验证 Device Access Token */
export async function verifyDeviceToken(
  token: string,
  config: DeviceCredentialsConfig
): Promise<DeviceTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, (protectedHeader, jwtPayload) => {
      // 锁定算法 HS256，拒绝 alg: none
      if (protectedHeader.alg !== 'HS256') {
        throw new Error('Unsupported algorithm');
      }

      const tenantId = extractUnverifiedTenantId(jwtPayload);
      if (!tenantId) throw new Error('Missing tenant_id');

      const signingKey = getActiveTenantSigningKey(tenantId, config);
      if (!signingKey) throw new Error('Tenant signing key not found or revoked');

      // 验证 keyId 匹配
      if (protectedHeader.kid !== signingKey.keyId) {
        throw new Error('Key ID mismatch');
      }

      return signingKey.secret;
    }, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      algorithms: ['HS256'],
      clockTolerance: 30,
    });

    // 额外校验 payload 结构
    const devicePayload = payload as unknown as DeviceTokenPayload;
    if (devicePayload.type !== 'device') return null;
    if (!devicePayload.device_id || !devicePayload.tenant_id) return null;

    return devicePayload;
  } catch {
    return null;
  }
}

/** 验证 Refresh Token */
export async function verifyRefreshToken(
  token: string,
  config: DeviceCredentialsConfig
): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, (protectedHeader, jwtPayload) => {
      if (protectedHeader.alg !== 'HS256') {
        throw new Error('Unsupported algorithm');
      }

      const tenantId = extractUnverifiedTenantId(jwtPayload);
      if (!tenantId) throw new Error('Missing tenant_id');

      const signingKey = getActiveTenantSigningKey(tenantId, config);
      if (!signingKey) throw new Error('Tenant signing key not found or revoked');

      if (protectedHeader.kid !== signingKey.keyId) {
        throw new Error('Key ID mismatch');
      }

      return signingKey.secret;
    }, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      algorithms: ['HS256'],
      clockTolerance: 30,
    });

    const refreshPayload = payload as unknown as RefreshTokenPayload;
    if (refreshPayload.type !== 'refresh') return null;
    if (!refreshPayload.device_id || !refreshPayload.tenant_id) return null;

    return refreshPayload;
  } catch {
    return null;
  }
}

/** 签发 Token 对 (Access Token + Refresh Token) */
export async function issueTokenPair(
  deviceId: string,
  tenantId: string,
  config: DeviceCredentialsConfig,
  userId?: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  tokenType: 'Bearer';
}> {
  const [accessToken, refreshToken] = await Promise.all([
    issueAccessToken(deviceId, tenantId, config, userId),
    issueRefreshToken(deviceId, tenantId, config),
  ]);

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: config.accessTokenTtlSec,
    refreshTokenExpiresIn: config.refreshTokenTtlSec,
    tokenType: 'Bearer',
  };
}

/** 验证 Refresh Token 并签发新 Token 对（轮换） */
export async function verifyAndRotateRefreshToken(
  refreshToken: string,
  config: DeviceCredentialsConfig
): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  tokenType: 'Bearer';
} | null> {
  const payload = await verifyRefreshToken(refreshToken, config);
  if (!payload) return null;

  // 签发新的 Token 对（隐式轮换：旧 refresh token 仍有效直到过期，
  // 如果需要显式撤销旧 refresh token，需要额外的存储表 device_refresh_tokens）
  return issueTokenPair(payload.device_id, payload.tenant_id, config);
}

/** 轮换租户签名密钥（撤销旧密钥，生成新密钥） */
export function rotateTenantSigningKey(
  tenantId: string,
  config: DeviceCredentialsConfig
): TenantSigningKey {
  const oldKey = config.tenantSigningKeys.get(tenantId);
  if (oldKey) {
    oldKey.isActive = false;
    oldKey.revokedAt = new Date();
  }

  const newKeyId = `tenant_${tenantId}_v${Date.now()}`;
  const newSecret = crypto.getRandomValues(new Uint8Array(32));

  const newKey: TenantSigningKey = {
    keyId: newKeyId,
    secret: newSecret,
    rotatedAt: new Date(),
    isActive: true,
  };

  config.tenantSigningKeys.set(tenantId, newKey);
  return newKey;
}

/** 撤销租户所有签名密钥（设备丢失/被盗场景） */
export function revokeAllTenantSigningKeys(
  tenantId: string,
  config: DeviceCredentialsConfig
): void {
  const key = config.tenantSigningKeys.get(tenantId);
  if (key) {
    key.isActive = false;
    key.revokedAt = new Date();
  }
}

/** 计算密钥版本是否过期（用于判断轮换前签发的 token 是否应拒绝） */
export function isTokenIssuedBeforeKeyRotation(
  tokenIssuedAt: number,      // JWT iat (unix seconds)
  keyRotatedAt: Date          // 密钥轮换时间
): boolean {
  const keyRotationUnixSec = Math.floor(keyRotatedAt.getTime() / 1000);
  return tokenIssuedAt < keyRotationUnixSec;
}

/** 二维码配对数据编码
 * 编码格式: device_id|api_key (base64url)
 * TTL: 5 分钟，一次性使用
 */
export function encodePairingQr(deviceId: string, apiKey: string): string {
  const data = `${deviceId}|${apiKey}`;
  return Buffer.from(data).toString('base64url');
}

export function decodePairingQr(qrData: string): { deviceId: string; apiKey: string } | null {
  try {
    const decoded = Buffer.from(qrData, 'base64url').toString();
    const [deviceId, apiKey] = decoded.split('|');
    if (!deviceId || !apiKey) return null;
    return { deviceId, apiKey };
  } catch {
    return null;
  }
}