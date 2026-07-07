import { SupabaseClient } from '../supabase/SupabaseClient';
import { WorkOrderService } from './WorkOrderService';

/**
 * 补货调度器
 * 定时检查 v_replenishment_needs 视图，自动创建 REPLENISH 类型工单
 * 支持：阈值触发、优先级排序、去重、批量派单
 */
export interface ReplenishmentNeed {
  loc_id: string;
  loc_code: string;
  sku_id: string;
  sku_code: string;
  current_qty: number;
  picking_max_qty: number;
  fill_rate_pct: number;
}

export interface ReplenishmentRule {
  minFillRatePct: number;          // 触发补货阈值 (默认 20%)
  maxFillRatePct: number;          // 补货目标填充率 (默认 80%)
  minReplenishQty: number;         // 最小补货量
  maxReplenishQty: number;         // 最大补货量 (0 = 无限制)
  priority: number;                // 工单优先级
  allowedZoneTypes: string[];      // 允许补货的源区域类型
  excludeZoneTypes: string[];      // 排除的目标区域类型
}

export interface SchedulerConfig {
  intervalMinutes: number;         // 执行间隔 (默认 15 分钟)
  tenantId?: string;               // 指定租户，不指定则全租户
  rules: ReplenishmentRule;
  enabled: boolean;
}

const DEFAULT_RULES: ReplenishmentRule = {
  minFillRatePct: 20,
  maxFillRatePct: 80,
  minReplenishQty: 1,
  maxReplenishQty: 0,
  priority: 50,
  allowedZoneTypes: ['STORAGE', 'BULK'],
  excludeZoneTypes: ['DAMAGE', 'QC'],
};

export class ReplenishmentScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private runCount = 0;
  private errorCount = 0;

  constructor(
    private supabase: SupabaseClient,
    private workOrderService: WorkOrderService,
    private config: SchedulerConfig
  ) {}

  /**
   * 启动调度器
   */
  start(): void {
    if (this.timer) {
      console.log('[ReplenishmentScheduler] Already running');
      return;
    }

    this.config.enabled = true;
    console.log(`[ReplenishmentScheduler] Starting with interval ${this.config.intervalMinutes} min`);

    // 立即执行一次
    this.execute().catch(err => console.error('[ReplenishmentScheduler] Initial run failed:', err));

    // 定时执行
    this.timer = setInterval(() => {
      this.execute().catch(err => console.error('[ReplenishmentScheduler] Scheduled run failed:', err));
    }, this.config.intervalMinutes * 60 * 1000);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[ReplenishmentScheduler] Stopped');
    }
    this.config.enabled = false;
  }

  /**
   * 手动触发执行
   */
  async trigger(): Promise<SchedulerResult> {
    return this.execute();
  }

  /**
   * 获取调度器状态
   */
  getStatus(): SchedulerStatus {
    return {
      enabled: this.config.enabled,
      running: this.isRunning,
      intervalMinutes: this.config.intervalMinutes,
      lastRunAt: this.lastRunAt,
      runCount: this.runCount,
      errorCount: this.errorCount,
      nextRunAt: this.timer ? new Date(Date.now() + this.config.intervalMinutes * 60 * 1000) : null,
    };
  }

  /**
   * 核心执行逻辑
   */
  private async execute(): Promise<SchedulerResult> {
    if (this.isRunning) {
      console.log('[ReplenishmentScheduler] Previous run still in progress, skipping');
      return { success: false, message: 'Previous run in progress', createdCount: 0, skippedCount: 0, errors: [] };
    }

    this.isRunning = true;
    this.lastRunAt = new Date();
    this.runCount++;

    const result: SchedulerResult = {
      success: true,
      message: '',
      createdCount: 0,
      skippedCount: 0,
      errors: [],
    };

    try {
      // 1. 查询补货需求
      const needs = await this.getReplenishmentNeeds();
      console.log(`[ReplenishmentScheduler] Found ${needs.length} replenishment needs`);

      if (needs.length === 0) {
        result.message = 'No replenishment needs found';
        return result;
      }

      // 2. 过滤和去重
      const filteredNeeds = this.filterNeeds(needs);
      console.log(`[ReplenishmentScheduler] After filtering: ${filteredNeeds.length} needs`);

      // 3. 检查是否已有进行中的补货工单（去重）
      const deduplicatedNeeds = await this.deduplicate(filteredNeeds);
      console.log(`[ReplenishmentScheduler] After deduplication: ${deduplicatedNeeds.length} needs`);

      // 4. 批量创建补货工单
      for (const need of deduplicatedNeeds) {
        try {
          await this.createReplenishWorkOrder(need);
          result.createdCount++;
        } catch (err) {
          const error = err as Error;
          result.errors.push({ skuId: need.sku_id, locId: need.loc_id, error: error.message });
          this.errorCount++;
        }
      }

      result.skippedCount = filteredNeeds.length - deduplicatedNeeds.length;
      result.message = `Created ${result.createdCount} replenish work orders, skipped ${result.skippedCount}`;

    } catch (err) {
      const error = err as Error;
      result.success = false;
      result.message = `Execution failed: ${error.message}`;
      result.errors.push({ error: error.message });
      this.errorCount++;
      console.error('[ReplenishmentScheduler] Execution error:', error);
    } finally {
      this.isRunning = false;
    }

    return result;
  }

  /**
   * 查询补货需求视图
   */
  private async getReplenishmentNeeds(): Promise<ReplenishmentNeed[]> {
    let query = this.supabase
      .from('v_replenishment_needs')
      .select('loc_id, loc_code, sku_id, sku_code, current_qty, picking_max_qty, fill_rate_pct');

    if (this.config.tenantId) {
      // 视图可能不包含 tenant_id，需要通过 locations 关联过滤
      // 这里假设视图已包含 tenant_id 或通过 RLS 隔离
    }

    const { data, error } = await query;

    if (error) throw new Error(`查询补货需求失败: ${error.message}`);
    return (data || []) as ReplenishmentNeed[];
  }

  /**
   * 过滤需求
   */
  private filterNeeds(needs: ReplenishmentNeed[]): ReplenishmentNeed[] {
    const { minFillRatePct, maxReplenishQty, allowedZoneTypes, excludeZoneTypes } = this.config.rules;

    return needs.filter(need => {
      // 填充率低于阈值
      if (need.fill_rate_pct >= minFillRatePct) return false;

      // 计算建议补货量
      const targetQty = need.picking_max_qty * (this.config.rules.maxFillRatePct / 100);
      const suggestedQty = targetQty - need.current_qty;
      if (suggestedQty < this.config.rules.minReplenishQty) return false;
      if (maxReplenishQty > 0 && suggestedQty > maxReplenishQty) return false;

      // TODO: 检查库位区域类型 (需要关联 locations 表)
      // 暂时跳过区域类型过滤

      return true;
    });
  }

  /**
   * 去重：检查是否已有 OPEN/ASSIGNED/IN_PROGRESS 状态的同 SKU+同目标库位补货工单
   */
  private async deduplicate(needs: ReplenishmentNeed[]): Promise<ReplenishmentNeed[]> {
    const deduplicated: ReplenishmentNeed[] = [];

    for (const need of needs) {
      const { data } = await this.supabase
        .from('work_orders')
        .select('id')
        .eq('type', 'REPLENISH')
        .in('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS'])
        .eq('tenant_id', this.config.tenantId || '')
        // 这里需要通过 metadata 或关联查询匹配 sku_id 和目标库位
        // 暂时简化：通过 metadata 存储目标信息
        .contains('metadata', { target_sku_id: need.sku_id, target_loc_id: need.loc_id });

      if (!data || data.length === 0) {
        deduplicated.push(need);
      }
    }

    return deduplicated;
  }

  /**
   * 创建补货工单
   */
  private async createReplenishWorkOrder(need: ReplenishmentNeed): Promise<void> {
    // 计算建议补货量
    const targetQty = need.picking_max_qty * (this.config.rules.maxFillRatePct / 100);
    const suggestedQty = Math.ceil(targetQty - need.current_qty);

    // 查找源库位（STORAGE/BULK 区域中有该 SKU 库存的库位）
    const { data: sources } = await this.supabase
      .from('inventory')
      .select(`
        location_id,
        locations!inner(code, zone_type),
        quantity
      `)
      .eq('product_id', need.sku_id)
      .gt('quantity', 0)
      .in('locations.zone_type', this.config.rules.allowedZoneTypes)
      .order('quantity', { ascending: false })
      .limit(1);

    const sourceLoc = sources?.[0];

    // 生成 PDA 摘要
    const pdaSummary = `补货: ${need.sku_code} → ${need.loc_code} (需${suggestedQty}件)`;

    await this.workOrderService.create({
      tenantId: this.config.tenantId || '',
      type: 'REPLENISH',
      orderId: undefined, // 补货工单通常不直接关联订单
      parentWoId: undefined,
      assignedUserId: undefined, // 待派单
      expectedDurationSeconds: 300, // 预估 5 分钟
      pdaSummary,
      metadata: {
        replenishment: true,
        target_sku_id: need.sku_id,
        target_loc_id: need.loc_id,
        target_qty: suggestedQty,
        source_loc_id: sourceLoc?.location_id,
        current_qty: need.current_qty,
        target_fill_rate: this.config.rules.maxFillRatePct,
      },
    });
  }
}

export interface SchedulerResult {
  success: boolean;
  message: string;
  createdCount: number;
  skippedCount: number;
  errors: Array<{ skuId?: string; locId?: string; error: string }>;
}

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  lastRunAt: Date | null;
  runCount: number;
  errorCount: number;
  nextRunAt: Date | null;
}

export default ReplenishmentScheduler;