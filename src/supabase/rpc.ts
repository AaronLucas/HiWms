/**
 * RPC 客户端封装
 * 统一 supabase.rpc() 调用入口，提供类型安全、错误处理、租户注入
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/** 从 database.ts 导出的 Functions 类型 */
type Functions = Database['public']['Functions'];

/** RPC 参数类型提取 */
type RpcArgs<F extends keyof Functions> = Functions[F]['Args'];

/** RPC 返回类型提取 */
type RpcReturns<F extends keyof Functions> = Functions[F]['Returns'];

/** 统一错误类 */
export class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly functionName?: string
  ) {
    super(message);
    this.name = 'RpcError';
  }

  static fromPostgrest(err: { code: string; message: string; details?: string; hint?: string }, fn?: string) {
    return new RpcError(err.code, err.message, { details: err.details, hint: err.hint }, fn);
  }
}

/** RPC 调用选项 */
export interface RpcOptions {
  /** 是否自动注入 tenant_id（默认 true） */
  injectTenantId?: boolean;
  /** 显式指定 tenant_id（优先级高于自动注入） */
  tenantId?: string;
  /** 自定义 headers */
  headers?: Record<string, string>;
}

/** RPC 客户端类 */
export class RpcClient {
  private client: SupabaseClient<Database>;
  private defaultTenantId: string | null = null;

  constructor(url: string, key: string, defaultTenantId?: string) {
    this.client = createClient<Database>(url, key);
    this.defaultTenantId = defaultTenantId ?? null;
  }

  /** 设置默认租户 ID（登录后调用） */
  setTenantId(tenantId: string) {
    this.defaultTenantId = tenantId;
  }

  /** 清除默认租户 ID（登出时调用） */
  clearTenantId() {
    this.defaultTenantId = null;
  }

  /** 核心调用方法 */
  private async call<F extends keyof Functions>(
    functionName: F,
    args: RpcArgs<F>,
    options: RpcOptions = {}
  ): Promise<RpcReturns<F>> {
    const { injectTenantId = true, tenantId, headers } = options;

    // 准备参数：自动注入 tenant_id
    const finalArgs = { ...args } as Record<string, unknown>;

    if (injectTenantId) {
      const resolvedTenantId = tenantId ?? this.defaultTenantId;
      if (resolvedTenantId) {
        // 大部分 RPC 参数名为 p_tenant_id
        const tenantKey = Object.keys(finalArgs).find(k => k.includes('tenant_id'));
        if (tenantKey && !finalArgs[tenantKey]) {
          finalArgs[tenantKey] = resolvedTenantId;
        }
      }
    }

    const { data, error } = await this.client.rpc(functionName, finalArgs, {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });

    if (error) {
      throw RpcError.fromPostgrest(error, functionName);
    }

    return data as RpcReturns<F>;
  }

  // ==================== 核心业务 RPC ====================

  /** 跨箱库存分配：散货优先 → FEFO → 入库时间早 */
  async stockAllocation(
    orderId: string,
    skuId: string,
    neededQty: number,
    options?: RpcOptions
  ) {
    return this.call('fn_logic_stock_allocation', {
      p_order_id: orderId,
      p_sku_id: skuId,
      p_needed_qty: neededQty,
    }, options);
  }

  /** 黑盒入库解析：扫箱不扫货，开箱确认 SKU/数量，置 picking_priority=99 */
  async resolveBlackboxBox(
    lpnCode: string,
    skuId: string,
    qty: number,
    batch?: string,
    options?: RpcOptions
  ) {
    return this.call('fn_logic_resolve_blackbox_box', {
      p_lpn_code: lpnCode,
      p_sku_id: skuId,
      p_qty: qty,
      p_batch: batch ?? null,
    }, options);
  }

  /** 直通匹配：入库单+SKU→匹配出库单，按优先级/截单时间排序 */
  async matchCrossDock(
    receiptId: string,
    skuId: string,
    qty: number,
    options?: RpcOptions
  ) {
    return this.call('fn_match_cross_dock', {
      p_receipt_id: receiptId,
      p_sku_id: skuId,
      p_qty: qty,
    }, options);
  }

  /** 滑道分配：优先填满已用滑道、集中分拣 */
  async allocateChute(
    waveId: string,
    skuId: string,
    options?: RpcOptions
  ) {
    return this.call('fn_allocate_chute', {
      p_wave_id: waveId,
      p_sku_id: skuId,
    }, options);
  }

  /** 重量校验：基于验货规则当前生效版本自动判定 */
  async verifyWeight(
    skuId: string,
    actualWeight: number,
    options?: RpcOptions
  ) {
    return this.call('fn_verify_weight', {
      p_sku_id: skuId,
      p_actual_weight: actualWeight,
    }, options);
  }

  /** 查询生效计费规则：规范化表优先，回退 JSONB */
  async getActiveBillingRule(
    tenantId: string,
    options?: RpcOptions
  ) {
    return this.call('fn_get_active_billing_rule', {
      p_tenant_id: tenantId,
    }, { ...options, injectTenantId: false }); // 已显式传 tenantId
  }

  /** RBAC 权限检查：供 AuthMiddleware 调用 */
  async checkUserPermission(
    userId: string,
    resource: string,
    action: string,
    scope?: string,
    options?: RpcOptions
  ) {
    return this.call('check_user_permission', {
      p_user_id: userId,
      p_resource: resource,
      p_action: action,
      p_scope: scope ?? 'tenant',
    }, options);
  }

  /** 获取当前租户 ID：优先 JWT app_metadata，回退 users 表 */
  async currentTenantId(options?: RpcOptions) {
    return this.call('fn_current_tenant_id', {}, options);
  }

  /** 直通超时自动降级：MATCHED/STAGING→FALLBACK（挂 pg_cron 每 5 分） */
  async crossDockTimeoutSweep(options?: RpcOptions) {
    return this.call('fn_cross_dock_timeout_sweep', {}, options);
  }

  /** 历史日志清理：wo_action_logs + inventory_history（挂 pg_cron 每天 3 点） */
  async purgeOldActionLogs(days = 180, options?: RpcOptions) {
    return this.call('fn_purge_old_action_logs', {
      p_days: days,
    }, options);
  }

  /** 库存调整：入库/出库/盘点，乐观锁保护 */
  async adjustInventory(
    tenantId: string,
    sku: string,
    quantity: number,
    reason: string,
    options?: RpcOptions
  ) {
    return this.call('adjust_inventory', {
      p_tenant_id: tenantId,
      p_sku: sku,
      p_quantity: quantity,
      p_reason: reason,
    }, { ...options, injectTenantId: false });
  }

  // ==================== 通用调用（兜底） ====================

  /** 任意 RPC 调用（类型不安全，慎用） */
  async raw<F extends keyof Functions>(
    functionName: F,
    args: RpcArgs<F>,
    options?: RpcOptions
  ): Promise<RpcReturns<F>> {
    return this.call(functionName, args, options);
  }
}

/** 单例工厂 */
let rpcClientInstance: RpcClient | null = null;

/** 获取/创建 RPC 客户端单例 */
export function getRpcClient(tenantId?: string): RpcClient {
  if (!rpcClientInstance) {
    const url = import.meta.env.VITE_SUPABASE_URL ?? '';
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
    if (!url || !key) {
      throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    }
    rpcClientInstance = new RpcClient(url, key, tenantId);
  } else if (tenantId) {
    rpcClientInstance.setTenantId(tenantId);
  }
  return rpcClientInstance;
}

/** 重置单例（测试/登出用） */
export function resetRpcClient() {
  rpcClientInstance = null;
}

/** 类型导出供外部使用 */
export type { Functions, RpcArgs, RpcReturns, RpcOptions };
