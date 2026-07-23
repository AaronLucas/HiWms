/**
 * Device API 认证端点单元测试
 * mock 仓储层，测试 POST /device/provision、/device/auth/login、/device/auth/refresh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createDeviceApiRouter } from '../../../apps/device-api/routes';
import type { DeviceApiDependencies } from '../../../apps/device-api/di';
import { SupabaseAdapters } from '../../../adapters/supabase';

// 设置环境变量供路由使用
process.env.DEVICE_JWT_SECRET = 'dGVzdC1zZWNyZXQta2V5LWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHktMzJieXRlcw';

// 测试用密钥（base64url 编码，32+ 字节）
const testSecret = 'dGVzdC1zZWNyZXQta2V5LWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHktMzJieXRlcw';

// Mock 仓储层
const mockDevicesRepo = {
  create: vi.fn(),
  rotateSecret: vi.fn(),
  findByIdWithSecret: vi.fn(),
};

const mockSupabaseAdapters = {
  repositories: {
    devices: mockDevicesRepo,
    taskClaims: {},
    syncPolicies: {},
    deviceSyncStates: {},
    syncEvents: {},
    exceptions: {},
    missingLabels: {},
    unidentifiedGoods: {},
  },
} as unknown as SupabaseAdapters;

const mockDeps: DeviceApiDependencies = {
  config: {
    supabase: { url: '', anonKey: '', serviceRoleKey: '' },
    server: { port: 3003, host: '0.0.0.0' },
    device: { jwtSecret: 'dGVzdC1zZWNyZXQta2V5LWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHktMzJieXRlcw', jwtIssuer: 'hiwms-device-api', jwtAudience: 'hiwms-devices' },
  },
  supabaseAdapters: mockSupabaseAdapters,
  middlewareFactory: {
    authenticate: () => (req: Request, res: Response, next: NextFunction) => {
      // Inject required context for provision endpoint
      (req as any).context = {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        userId: '123e4567-e89b-12d3-a456-426614174002',
      };
      next();
    },
    optionalAuthenticate: () => (req: Request, res: Response, next: NextFunction) => {
      (req as any).context = {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        userId: '123e4567-e89b-12d3-a456-426614174002',
      };
      next();
    },
    correlationId: () => (req: Request, res: Response, next: NextFunction) => next(),
    injectRlsContext: () => (req: Request, res: Response, next: NextFunction) => next(),
    errorHandler: () => (err: Error, req: Request, res: Response, next: NextFunction) => next(err),
  } as any,
};

describe('device-api routes - Device Auth Endpoints', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());

    // Inject context for provision endpoint (requires human auth)
    app.use('/api/device/device/provision', (req: Request, res: Response, next: NextFunction) => {
      (req as any).context = {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        userId: '123e4567-e89b-12d3-a456-426614174002',
      };
      next();
    });

    const router = createDeviceApiRouter(mockDeps);
    app.use('/api/device', router);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /api/device/device/provision', () => {
    it('应成功创建设备并返回 API Key', async () => {
      const mockDevice = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        device_code: 'PDA-WH-001',
        device_type: 'PDA',
        is_active: true,
        tenant_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      mockDevicesRepo.create.mockResolvedValue(mockDevice);
      mockDevicesRepo.rotateSecret.mockResolvedValue({
        device: { ...mockDevice, secret_hash: 'hashed', secret_rotated_at: new Date().toISOString() },
        newApiKey: 'hiwms_dk_123e4567-e89b-12d3-a456-426614174000_abc123',
      });

      const res = await request(app)
        .post('/api/device/device/provision')
        .send({
          device_code: 'PDA-WH-001',
          device_type: 'PDA',
          note: '测试设备',
        })
        .expect(201);

      expect(res.body.device_id).toBe(mockDevice.id);
      expect(res.body.device_code).toBe('PDA-WH-001');
      expect(res.body.device_type).toBe('PDA');
      expect(res.body.api_key).toMatch(/^hiwms_dk_[0-9a-f-]{36}_/);
      expect(res.body.provisioned_at).toBeDefined();
    });

    it('缺少 device_code 应返回 422', async () => {
      await request(app)
        .post('/api/device/device/provision')
        .send({ device_type: 'PDA' })
        .expect(422);
    });

    it('device_type 必须是枚举值', async () => {
      await request(app)
        .post('/api/device/device/provision')
        .send({ device_code: 'TEST', device_type: 'INVALID' })
        .expect(422);
    });
  });

  describe('POST /api/device/device/auth/login', () => {
    const deviceId = '123e4567-e89b-12d3-a456-426614174000';
    const tenantId = '123e4567-e89b-12d3-a456-426614174001';
    const apiKey = `hiwms_dk_${deviceId}_secret123`;

    it('合法 API Key 应返回 Access/Refresh Token', async () => {
      mockDevicesRepo.findByIdWithSecret.mockResolvedValue({
        id: deviceId,
        tenant_id: tenantId,
        device_code: 'PDA-WH-001',
        device_type: 'PDA',
        is_active: true,
        secret_hash: '$argon2id$v=19$m=19456,t=2,p=1$hash$salt',
        secret_rotated_at: new Date().toISOString(),
      });

      // Mock argon2 verify to return true
      vi.doMock('argon2', () => ({
        verify: vi.fn().mockResolvedValue(true),
      }));

      const res = await request(app)
        .post('/api/device/device/auth/login')
        .send({
          device_id: deviceId,
          api_key: apiKey,
          app_version: '2.1.0',
          os_version: 'Android 13',
          device_model: 'Zebra TC58',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.access_token).toBeDefined();
      expect(res.body.data.refresh_token).toBeDefined();
      expect(res.body.data.expires_in).toBe(900);
      expect(res.body.data.refresh_expires_in).toBe(604800);
      expect(res.body.data.token_type).toBe('Bearer');
      expect(res.body.data.tenant_id).toBe(tenantId);
      expect(res.body.data.device_config).toBeDefined();
      expect(res.body.data.permissions).toBeDefined();
    });

    it('错误的 API Key 格式应返回 422 (Zod 验证失败)', async () => {
      await request(app)
        .post('/api/device/device/auth/login')
        .send({
          device_id: deviceId,
          api_key: 'wrong-format',
        })
        .expect(422);
    });

    it('device_id 与 API Key 不匹配应返回 401', async () => {
      const differentDeviceId = '22222222-2222-4222-a222-222222222222'; // 有效 UUID v4，但与 apiKey 中的 deviceId 不同
      await request(app)
        .post('/api/device/device/auth/login')
        .send({
          device_id: differentDeviceId,
          api_key: apiKey,
        })
        .expect(401);
    });

    it('设备不存在应返回 403', async () => {
      mockDevicesRepo.findByIdWithSecret.mockResolvedValue(null);

      await request(app)
        .post('/api/device/device/auth/login')
        .send({
          device_id: deviceId,
          api_key: apiKey,
        })
        .expect(403);
    });

    it('设备未激活应返回 403', async () => {
      mockDevicesRepo.findByIdWithSecret.mockResolvedValue({
        id: deviceId,
        tenant_id: tenantId,
        is_active: false,
        secret_hash: 'hash',
      });

      await request(app)
        .post('/api/device/device/auth/login')
        .send({
          device_id: deviceId,
          api_key: apiKey,
        })
        .expect(403);
    });

    it('设备无 secret_hash 应返回 403', async () => {
      mockDevicesRepo.findByIdWithSecret.mockResolvedValue({
        id: deviceId,
        tenant_id: tenantId,
        is_active: true,
        secret_hash: null,
      });

      await request(app)
        .post('/api/device/device/auth/login')
        .send({
          device_id: deviceId,
          api_key: apiKey,
        })
        .expect(403);
    });
  });

  describe('POST /api/device/device/auth/refresh', () => {
    const deviceId = '123e4567-e89b-12d3-a456-426614174000';
    const tenantId = '123e4567-e89b-12d3-a456-426614174001';
    // base64url 编码的 32+ 字节密钥
    const testSecretB64 = 'dGVzdC1zZWNyZXQta2V5LWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHktMzJieXRlcw';

    it('合法 Refresh Token 应返回新 Access Token', async () => {
      const { signDeviceRefreshToken } = await import('../../../core/utils/crypto');
      const refreshToken = await signDeviceRefreshToken(
        { device_id: deviceId, tenant_id: tenantId },
        testSecretB64
      );

      const res = await request(app)
        .post('/api/device/device/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.access_token).toBeDefined();
      expect(res.body.data.refresh_token).toBe(refreshToken);
      expect(res.body.data.expires_in).toBe(900);
      expect(res.body.data.tenant_id).toBe(tenantId);
    });

    it('无效 Refresh Token 应返回 401', async () => {
      await request(app)
        .post('/api/device/device/auth/refresh')
        .send({ refresh_token: 'invalid.token.here' })
        .expect(401);
    });

    it('过期 Refresh Token 应返回 401', async () => {
      const { SignJWT } = await import('jose');
      const expiredToken = await new SignJWT({ device_id: deviceId, tenant_id: tenantId, type: 'refresh' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime('-1s')
        .setJti('expired')
        .sign(new TextEncoder().encode(testSecretB64));

      await request(app)
        .post('/api/device/device/auth/refresh')
        .send({ refresh_token: expiredToken })
        .expect(401);
    });

    it('错误 type (access token) 应返回 401', async () => {
      const { signDeviceAccessToken } = await import('../../../core/utils/crypto');
      const accessToken = await signDeviceAccessToken(
        { device_id: deviceId, tenant_id: tenantId },
        testSecretB64
      );

      await request(app)
        .post('/api/device/device/auth/refresh')
        .send({ refresh_token: accessToken })
        .expect(401);
    });
  });
});