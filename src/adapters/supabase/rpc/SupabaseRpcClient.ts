/**
 * Supabase RPC 客户端实现
 * 提供类型安全的存储过程调用
 */
import { WmsSupabaseClient } from '../SupabaseClient'
import { IRpcClient, RpcOptions, RpcError } from '../../../core/ports/rpc/IRpcClient'
import type { Database } from '../../../types/database'

export class SupabaseRpcClient implements IRpcClient {
  constructor(private supabase: WmsSupabaseClient) {}

  // 股票分配 RPC
  stockAllocation = {
    allocate: async (params: { p_order_id: string; p_sku_id: string; p_needed_qty: number }, options?: RpcOptions) => {
      return this.supabase.rpc('fn_logic_stock_allocation', params, options)
    },
  }

  // 黑盒收货解析 RPC
  blackboxReceiving = {
    resolve: async (params: { p_batch: string; p_lpn_code: string; p_qty: number; p_sku_id: string }, options?: RpcOptions) => {
      return this.supabase.rpc('fn_logic_resolve_blackbox_box', params, options)
    },
  }

  // 交叉理货匹配 RPC
  crossDock = {
    match: async (params: { p_qty?: number; p_receipt_id: string; p_sku_id: string }, options?: RpcOptions) => {
      return this.supabase.rpc('fn_match_cross_dock', params, options)
    },
  }

  // 滑道分配 RPC
  chuteAllocation = {
    allocate: async (params: { p_wave_id: string; p_sku_id: string }, options?: RpcOptions) => {
      return this.supabase.rpc('fn_allocate_chute', params, options)
    },
  }

  // 重量校验 RPC
  weightVerification = {
    verify: async (params: { p_sku_id: string; p_actual_weight: number }, options?: RpcOptions) => {
      return this.supabase.rpc('fn_verify_weight', params, options)
    },
  }

  // 计费规则查询 RPC
  billingRule = {
    getActive: async (params: { p_tenant_id: string }, options?: RpcOptions) => {
      return this.supabase.rpc('fn_get_active_billing_rule', params, { ...options, injectTenantId: false })
    },
  }

  // 权限检查 RPC
  permissionCheck = {
    check: async (params: { p_user_id: string; p_resource: string; p_action: string; p_scope?: string }, options?: RpcOptions) => {
      return this.supabase.rpc('check_user_permission', params, options)
    },
  }

  // 当前租户 ID RPC
  currentTenant = {
    getCurrentTenantId: async (options?: RpcOptions) => {
      return this.supabase.rpc('fn_current_tenant_id', {} as never, options)
    },
  }

  // 跨库同步 RPC
  inventorySync = {
    sync: async (params: { p_tenant_id: string }, options?: RpcOptions) => {
      return this.supabase.rpc('sync_inventory_from_source', params, { ...options, injectTenantId: false })
    },
  }

  // 交叉理货超时扫描 RPC
  crossDockTimeout = {
    sweep: async (options?: RpcOptions) => {
      return this.supabase.rpc('fn_cross_dock_timeout_sweep', {} as never, options)
    },
  }

  // 库存调整 RPC
  inventoryAdjust = {
    adjust: async (params: { p_tenant_id: string; p_sku: string; p_quantity: number; p_reason: string }, options?: RpcOptions) => {
      return this.supabase.rpc('adjust_inventory', params, { ...options, injectTenantId: false })
    },
  }

  // 清理旧日志 RPC
  purgeOldLogs = {
    purge: async (params: { p_days?: number }, options?: RpcOptions) => {
      return this.supabase.rpc('fn_purge_old_action_logs', params, options)
    },
  }

  // 通用 RPC 调用
  async raw<F extends keyof Database['public']['Functions']>(
    functionName: F,
    args: Database['public']['Functions'][F]['Args'],
    options?: RpcOptions
  ): Promise<Database['public']['Functions'][F]['Returns']> {
    const client = options?.useAdmin ? this.supabase.getAdminClient() : this.supabase.getClient()

    // 自动注入 tenant_id
    const finalArgs = { ...args } as Record<string, unknown>
    if (options?.injectTenantId !== false) {
      const tenantId = options?.tenantId ?? this.supabase.getTenantId()
      if (tenantId) {
        const tenantKey = Object.keys(finalArgs).find(k => k.includes('tenant_id'))
        if (tenantKey && !finalArgs[tenantKey]) {
          finalArgs[tenantKey] = tenantId
        }
      }
    }

    // Supabase rpc 方法只接受 PostgREST 选项，不是我们的 RpcOptions
    // 所以我们需要提取 Supabase 支持的选项
    const rpcOptions = options ? {
      head: (options as any).head,
      get: (options as any).get,
      count: (options as any).count,
    } : undefined

    const { data, error } = await client.rpc(functionName, finalArgs, rpcOptions)

    if (error) {
      throw new RpcError(
        error.code,
        error.message,
        { details: error.details, hint: error.hint },
        functionName as string
      )
    }

    return data as Database['public']['Functions'][F]['Returns']
  }
}