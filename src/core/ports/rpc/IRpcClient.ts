/**
 * 统一 RPC 客户端端口接口
 * 所有适配器实现此接口
 * 基于数据库实际函数签名定义
 */
export interface IRpcClient {
  /** 股票分配 RPC */
  stockAllocation: {
    allocate(params: {
      p_order_id: string;
      p_sku_id: string;
      p_needed_qty: number;
    }): Promise<Array<{ alloc_qty: number; source_lpn: string }>>;
  };

  /** 黑盒收货解析 RPC */
  blackboxReceiving: {
    resolve(params: {
      p_batch: string;
      p_lpn_code: string;
      p_qty: number;
      p_sku_id: string;
    }): Promise<unknown>;
  };

  /** 交叉理货匹配 RPC */
  crossDock: {
    match(params: {
      p_qty?: number;
      p_receipt_id: string;
      p_sku_id: string;
    }): Promise<Array<{
      job_id: string;
      matched_qty: number;
      outbound_order_id: string;
      staging_loc_id: string;
    }>>;
  };

  /** 滑道分配 RPC */
  chuteAllocation: {
    allocate(params: {
      p_wave_id: string;
      p_sku_id: string;
    }): Promise<Array<{
      allocated_qty: number;
      chute_code: string;
      chute_id: string;
    }>>;
  };

  /** 重量校验 RPC */
  weightVerification: {
    verify(params: {
      p_sku_id: string;
      p_actual_weight: number;
    }): Promise<Array<{
      expected_max: number;
      expected_min: number;
      passed: boolean;
      rule_id: string;
      tolerance_pct: number;
    }>>;
  };

  /** 计费规则查询 RPC */
  billingRule: {
    getActive(params: {
      p_tenant_id: string;
    }): Promise<Array<{
      rule_id: string;
      rule_name: string;
      currency: string;
      source: string;
    }>>;
  };

  /** 权限检查 RPC */
  permissionCheck: {
    check(params: {
      p_user_id: string;
      p_resource: string;
      p_action: string;
      p_scope?: string;
    }): Promise<Array<{
      has_permission: boolean;
    }>>;
  };

  /** 当前租户 ID RPC */
  currentTenant: {
    getCurrentTenantId(): Promise<string>;
  };

  /** 跨库同步 RPC */
  inventorySync: {
    sync(params: {
      p_tenant_id: string;
    }): Promise<Array<{
      synced_count: number;
    }>>;
  };

  /** 库存调整 RPC */
  inventoryAdjust: {
    adjust(params: {
      p_tenant_id: string;
      p_sku: string;
      p_quantity: number;
      p_reason: string;
    }): Promise<Array<{
      id: string;
      quantity: number;
    }>>;
  };

  /** 交叉理货超时扫描 RPC */
  crossDockTimeout: {
    sweep(): Promise<number>;
  };

  /** 清理旧日志 RPC */
  purgeOldLogs: {
    purge(params: {
      p_days?: number;
    }): Promise<Array<{
      purged_inventory_history: number;
      purged_wo_logs: number;
    }>>;
  };

  /** 通用 RPC 调用 */
  raw<F extends keyof Database['public']['Functions']>(
    functionName: F,
    args: Database['public']['Functions'][F]['Args'],
    options?: RpcOptions
  ): Promise<Database['public']['Functions'][F]['Returns']>;
}

/** RPC 调用选项 */
export interface RpcOptions {
  /** 是否自动注入 tenant_id（默认 true） */
  injectTenantId?: boolean;
  /** 显式指定 tenant_id */
  tenantId?: string;
  /** 自定义 headers */
  headers?: Record<string, string>;
  /** 是否使用管理员客户端 */
  useAdmin?: boolean;
}

/** RPC 错误类 */
export class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: { details?: string; hint?: string },
    public readonly functionName?: string
  ) {
    super(message);
    this.name = 'RpcError';
  }

  static fromPostgrest(
    err: { code: string; message: string; details?: string; hint?: string },
    fn?: string
  ): RpcError {
    return new RpcError(err.code, err.message, { details: err.details, hint: err.hint }, fn);
  }
}

/** 数据库类型引用（仅用于类型推导） */
import type { Database } from '../../../types/database';