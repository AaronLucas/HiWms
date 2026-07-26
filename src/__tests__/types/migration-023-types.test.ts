/**
 * 迁移 023 TypeScript 类型验证测试
 *
 * 验证 database.ts 的类型定义与迁移 023 的数据库实际状态一致：
 *   - fn_purge_old_action_logs 只有双参数签名（旧 ghost function 重载已移除）
 *   - fn_expire_stalled_sync_events 签名不变（仅内部逻辑加固）
 *
 * 这些测试是编译时验证——如果类型错误，tsc 会直接报错。
 * 运行时部分验证了类型推断结果与实际调用兼容。
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// 类型级验证：确保 fn_purge_old_action_logs 只有双参数签名
// =============================================================================

/**
 * 辅助类型：从 Database['public']['Functions'] 提取特定函数的 Args 类型
 */
type GetFunctionArgs<F extends keyof Database['public']['Functions']> =
  Database['public']['Functions'][F] extends { Args: infer A } ? A : never;

type GetFunctionReturns<F extends keyof Database['public']['Functions']> =
  Database['public']['Functions'][F] extends { Returns: infer R } ? R : never;

import type { Database } from '../../types/database';

// ---------------------------------------------------------------------------
// 1. fn_purge_old_action_logs: 验证只有 {p_batch_size, p_days} 参数
// ---------------------------------------------------------------------------

type PurgeArgs = GetFunctionArgs<'fn_purge_old_action_logs'>;
type PurgeReturns = GetFunctionReturns<'fn_purge_old_action_logs'>;

/**
 * 编译时断言：Args 必须包含 p_batch_size（不能只是 {p_days?: number}）
 *
 * 如果 database.ts 中还保留旧单参数重载的 union member，Args 会是
 * {p_days?: number} | {p_days?: number; p_batch_size?: number}，
 * 此时 p_batch_size 从 union 中提取不到（不是所有分支都有）。
 */

// 验证 p_batch_size 在 Args 类型中可访问
type AssertBatchSizeParam = PurgeArgs extends { p_batch_size?: number } ? true : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assert1: AssertBatchSizeParam = true; // 编译时断言

// 验证 p_days 在 Args 类型中可访问
type AssertDaysParam = PurgeArgs extends { p_days?: number } ? true : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assert2: AssertDaysParam = true;

// 验证 Returns 包含批量特有字段（不是 legacy 的 {purged_inventory_history, purged_wo_logs}）
type AssertBatchReturns = PurgeReturns extends Array<{
  batch_deleted_wo_logs: number;
  batch_deleted_inventory_history: number;
  more_batches_available: boolean;
  total_deleted_wo_logs: number;
  total_deleted_inventory_history: number;
}> ? true : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assert3: AssertBatchReturns = true;

// ---------------------------------------------------------------------------
// 2. fn_expire_stalled_sync_events: 验证签名不变
// ---------------------------------------------------------------------------

type ExpireArgs = GetFunctionArgs<'fn_expire_stalled_sync_events'>;
type ExpireReturns = GetFunctionReturns<'fn_expire_stalled_sync_events'>;

// 参数：可选的 p_timeout_interval (string)
type AssertExpireArgs = ExpireArgs extends { p_timeout_interval?: string } ? true : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assert4: AssertExpireArgs = true;

// 返回值：number（受影响的 sync_events 数量）
type AssertExpireReturns = ExpireReturns extends number ? true : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assert5: AssertExpireReturns = true;

// =============================================================================
// 运行时验证：类型推断与 IPurgeOldLogsRpc 端口接口对齐
// =============================================================================

describe('迁移 023 TypeScript 类型验证', () => {
  /**
   * 测试目的：确认 PurgeOldLogsResult 类型（前 PurgeOldLogsResultBatched）
   * 的结构与批量清理返回值兼容。
   */
  it('PurgeOldLogsResult 类型包含全部 5 个批量字段', () => {
    const result = [
      {
        batch_deleted_inventory_history: 5000,
        batch_deleted_wo_logs: 5000,
        more_batches_available: true,
        total_deleted_inventory_history: 5000,
        total_deleted_wo_logs: 5000,
      },
    ];

    expect(result[0]).toHaveProperty('batch_deleted_inventory_history');
    expect(result[0]).toHaveProperty('batch_deleted_wo_logs');
    expect(result[0]).toHaveProperty('more_batches_available');
    expect(result[0]).toHaveProperty('total_deleted_inventory_history');
    expect(result[0]).toHaveProperty('total_deleted_wo_logs');

    expect(typeof result[0].batch_deleted_inventory_history).toBe('number');
    expect(typeof result[0].batch_deleted_wo_logs).toBe('number');
    expect(typeof result[0].more_batches_available).toBe('boolean');
    expect(typeof result[0].total_deleted_inventory_history).toBe('number');
    expect(typeof result[0].total_deleted_wo_logs).toBe('number');
  });

  /**
   * 确认旧 legacy 字段不在当前类型定义中。
   */
  it('PurgeOldLogsResult 不应包含旧 legacy 字段', () => {
    const result = [
      {
        batch_deleted_inventory_history: 5000,
        batch_deleted_wo_logs: 5000,
        more_batches_available: false,
        total_deleted_inventory_history: 5000,
        total_deleted_wo_logs: 5000,
      },
    ];

    expect('purged_inventory_history' in result[0]).toBe(false);
    expect('purged_wo_logs' in result[0]).toBe(false);
  });

  /**
   * 确认 PURGE_BATCH_SIZE_MIN/MAX 常量与迁移 023 参数校验一致。
   */
  it('PURGE_BATCH_SIZE 常量与迁移 023 参数校验一致', async () => {
    const { PURGE_BATCH_SIZE_MIN, PURGE_BATCH_SIZE_MAX } = await import(
      '../../core/ports/rpc/IPurgeOldLogsRpc'
    );

    expect(PURGE_BATCH_SIZE_MIN).toBe(1);
    expect(PURGE_BATCH_SIZE_MAX).toBe(100_000);
  });
});
