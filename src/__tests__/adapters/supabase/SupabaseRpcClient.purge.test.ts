/**
 * 迁移 021 批量清理 RPC 适配器单元测试
 *
 * 覆盖 SupabaseRpcClient.purgeOldLogs.purge() 的委托行为、
 * 返回类型、错误传播，以及 IPurgeOldLogsRpc 导出的 isBatchedResult()
 * 类型守卫。
 *
 * 测试范围：
 *   1. 传统清理委托（p_days 仅）→ PurgeOldLogsResultLegacy
 *   2. 批量清理委托（p_days + p_batch_size）→ PurgeOldLogsResultBatched
 *   3. isBatchedResult() 类型守卫正确区分两种结果
 *   4. RPC 错误 → RpcError 抛出
 *   5. 空结果数组处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { isBatchedResult } from '../../../core/ports/rpc/IPurgeOldLogsRpc';
import type {
  PurgeOldLogsResultLegacy,
  PurgeOldLogsResultBatched,
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

/** 预构建的传统清理 mock 返回值（单条记录） */
const legacyMockRow: PurgeOldLogsResultLegacy[number] = {
  purged_inventory_history: 150,
  purged_wo_logs: 300,
};

/** 预构建的批量清理 mock 返回值（多 batch 场景的第一条记录） */
const batchedMockRow: PurgeOldLogsResultBatched[number] = {
  batch_deleted_inventory_history: 5000,
  batch_deleted_wo_logs: 5000,
  more_batches_available: true,
  total_deleted_inventory_history: 5000,
  total_deleted_wo_logs: 5000,
};

/** 批量清理多批次的第二条记录 */
const batchedMockRow2: PurgeOldLogsResultBatched[number] = {
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
    // ---------- 传统清理（仅 p_days）----------

    it('should delegate p_days-only params to supabase.rpc and return legacy result', async () => {
      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [legacyMockRow],
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({ p_days: 180 });

      // 委托验证：RPC 函数名正确，参数透传
      expect(mockInnerClient.rpc).toHaveBeenCalledTimes(1);
      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        { p_days: 180 }
      );

      // 返回结果与被 mock 的 data 一致
      expect(result).toEqual([legacyMockRow]);
    });

    it('should return legacy result with multiple rows', async () => {
      const multiRow: PurgeOldLogsResultLegacy = [
        { purged_inventory_history: 100, purged_wo_logs: 200 },
        { purged_inventory_history: 50, purged_wo_logs: 100 },
      ];

      mockInnerClient.rpc.mockResolvedValueOnce({
        data: multiRow,
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({ p_days: 90 });

      expect(result).toEqual(multiRow);
      expect(result).toHaveLength(2);
      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        { p_days: 90 }
      );
    });

    // ---------- 批量清理（p_days + p_batch_size）----------

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
      const multiBatch: PurgeOldLogsResultBatched = [
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

    it('should handle p_batch_size=0 as a valid batch param (no-op batch)', async () => {
      const zeroBatchRow: PurgeOldLogsResultBatched[number] = {
        batch_deleted_inventory_history: 0,
        batch_deleted_wo_logs: 0,
        more_batches_available: false,
        total_deleted_inventory_history: 0,
        total_deleted_wo_logs: 0,
      };

      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [zeroBatchRow],
        error: null,
      });

      const result = await rpcClient.purgeOldLogs.purge({
        p_days: 180,
        p_batch_size: 0,
      });

      expect(result).toEqual([zeroBatchRow]);
      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        { p_days: 180, p_batch_size: 0 }
      );
    });

    // ---------- 默认参数 ----------

    it('should forward RPC call with empty object when no params given (server defaults)', async () => {
      mockInnerClient.rpc.mockResolvedValueOnce({
        data: [legacyMockRow],
        error: null,
      });

      await rpcClient.purgeOldLogs.purge({});

      expect(mockInnerClient.rpc).toHaveBeenCalledWith(
        'fn_purge_old_action_logs',
        {}
      );
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
        await rpcClient.purgeOldLogs.purge({ p_days: 180 });
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
        await rpcClient.purgeOldLogs.purge({ p_days: 180 });
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

      const result = await rpcClient.purgeOldLogs.purge({ p_days: 180 });

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

  // =========================================================================
  // isBatchedResult() — 类型守卫（导入自 IPurgeOldLogsRpc）
  // =========================================================================

  describe('isBatchedResult() type guard', () => {
    it('should return false for a legacy result', () => {
      const legacyResult: PurgeOldLogsResultLegacy = [legacyMockRow];

      expect(isBatchedResult(legacyResult)).toBe(false);
    });

    it('should return true for a batched result', () => {
      const batchedResult: PurgeOldLogsResultBatched = [batchedMockRow];

      expect(isBatchedResult(batchedResult)).toBe(true);
    });

    it('should return false for an empty array', () => {
      expect(isBatchedResult([])).toBe(false);
    });

    it('should return false for legacy result with multiple rows', () => {
      const legacyMulti: PurgeOldLogsResultLegacy = [
        { purged_inventory_history: 100, purged_wo_logs: 200 },
        { purged_inventory_history: 50, purged_wo_logs: 100 },
      ];

      expect(isBatchedResult(legacyMulti)).toBe(false);
    });

    it('should return true for batched result with multiple rows', () => {
      const batchedMulti: PurgeOldLogsResultBatched = [
        batchedMockRow,
        batchedMockRow2,
      ];

      expect(isBatchedResult(batchedMulti)).toBe(true);
    });

    it('should discriminate types when used in conditional branches', () => {
      // 模拟函数通过 isBatchedResult 后能从联合类型中区分出具体类型
      const unionResult: PurgeOldLogsResultLegacy | PurgeOldLogsResultBatched =
        [batchedMockRow];

      if (isBatchedResult(unionResult)) {
        // TypeScript 在这个分支里应该将 unionResult 缩窄为 PurgeOldLogsResultBatched
        const first = unionResult[0];
        // 批量特有字段应该可访问（运行时已验证）
        expect(first.more_batches_available).toBe(true);
        expect(first.batch_deleted_inventory_history).toBe(5000);
        expect(first.total_deleted_inventory_history).toBe(5000);
      } else {
        // 不应该走到这里
        expect.unreachable('isBatchedResult should have returned true');
      }
    });

    it('should fall through to else branch for legacy result via type discrimination', () => {
      const unionResult: PurgeOldLogsResultLegacy | PurgeOldLogsResultBatched =
        [legacyMockRow];

      if (isBatchedResult(unionResult)) {
        expect.unreachable('isBatchedResult should have returned false');
      } else {
        // TypeScript 在这个分支里应该将 unionResult 缩窄为 PurgeOldLogsResultLegacy
        const first = unionResult[0];
        expect(first.purged_inventory_history).toBe(150);
        expect(first.purged_wo_logs).toBe(300);
      }
    });
  });
});
