/**
 * Device API 请求验证 Schemas 测试
 */

import { describe, it, expect } from 'vitest';
import {
  syncEventSchema,
  syncEventsRequestSchema,
  syncPullQuerySchema,
  syncPolicyQuerySchema,
  taskClaimRequestSchema,
  taskClaimParamsSchema,
  taskClaimReleaseParamsSchema,
  exceptionsQuerySchema,
  exceptionParamsSchema,
} from '../../apps/device-api/validation';

describe('Device API Validation Schemas', () => {
  // ========== syncEventSchema ==========
  describe('syncEventSchema', () => {
    const validEvent = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      device_id: '123e4567-e89b-12d3-a456-426614174001',
      device_seq: 1,
      action_type: 'PICK' as const,
      payload: { order_line_id: '123', qty: 5 },
      captured_at: '2026-07-17T10:30:00.000Z',
    };

    it('should pass valid PICK event', () => {
      const result = syncEventSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('should pass valid PUTAWAY event', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, action_type: 'PUTAWAY' });
      expect(result.success).toBe(true);
    });

    it('should pass valid COUNT event', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, action_type: 'COUNT' });
      expect(result.success).toBe(true);
    });

    it('should pass valid PACK event', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, action_type: 'PACK' });
      expect(result.success).toBe(true);
    });

    it('should fail on invalid UUID id', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, id: 'invalid-uuid' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.id).toBeDefined();
      }
    });

    it('should fail on invalid UUID device_id', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, device_id: 'invalid-uuid' });
      expect(result.success).toBe(false);
    });

    it('should fail on zero device_seq', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, device_seq: 0 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.device_seq).toBeDefined();
      }
    });

    it('should fail on negative device_seq', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, device_seq: -1 });
      expect(result.success).toBe(false);
    });

    it('should fail on invalid action_type', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, action_type: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should fail on missing captured_at', () => {
      const { captured_at, ...event } = validEvent;
      const result = syncEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it('should fail on invalid ISO datetime', () => {
      const result = syncEventSchema.safeParse({ ...validEvent, captured_at: 'not-a-date' });
      expect(result.success).toBe(false);
    });

    it('should accept valid ISO datetime with offset', () => {
      const result = syncEventSchema.safeParse({
        ...validEvent,
        captured_at: '2026-07-17T10:30:00+09:00',
      });
      expect(result.success).toBe(true);
    });
  });

  // ========== syncEventsRequestSchema ==========
  describe('syncEventsRequestSchema', () => {
    const validRequest = {
      events: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          device_id: '123e4567-e89b-12d3-a456-426614174001',
          device_seq: 1,
          action_type: 'PICK' as const,
          payload: { order_line_id: '123', qty: 5 },
          captured_at: '2026-07-17T10:30:00.000Z',
        },
      ],
    };

    it('should pass valid request', () => {
      const result = syncEventsRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should fail on empty events array', () => {
      const result = syncEventsRequestSchema.safeParse({ events: [] });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.events).toContain('At least one event required');
      }
    });

    it('should fail on missing events', () => {
      const result = syncEventsRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should fail on non-array events', () => {
      const result = syncEventsRequestSchema.safeParse({ events: 'not-array' });
      expect(result.success).toBe(false);
    });
  });

  // ========== syncPullQuerySchema ==========
  describe('syncPullQuerySchema', () => {
    it('should pass valid query with since_seq and limit', () => {
      const result = syncPullQuerySchema.safeParse({ since_seq: '100', limit: '50' });
      expect(result.success).toBe(true);
      expect(result.data?.since_seq).toBe(100);
      expect(result.data?.limit).toBe(50);
    });

    it('should use default since_seq=0', () => {
      const result = syncPullQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data?.since_seq).toBe(0);
    });

    it('should use default limit=100', () => {
      const result = syncPullQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data?.limit).toBe(100);
    });

    it('should fail on negative since_seq', () => {
      const result = syncPullQuerySchema.safeParse({ since_seq: '-1' });
      expect(result.success).toBe(false);
    });

    it('should fail on limit > 1000', () => {
      const result = syncPullQuerySchema.safeParse({ limit: '1001' });
      expect(result.success).toBe(false);
    });

    it('should fail on zero limit', () => {
      const result = syncPullQuerySchema.safeParse({ limit: '0' });
      expect(result.success).toBe(false);
    });
  });

  // ========== syncPolicyQuerySchema ==========
  describe('syncPolicyQuerySchema', () => {
    it('should pass valid task_type and zone_type', () => {
      const result = syncPolicyQuerySchema.safeParse({
        task_type: 'PICK',
        zone_type: 'PICK',
      });
      expect(result.success).toBe(true);
    });

    it('should pass empty query (both optional)', () => {
      const result = syncPolicyQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should fail on invalid task_type', () => {
      const result = syncPolicyQuerySchema.safeParse({ task_type: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should fail on invalid zone_type', () => {
      const result = syncPolicyQuerySchema.safeParse({ zone_type: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should accept all valid task_types', () => {
      const validTypes = ['PICK', 'PUTAWAY', 'COUNT', 'PACK', 'RECEIVE', 'LOAD', 'INVENTORY'];
      for (const type of validTypes) {
        const result = syncPolicyQuerySchema.safeParse({ task_type: type });
        expect(result.success).toBe(true);
      }
    });

    it('should accept all valid zone_types', () => {
      const validTypes = ['PICK', 'BULK', 'CROSS_DOCK', 'STAGING', 'COLD', 'HAZMAT'];
      for (const type of validTypes) {
        const result = syncPolicyQuerySchema.safeParse({ zone_type: type });
        expect(result.success).toBe(true);
      }
    });
  });

  // ========== taskClaimRequestSchema ==========
  describe('taskClaimRequestSchema', () => {
    it('should pass valid request', () => {
      const result = taskClaimRequestSchema.safeParse({
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        device_id: '123e4567-e89b-12d3-a456-426614174001',
        lease_seconds: 300,
      });
      expect(result.success).toBe(true);
      expect(result.data?.lease_seconds).toBe(300);
    });

    it('should use default lease_seconds=300', () => {
      const result = taskClaimRequestSchema.safeParse({
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        device_id: '123e4567-e89b-12d3-a456-426614174001',
      });
      expect(result.success).toBe(true);
      expect(result.data?.lease_seconds).toBe(300);
    });

    it('should fail on invalid user_id UUID', () => {
      const result = taskClaimRequestSchema.safeParse({
        user_id: 'invalid',
        device_id: '123e4567-e89b-12d3-a456-426614174001',
      });
      expect(result.success).toBe(false);
    });

    it('should fail on lease_seconds > 3600', () => {
      const result = taskClaimRequestSchema.safeParse({
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        device_id: '123e4567-e89b-12d3-a456-426614174001',
        lease_seconds: 3601,
      });
      expect(result.success).toBe(false);
    });

    it('should fail on lease_seconds <= 0', () => {
      const result = taskClaimRequestSchema.safeParse({
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        device_id: '123e4567-e89b-12d3-a456-426614174001',
        lease_seconds: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  // ========== taskClaimParamsSchema ==========
  describe('taskClaimParamsSchema', () => {
    it('should pass valid UUID', () => {
      const result = taskClaimParamsSchema.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
    });

    it('should fail on invalid UUID', () => {
      const result = taskClaimParamsSchema.safeParse({ id: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  // ========== taskClaimReleaseParamsSchema ==========
  describe('taskClaimReleaseParamsSchema', () => {
    it('should pass valid UUID', () => {
      const result = taskClaimReleaseParamsSchema.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
    });

    it('should fail on invalid UUID', () => {
      const result = taskClaimReleaseParamsSchema.safeParse({ id: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  // ========== exceptionsQuerySchema ==========
  describe('exceptionsQuerySchema', () => {
    it('should pass valid query with all filters', () => {
      const result = exceptionsQuerySchema.safeParse({
        status: 'PENDING_REVIEW',
        domain: 'INVENTORY',
        severity: 'HIGH',
        limit: '20',
        offset: '10',
      });
      expect(result.success).toBe(true);
      expect(result.data?.limit).toBe(20);
      expect(result.data?.offset).toBe(10);
    });

    it('should use defaults for limit and offset', () => {
      const result = exceptionsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data?.limit).toBe(50);
      expect(result.data?.offset).toBe(0);
    });

    it('should fail on invalid status', () => {
      const result = exceptionsQuerySchema.safeParse({ status: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should fail on invalid domain', () => {
      const result = exceptionsQuerySchema.safeParse({ domain: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should fail on invalid severity', () => {
      const result = exceptionsQuerySchema.safeParse({ severity: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should fail on limit > 200', () => {
      const result = exceptionsQuerySchema.safeParse({ limit: '201' });
      expect(result.success).toBe(false);
    });

    it('should accept all valid statuses', () => {
      const statuses = ['PENDING_REVIEW', 'CONFLICT', 'RESOLVED', 'DISMISSED'];
      for (const status of statuses) {
        const result = exceptionsQuerySchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it('should accept all valid domains', () => {
      const domains = ['INVENTORY', 'SYNC', 'COMPLIANCE', 'TASK', 'FULFILLMENT', 'BILLING', 'OTHER'];
      for (const domain of domains) {
        const result = exceptionsQuerySchema.safeParse({ domain });
        expect(result.success).toBe(true);
      }
    });

    it('should accept all valid severities', () => {
      const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      for (const severity of severities) {
        const result = exceptionsQuerySchema.safeParse({ severity });
        expect(result.success).toBe(true);
      }
    });
  });

  // ========== exceptionParamsSchema ==========
  describe('exceptionParamsSchema', () => {
    it('should pass valid UUID', () => {
      const result = exceptionParamsSchema.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
    });

    it('should fail on invalid UUID', () => {
      const result = exceptionParamsSchema.safeParse({ id: 'invalid' });
      expect(result.success).toBe(false);
    });
  });
});