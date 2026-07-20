/**
 * DeviceAuthMiddleware 测试
 * 简化版，专注于核心逻辑测试
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createDeviceAuthMiddleware } from '../../apps/device-api/DeviceAuthMiddleware';
import { WmsSupabaseClient } from '../../adapters/supabase/SupabaseClient';
import { ITenantResolver } from '../../core/ports/auth/ITenantResolver';

// Mock Supabase client
const mockSupabase = {
  getAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  })),
  getClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  })),
} as unknown as WmsSupabaseClient;

// Mock AuthProvider - implement all required methods
const mockAuthProvider = {
  verifyToken: vi.fn(),
  refreshToken: vi.fn(),
  generateTokens: vi.fn(),
  revokeToken: vi.fn(),
};

// Mock TenantResolver
const mockTenantResolver: ITenantResolver = {
  validateTenant: vi.fn(),
  resolveFromUser: vi.fn(),
  resolveFromRequest: vi.fn(),
  isPlatformAdmin: vi.fn(),
};

const deviceAuthConfig = {
  jwtSecret: 'test-secret',
  jwtIssuer: 'hiwms-device-api',
  jwtAudience: 'hiwms-devices',
};

describe('DeviceAuthMiddleware', () => {
  let middleware: ReturnType<typeof createDeviceAuthMiddleware>;
  let mockReq: any;
  let mockRes: any;
  let mockNext: Mock;

  function createJwtToken(payload: any): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = 'signature';
    return `${header}.${body}.${signature}`;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    middleware = createDeviceAuthMiddleware(
      mockSupabase,
      mockAuthProvider,
      mockTenantResolver,
      deviceAuthConfig
    );

    mockReq = {
      headers: {},
    };
    mockRes = {
      status: vi.fn(() => mockRes),
      json: vi.fn(() => mockRes),
    };
    mockNext = vi.fn();
  });

  describe('authenticate()', () => {
    it('should return 401 when Authorization header missing', async () => {
      mockReq.headers = {};
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing or invalid device credentials' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is not Bearer', async () => {
      mockReq.headers = { authorization: 'Basic token' };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token payload is invalid base64', async () => {
      mockReq.headers = { authorization: 'Bearer invalid.token.here' };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing or invalid device credentials' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token type is not device', async () => {
      const payload = {
        device_id: '123e4567-e89b-12d3-a456-426614174000',
        tenant_id: '123e4567-e89b-12d3-a456-426614174001',
        type: 'user',
        iss: 'hiwms-device-api',
        aud: 'hiwms-devices',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwtToken(payload);
      mockReq.headers = { authorization: `Bearer ${token}` };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing or invalid device credentials' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token is expired', async () => {
      const payload = {
        device_id: '123e4567-e89b-12d3-a456-426614174000',
        tenant_id: '123e4567-e89b-12d3-a456-426614174001',
        type: 'device',
        iss: 'hiwms-device-api',
        aud: 'hiwms-devices',
        exp: Math.floor(Date.now() / 1000) - 3600,
      };
      const token = createJwtToken(payload);
      mockReq.headers = { authorization: `Bearer ${token}` };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing or invalid device credentials' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when issuer mismatch', async () => {
      const payload = {
        device_id: '123e4567-e89b-12d3-a456-426614174000',
        tenant_id: '123e4567-e89b-12d3-a456-426614174001',
        type: 'device',
        iss: 'wrong-issuer',
        aud: 'hiwms-devices',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwtToken(payload);
      mockReq.headers = { authorization: `Bearer ${token}` };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when audience mismatch', async () => {
      const payload = {
        device_id: '123e4567-e89b-12d3-a456-426614174000',
        tenant_id: '123e4567-e89b-12d3-a456-426614174001',
        type: 'device',
        iss: 'hiwms-device-api',
        aud: 'wrong-audience',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = createJwtToken(payload);
      mockReq.headers = { authorization: `Bearer ${token}` };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when API Key format is invalid', async () => {
      mockReq.headers = { 'x-api-key': 'invalid-format' };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing or invalid device credentials' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when API Key prefix is wrong', async () => {
      mockReq.headers = { 'x-api-key': 'wrong_prefix_device_secret' };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when device not found or inactive', async () => {
      mockReq.headers = { 'x-api-key': 'hiwms_dev_123e4567-e89b-12d3-a456-426614174000_secret' };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Device not found or inactive' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should prefer JWT over API Key when both present', async () => {
      mockReq.headers = {
        authorization: 'Bearer invalid.token.here',
        'x-api-key': 'hiwms_dev_123e4567-e89b-12d3-a456-426614174000_secret',
      };
      const authenticate = middleware.authenticate;

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });
});