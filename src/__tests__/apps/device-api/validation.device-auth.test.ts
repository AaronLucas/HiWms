/**
 * 设备认证 Schema 单元测试
 * 覆盖：deviceProvisionSchema、deviceLoginSchema、deviceRefreshSchema 合法/非法输入
 */

import { describe, it, expect } from 'vitest';
import {
  deviceProvisionSchema,
  deviceLoginSchema,
  deviceRefreshSchema,
  type DeviceProvisionRequest,
  type DeviceLoginRequest,
  type DeviceRefreshRequest,
} from '../../../apps/device-api/validation';

describe('validation - Device Auth Schemas', () => {
  describe('deviceProvisionSchema', () => {
    it('应通过合法的设备注册请求', () => {
      const validInput: DeviceProvisionRequest = {
        device_code: 'PDA-WH-001',
        device_type: 'PDA',
        note: '一楼拣货区设备',
      };

      const result = deviceProvisionSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validInput);
      }
    });

    it('device_code 必填且长度 1-64', () => {
      expect(deviceProvisionSchema.safeParse({ device_code: '', device_type: 'PDA' }).success).toBe(false);
      expect(deviceProvisionSchema.safeParse({ device_code: 'a'.repeat(65), device_type: 'PDA' }).success).toBe(false);
      expect(deviceProvisionSchema.safeParse({ device_code: 'a'.repeat(64), device_type: 'PDA' }).success).toBe(true);
    });

    it('device_type 必须是枚举值', () => {
      const validTypes = ['PDA', 'SCANNER', 'PRINTER', 'RFID_READER', 'MOUNTED', 'OTHER'];
      validTypes.forEach(type => {
        expect(deviceProvisionSchema.safeParse({ device_code: 'TEST', device_type: type }).success).toBe(true);
      });
      expect(deviceProvisionSchema.safeParse({ device_code: 'TEST', device_type: 'INVALID' }).success).toBe(false);
    });

    it('note 可选', () => {
      expect(deviceProvisionSchema.safeParse({ device_code: 'TEST', device_type: 'PDA' }).success).toBe(true);
      expect(deviceProvisionSchema.safeParse({ device_code: 'TEST', device_type: 'PDA', note: '备注' }).success).toBe(true);
    });

    it('应剥离未声明字段', () => {
      const input = { device_code: 'TEST', device_type: 'PDA', extra_field: 'should be stripped' };
      const result = deviceProvisionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect('extra_field' in result.data).toBe(false);
      }
    });
  });

  describe('deviceLoginSchema', () => {
    const validLoginInput: DeviceLoginRequest = {
      device_id: '123e4567-e89b-12d3-a456-426614174000',
      api_key: 'hiwms_dk_123e4567-e89b-12d3-a456-426614174000_abcdef123456',
      fcm_token: 'fcm-token-123',
      app_version: '2.1.0',
      os_version: 'Android 13',
      device_model: 'Zebra TC58',
    };

    it('应通过合法的设备登录请求', () => {
      const result = deviceLoginSchema.safeParse(validLoginInput);
      expect(result.success).toBe(true);
    });

    it('device_id 必须是合法 UUID', () => {
      const invalid = { ...validLoginInput, device_id: 'not-a-uuid' };
      expect(deviceLoginSchema.safeParse(invalid).success).toBe(false);
    });

    it('api_key 必填且必须以 hiwms_dk_ 开头', () => {
      expect(deviceLoginSchema.safeParse({ ...validLoginInput, api_key: '' }).success).toBe(false);
      expect(deviceLoginSchema.safeParse({ ...validLoginInput, api_key: 'wrong_prefix_xxx' }).success).toBe(false);
      expect(deviceLoginSchema.safeParse({ ...validLoginInput, api_key: 'hiwms_dk_123e4567-e89b-12d3-a456-426614174000_secret' }).success).toBe(true);
    });

    it('可选字段可省略', () => {
      const minimal = { device_id: validLoginInput.device_id, api_key: validLoginInput.api_key };
      expect(deviceLoginSchema.safeParse(minimal).success).toBe(true);
    });

    it('应剥离未声明字段', () => {
      const input = { ...validLoginInput, extra_field: 'should be stripped' };
      const result = deviceLoginSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect('extra_field' in result.data).toBe(false);
      }
    });
  });

  describe('deviceRefreshSchema', () => {
    it('应通过合法的刷新请求', () => {
      const result = deviceRefreshSchema.safeParse({ refresh_token: 'valid-refresh-token' });
      expect(result.success).toBe(true);
    });

    it('refresh_token 必填', () => {
      expect(deviceRefreshSchema.safeParse({ refresh_token: '' }).success).toBe(false);
      expect(deviceRefreshSchema.safeParse({}).success).toBe(false);
    });

    it('应剥离未声明字段', () => {
      const result = deviceRefreshSchema.safeParse({ refresh_token: 'token', extra: 'field' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect('extra' in result.data).toBe(false);
      }
    });
  });
});