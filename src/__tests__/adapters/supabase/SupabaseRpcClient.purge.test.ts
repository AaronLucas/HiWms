/**
 * 迁移 023 批量清理 RPC 适配器单元测试
 *
 * 覆盖 SupabaseRpcClient.purgeOldLogs.purge() 的委托行为、
 * 返回类型、错误传播、参数校验。
 *
 * 迁移 023（2026-07-26）：DROP 旧 ghost function fn_purge_old_action_logs(INT)，
 * 统一为双参数批量重载。legacy 类型和 isBatchedResult() 类型守卫已移除。
 *
 * 测试范围：
 *   1. 批量清理委托（p_days + p_batch_size）→ PurgeOldLogsResult
 *   2. 最小参数委托（仅 p_batch_size）→ 服务端使用默认 p_days
 *   3. p_batch_size 参数校验（范围外/零/负数 → RpcError）
 *   4. RPC 错误 → RpcError 抛出
 *   5. 空结果数组处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import {
  PURGE_BATCH_SIZE_MIN,
  PURGE_BATCH_SIZE_MAX,
} from '../../../core/ports/rpc/IPurgeOldLogsRpc';
import type {
  PurgeOldLogsResult,
} from '../../../core/ports/rpc/IPurgeOldLogsRpc';
import { RpcError } from '../../../core/ports/rpc/IRpcClient';
import { createClient } from '@supabase/supabase-js';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);

// ---------------------------------------------------------------------------
// 共享夹具
// ---------------------------------------------------------------------------

/** 预构建的批量清理 mock 返回值（多 batch 场景的第一条记录） */
const batchedMockRow: PurgeOldLogsResult[number] = {
  batch_deleted_inventory_history: 5000,
  batch_deleted_wo_logs: 5000,
  more_batches_available: true,
  total_deleted_inventory_history: 5000,
  total_deleted_wo_logs: 5000,
};

/** 批量清理多批次的第二条记录 */
const batchedMockRow2: PurgeOldLogsResult[number] = {
  batch_deleted_inventory_history: 2000,
  batch_deleted_wo_logs: 3000,
  more_batches_available: false,
  total_deleted_inventory_history: 7000,
  total_deleted_wo_logs: 8000,
};

const config = {
  url: 'https://test.supabase.co',
  anonKey: 'test-anon-key',
  serviceRoleKey: 'test-service-role-key',
};

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('SupabaseRpcClient - purgeOldLogs (迁移 021)', () => {
  let supabase: WmsSupabaseClient;
  let rpcClient: SupabaseRpcClient;
  let mockInnerClient: { rpc: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockReset();

    // 重置单例——每次测试使用全新实例
    (WmsSupabaseClient as any).instance = null;

    mockInnerClient = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockCreateClient.mockReturnValue(mockInnerClient);

    supabase = WmsSupabaseClient.getInstance(config);
    rpcClient = new SupabaseRpcClient(supabase);
  });

  // =========================================================================
  // purge()
  // =========================================================================

  describe('purge()', () => {
    // ---------- 批量清理委托 ----------

    it('should delegate batch params to supabase.rpc and return batched result', async () => {
      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [batchedMockRow],
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({
        p_days: 180,
        p_batch_size: 5000,
      });

      // 委托验证：参数完整透传
      expect(mockInnerClient.rpc).toHaveBeenCalledTimes(1);
      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        { p_days: 180, p_batch_size: 5000 }
      );

      // 返回结果包含批量特有字段
      expect(result).toEqual([batchedMockRow]);
      expect(result[0]).toHaveProperty('more_batches_available');
    });

    it('should return batched result with multiple batch rows', async () => {
      const multiBatch: PurgeOldLogsResult = [
        batchedMockRow,
        batchedMockRow2,
      ];

      mockInnerClient.rpc.mockResolvedValueOnce({
        data: multiBatch,
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({
        p_days: 365,
        p_batch_size: 10000,
      });

      expect(result).toEqual(multiBatch);
      expect(result).toHaveLength(2);
      // 第一条 still has more batches
      expect(result[0].more_batches_available).toBe(true);
      // 第二条 marks completion
      expect(result[1].more_batches_available).toBe(false);
      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        { p_days: 365, p_batch_size: 10000 }
      );
    });

    it('should delegate minimum params (only p_batch_size) to supabase.rpc', async () => {
      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [batchedMockRow],
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({ p_batch_size: 5000 });

      expect(mockInnerClient.rpc).toHaveBeenCalledTimes(1);
      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        { p_batch_size: 5000 }
      );
      expect(result).toEqual([batchedMockRow]);
    });

    it('should delegate p_days + p_batch_size with minimum valid batch size', async () => {
      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [batchedMockRow],
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({
        p_days: 180,
        p_batch_size: PURGE_BATCH_SIZE_MIN,
      });

      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        { p_days: 180, p_batch_size: 1 }
      );
      expect(result).toEqual([batchedMockRow]);
    });

    it('should delegate p_days + p_batch_size with maximum valid batch size', async () => {
      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [batchedMockRow],
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({
        p_days: 180,
        p_batch_size: PURGE_BATCH_SIZE_MAX,
      });

      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        { p_days: 180, p_batch_size: 100_000 }
      );
      expect(result).toEqual([batchedMockRow]);
    });

    // ---------- 参数校验（安全加固 H2）----------

    it('should throw RpcError for p_batch_size=0 (below minimum)', async () => {
      let caught: unknown = null;
      try {
        await rpcClient.purgeOldLogs.purge({ p_days: 180, p_batch_size: 0 });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(RpcError);
      expect((caught as RpcError).code).toBe('INVALID_PARAM');
      expect((caught as RpcError).message).toContain(
        `p_batch_size must be between ${PURGE_BATCH_SIZE_MIN} and ${PURGE_BATCH_SIZE_MAX}`
      );
      expect((caught as RpcError).functionName).toBe('fn_purge_old_action_logs');
      // 不应该发出 RPC 调用
      expect(mockInnerClient.rpc).not.toHaveBeenCalled();
    });

    it('should throw RpcError for negative p_batch_size', async () => {
      let caught: unknown = null;
      try {
        await rpcClient.purgeOldLogs.purge({ p_days: 180, p_batch_size: -1 });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(RpcError);
      expect((caught as RpcError).code).toBe('INVALID_PARAM');
      expect(mockInnerClient.rpc).not.toHaveBeenCalled();
    });

    it('should throw RpcError for p_batch_size exceeding maximum', async () => {
      let caught: unknown = null;
      try {
        await rpcClient.purgeOldLogs.purge({
          p_days: 180,
          p_batch_size: PURGE_BATCH_SIZE_MAX + 1,
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(RpcError);
      expect((caught as RpcError).code).toBe('INVALID_PARAM');
      expect(mockInnerClient.rpc).not.toHaveBeenCalled();
    });

    // ---------- 错误传播 ----------

    it('should throw RpcError when RPC returns an error', async () => {
      const pgError = {
        code: 'PGRST301',
        message: 'function fn_purge_old_action_logs() does not exist',
        details: 'The function could not be found',
        hint: 'Verify the function name',
      };

      mockInnerClient.rpc.mockResolvedValueOnce({
        data: null,
        error: pgError,
      });

      let caught: unknown = null;
      try {
        await rpcClient.purgeOldLogs.purge({ p_days: 180, p_batch_size: 5000 });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(RpcError);
      expect((caught as RpcError).message).toBe(
        'function fn_purge_old_action_logs() does not exist'
      );
      expect((caught as RpcError).code).toBe('PGRST301');
      expect((caught as RpcError).functionName).toBe(
        'fn_purge_old_action_logs'
      );
    });

    it('should propagate RpcError with correct code and function name', async () => {
      const pgError = {
        code: '57014',
        message: 'canceling statement due to statement timeout',
        details: 'Query exceeded timeout',
        hint: 'Increase statement_timeout',
      };

      mockInnerClient.rpc.mockResolvedValueOnce({
        data: null,
        error: pgError,
      });

      let caught: RpcError | null = null;
      try {
        await rpcClient.purgeOldLogs.purge({ p_days: 180, p_batch_size: 5000 });
      } catch (e) {
        caught = e as RpcError;
      }

      expect(caught).toBeInstanceOf(RpcError);
      expect(caught!.code).toBe('57014');
      expect(caught!.functionName).toBe('fn_purge_old_action_logs');
    });

    it('should throw RpcError for batch params when RPC errors', async () => {
      const pgError = {
        code: '54000',
        message: 'program limit exceeded',
        details: '',
        hint: '',
      };

      mockInnerClient.rpc.mockResolvedValueOnce({
        data: null,
        error: pgError,
      });

      await expect(
        rpcClient.purgeOldLogs.purge({
          p_days: 180,
          p_batch_size: 5000,
        })
      ).rejects.toThrow(RpcError);
    });

    // ---------- 空结果数组 ----------

    it('should return empty array when RPC returns empty data (no logs to purge)', async () => {
      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({ p_days: 180, p_batch_size: 5000 });

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('should return empty array for batch params when no rows to purge', async () => {
      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({
        p_days: 365,
        p_batch_size: 5000,
      });

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

});
