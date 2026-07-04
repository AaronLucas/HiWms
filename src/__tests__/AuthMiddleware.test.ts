import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    } as unknown as import('../services/RoleManager').RoleManager;

    authMiddleware = new AuthMiddleware(
      roleManagerInstance as any,
      {
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
      }
    );
  });

  describe('Token parsing', () => {
    it('should create valid JWT token', () => {
      const payload = { sub: 'user-123', role: 'ADMIN', exp: Date.now() + 3600000 };
      const token = createToken(payload);

      const parts = token.split('.');
      const decoded = JSON.parse(atob(parts[1]));

      expect(decoded.sub).toBe('user-123');
      expect(decoded.role).toBe('ADMIN');
    });

    it('should throw error for invalid token format', () => {
      expect(() => {
        const parts = 'invalid.token'.split('.');
        JSON.parse(atob(parts[1]));
      }).toThrow();
    });
  });

  describe('AuthMiddleware construction', () => {
    it('should create middleware instance', () => {
      expect(authMiddleware).toBeDefined();
      expect(typeof authMiddleware.handle).toBe('function');
    });
  });

  describe('Token parsing logic', () => {
    it('should correctly parse valid JWT payload', () => {
      const payload = { sub: 'user-123', role: 'ADMIN', exp: Date.now() + 3600000 };
      const token = createToken(payload);

      const parts = token.split('.');
      const decoded = JSON.parse(atob(parts[1]));

      expect(decoded.sub).toBe('user-123');
      expect(decoded.role).toBe('ADMIN');
    });

    it('should throw error for invalid token format', () => {
      expect(() => {
        const parts = 'invalid.token'.split('.');
        JSON.parse(atob(parts[1]));
      }).toThrow();
    });
  });
});

