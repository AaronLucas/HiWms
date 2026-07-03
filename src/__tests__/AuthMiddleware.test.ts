import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthMiddleware } from '../middleware/AuthMiddleware';
import { RoleManager } from '../services/RoleManager';

const createToken = (payload: Record<string, any>): string => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = btoa(JSON.stringify(payload));
  const signature = 'signature';
  return `${header}.${payloadStr}.${signature}`;
};

describe('AuthMiddleware', () => {
  let authMiddleware: AuthMiddleware;

  beforeEach(() => {
    const roleManagerInstance = {
      hasPermission: vi.fn().mockResolvedValue(true),
      hasRole: vi.fn().mockResolvedValue(true),
    } as unknown as RoleManager;

    authMiddleware = new AuthMiddleware(
      roleManagerInstance as RoleManager,
      {
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
      }
    );
  });

  describe('handle - missing tenant_id', () => {
    it('should return 400 when missing tenant_id', async () => {
      const request = new Request('https://api.example.com/products', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${createToken({ sub: 'user-1' })}`,
        },
      });

      const response = await authMiddleware.handle(request as unknown as Request);
      expect(response.status).toBe(400);
    });

    it('should pass tenant_id check when provided in header', async () => {
      const request = new Request('https://api.example.com/products', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${createToken({ sub: 'user-1' })}`,
          'x-tenant-id': 'tenant-123',
        },
      });

      const response = await authMiddleware.handle(request as unknown as Request);
      expect(response.status).not.toBe(400);
    });
  });

  describe('handle - missing Authorization header', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const request = new Request('https://api.example.com/products?tenant_id=tenant-123', {
        method: 'GET',
      });

      const response = await authMiddleware.handle(request as unknown as Request);
      expect(response.status).toBe(401);
    });
  });

  describe('handle - Token parsing', () => {
    it('should return 401 for invalid token', async () => {
      const request = new Request('https://api.example.com/products?tenant_id=tenant-123', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer invalid.token.here' },
      });

      const response = await authMiddleware.handle(request as unknown as Request);
      expect(response.status).toBe(401);
    });
  });
});

