/**
 * 设备身份加密工具模块
 * 提供：API Key 生成、哈希验证、JWT 签名/验签
 * 使用 jose (Web Crypto API) + argon2，锁定 HS256，拒绝 alg: none
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { hash, verify, type HashOptions } from 'argon2';

// ========== 常量 ==========

/** API Key 前缀 */
export const DEVICE_API_KEY_PREFIX = 'hiwms_dk';

/** Access Token 有效期（秒） */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 分钟

/** Refresh Token 有效期（秒） */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

/** API Key 随机部分字节数 */
export const API_KEY_RANDOM_BYTES = 32;

/** Argon2 默认配置（生产环境可通过环境变量调整） */
export const ARGON2_OPTIONS: HashOptions = {
  type: 2, // Argon2id
  memoryCost: 19456, // 19 MB
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
};

// ========== 类型定义 ==========

/** 设备 Access Token 载荷 */
export interface DeviceAccessTokenPayload extends JWTPayload {
  /** 设备 ID */
  device_id: string;
  /** 租户 ID */
  tenant_id: string;
  /** 用户 ID（可选，设备关联操作员时） */
  user_id?: string;
  /** Token 类型标识 */
  type: 'access';
}

/** 设备 Refresh Token 载荷 */
export interface DeviceRefreshTokenPayload extends JWTPayload {
  /** 设备 ID */
  device_id: string;
  /** 租户 ID */
  tenant_id: string;
  /** Token 类型标识 */
  type: 'refresh';
  /** 关联的 Access Token ID（用于撤销链） */
  access_token_id?: string;
}

/** API Key 解析结果 */
export interface ParsedApiKey {
  /** 设备 ID */
  deviceId: string;
  /** 明文密钥部分 */
  secret: string;
  /** 完整原始 key */
  raw: string;
}

/** 签名密钥对（按租户独立） */
export interface TenantSigningKeys {
  /** Access Token 签名密钥 */
  accessSecret: string; // base64url 编码
  /** Refresh Token 签名密钥 */
  refreshSecret: string; // base64url 编码
  /** 密钥版本（用于轮换） */
  version: number;
  /** 创建时间 */
  createdAt: string;
}

// ========== API Key 生成与解析 ==========

/**
 * 生成设备 API Key
 * 格式：`hiwms_dk_<device_id>_<base64url随机串>`
 * @param deviceId 设备 UUID
 * @returns { raw: 完整key, secret: 仅随机部分(用于哈希存储) }
 */
export function generateDeviceApiKey(deviceId: string): { raw: string; secret: string } {
  const randomBytes = crypto.getRandomValues(new Uint8Array(API_KEY_RANDOM_BYTES));
  const randomPart = bufferToBase64Url(randomBytes);
  const raw = `${DEVICE_API_KEY_PREFIX}_${deviceId}_${randomPart}`;
  return { raw, secret: randomPart };
}

/**
 * 解析 API Key
 * @param apiKey 完整的 API Key 字符串
 * @returns 解析结果或 null（格式不合法）
 */
export function parseApiKey(apiKey: string): ParsedApiKey | null {
  if (!apiKey.startsWith(`${DEVICE_API_KEY_PREFIX}_`)) {
    return null;
  }

  const parts = apiKey.slice(DEVICE_API_KEY_PREFIX.length + 1).split('_');
  if (parts.length !== 2) {
    return null;
  }

  const [deviceId, secret] = parts;
  if (!deviceId || !secret) {
    return null;
  }

  // 验证 deviceId 是有效 UUID 格式（宽松校验，严格校验交给数据库层）
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return null;
  }

  return { deviceId, secret, raw: apiKey };
}

/**
 * 计算 API Key 密钥部分的哈希（用于存储）
 * @param secret API Key 的随机部分
 * @returns argon2 哈希字符串
 */
export async function hashApiKeySecret(secret: string): Promise<string> {
  return hash(secret, ARGON2_OPTIONS);
}

/**
 * 验证 API Key 密钥对应的哈希
 * @param secret 客户端提供的密钥部分
 * @param storedHash 数据库存储的哈希
 * @returns 是否匹配
 */
export async function verifyApiKeySecret(secret: string, storedHash: string): Promise<boolean> {
  try {
    return await verify(storedHash, secret, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

// ========== JWT 签名/验签（按租户独立密钥） ==========

/**
 * 创建签名密钥（从租户配置的 base64 字符串转为 Uint8Array）
 * @param secretBase64 base64url 编码的密钥
 */
function getSigningKey(secretBase64: string): Uint8Array {
  // jose 接受 Uint8Array，base64url 解码
  const binary = base64UrlToBytes(secretBase64);
  if (binary.length < 32) {
    throw new Error('Signing key must be at least 32 bytes (256 bits) for HS256');
  }
  return binary;
}

/**
 * 签发设备 Access Token
 * @param payload 载荷数据
 * @param tenantAccessSecret 租户 Access Token 签名密钥
 * @returns JWT 字符串
 */
export async function signDeviceAccessToken(
  payload: Omit<DeviceAccessTokenPayload, 'type' | 'iat' | 'exp' | 'jti'>,
  tenantAccessSecret: string
): Promise<string> {
  const key = getSigningKey(tenantAccessSecret);

  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('hiwms-device-api')
    .setAudience('hiwms-devices')
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .setJti(crypto.randomUUID())
    .sign(key);
}

/**
 * 签发设备 Refresh Token
 * @param payload 载荷数据
 * @param tenantRefreshSecret 租户 Refresh Token 签名密钥
 * @returns JWT 字符串
 */
export async function signDeviceRefreshToken(
  payload: Omit<DeviceRefreshTokenPayload, 'type' | 'iat' | 'exp' | 'jti'>,
  tenantRefreshSecret: string
): Promise<string> {
  const key = getSigningKey(tenantRefreshSecret);

  return new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer('hiwms-device-api')
    .setAudience('hiwms-devices')
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS}s`)
    .setJti(crypto.randomUUID())
    .sign(key);
}

/**
 * 验证设备 Access Token
 * @param token JWT 字符串
 * @param tenantAccessSecret 租户 Access Token 签名密钥
 * @returns 解析后的载荷或 null（无效/过期/算法不匹配）
 */
export async function verifyDeviceAccessToken(
  token: string,
  tenantAccessSecret: string
): Promise<DeviceAccessTokenPayload | null> {
  try {
    const key = getSigningKey(tenantAccessSecret);
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'], // 显式锁定算法，拒绝 none/RS256 等
      issuer: 'hiwms-device-api',
      audience: 'hiwms-devices',
    });

    // 双重校验 type 字段
    if (payload.type !== 'access') {
      return null;
    }

    return payload as DeviceAccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * 验证设备 Refresh Token
 * @param token JWT 字符串
 * @param tenantRefreshSecret 租户 Refresh Token 签名密钥
 * @returns 解析后的载荷或 null
 */
export async function verifyDeviceRefreshToken(
  token: string,
  tenantRefreshSecret: string
): Promise<DeviceRefreshTokenPayload | null> {
  try {
    const key = getSigningKey(tenantRefreshSecret);
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: 'hiwms-device-api',
      audience: 'hiwms-devices',
    });

    if (payload.type !== 'refresh') {
      return null;
    }

    return payload as DeviceRefreshTokenPayload;
  } catch {
    return null;
  }
}

/**
 * 生成租户签名密钥对（首次配置或轮换时调用）
 * @returns { accessSecret, refreshSecret, version, createdAt }
 */
export function generateTenantSigningKeys(): TenantSigningKeys {
  const accessBytes = crypto.getRandomValues(new Uint8Array(48)); // 384 bits
  const refreshBytes = crypto.getRandomValues(new Uint8Array(48));

  return {
    accessSecret: bytesToBase64Url(accessBytes),
    refreshSecret: bytesToBase64Url(refreshBytes),
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

// ========== 编码工具 ==========

function bufferToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bufferToBase64Url(bytes);
}

function base64UrlToBytes(str: string): Uint8Array {
  // 补齐 padding
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const binary = atob(padded + (pad === 2 ? '==' : pad === 3 ? '=' : ''));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// ========== 导出常量供外部引用 ==========

export const DEVICE_TOKEN_CONFIG = {
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
  apiKeyPrefix: DEVICE_API_KEY_PREFIX,
  argon2Options: ARGON2_OPTIONS,
} as const;