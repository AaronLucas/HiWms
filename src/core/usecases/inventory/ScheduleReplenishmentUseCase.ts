/**
 * 补货调度用例
 * 替代 ReplenishmentScheduler Service，使用 Repository Port 替代 Service 依赖
 * 核心逻辑：定时检查 v_replenishment_needs 视图，自动创建 REPLENISH 类型工单
 * 支持：阈值触发、优先级排序、去重、批量派单
 */
import { IWorkOrderRepository } from '@core/ports/db/IWorkOrderRepository';
import { IInventoryRepository } from '@core/ports/db/IInventoryRepository';
import { ILocationRepository } from '@core/ports/db/ILocationRepository';
import type { Tables, TablesInsert } from '@/types/database';

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

const DEFAULT_RULES: ReplenishmentRule = {
  minFillRatePct: 20,
  maxFillRatePct: 80,
  minReplenishQty: 1,
  maxReplenishQty: 0,
  priority: 50,
  allowedZoneTypes: ['STORAGE', 'BULK'],
  excludeZoneTypes: ['DAMAGE', 'QC'],
};

/**
 * 补货调度用例
 * 使用 Repository Ports 替代 Service 依赖，符合六边形架构
 */
export class ScheduleReplenishmentUseCase {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunAt: Date | null = null;
  private runCount = 0;
  private errorCount = 0;

  constructor(
    private workOrderRepo: IWorkOrderRepository,
    private inventoryRepo: IInventoryRepository,
    private locationRepo: ILocationRepository,
    private config: SchedulerConfig
  ) {}

  /**
   * 启动调度器
   */
  start(): void {
    if (this.timer) {
      console.log('[ScheduleReplenishmentUseCase] Already running');
      return;
    }

    this.config.enabled = true;
    console.log(`[ScheduleReplenishmentUseCase] Starting with interval ${this.config.intervalMinutes} min`);

    // 立即执行一次
    this.execute().catch(err => console.error('[ScheduleReplenishmentUseCase] Initial run failed:', err));

    // 定时执行
    this.timer = setInterval(() => {
      this.execute().catch(err => console.error('[ScheduleReplenishmentUseCase] Scheduled run failed:', err));
    }, this.config.intervalMinutes * 60 * 1000);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[ScheduleReplenishmentUseCase] Stopped');
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
      console.log('[ScheduleReplenishmentUseCase] Previous run still in progress, skipping');
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
      console.log(`[ScheduleReplenishmentUseCase] Found ${needs.length} replenishment needs`);

      if (needs.length === 0) {
        result.message = 'No replenishment needs found';
        return result;
      }

      // 2. 过滤和去重
      const filteredNeeds = this.filterNeeds(needs);
      console.log(`[ScheduleReplenishmentUseCase] After filtering: ${filteredNeeds.length} needs`);

      // 3. 检查是否已有进行中的补货工单（去重）
      const deduplicatedNeeds = await this.deduplicate(filteredNeeds);
      console.log(`[ScheduleReplenishmentUseCase] After deduplication: ${deduplicatedNeeds.length} needs`);

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
      console.error('[ScheduleReplenishmentUseCase] Execution error:', error);
    } finally {
      this.isRunning = false;
    }

    return result;
  }

  /**
   * 查询补货需求视图
   */
  private async getReplenishmentNeeds(): Promise<ReplenishmentNeed[]> {
    // 使用 Inventory Repository 查询 v_replenishment_needs 视图
    const data = await this.inventoryRepo.getReplenishmentNeeds(this.config.tenantId);
    return data as ReplenishmentNeed[];
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
   * 使用 pda_summary 字段中的信息进行匹配（格式: "补货: SKU_CODE → LOC_CODE (需XXX件)"）
   */
  private async deduplicate(needs: ReplenishmentNeed[]): Promise<ReplenishmentNeed[]> {
    const deduplicated: ReplenishmentNeed[] = [];

    // 先查出所有进行中的补货工单
    const existing = await this.workOrderRepo.findAll({
      filters: {
        type: 'REPLENISH',
        status: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'],
        tenant_id: this.config.tenantId || '',
      },
    });

    for (const need of needs) {
      // 检查 pda_summary 是否匹配
      const hasExisting = existing.some(wo =>
        wo.pda_summary?.includes(`补货: ${need.sku_code}`) &&
        wo.pda_summary?.includes(`→ ${need.loc_code}`)
      );

      if (!hasExisting) {
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
    const sources = await this.inventoryRepo.findAvailableSources({
      skuId: need.sku_id,
      zoneTypes: this.config.rules.allowedZoneTypes,
      minQuantity: suggestedQty,
    });

    const sourceLoc = sources[0];

    // 生成 PDA 摘要
    const pdaSummary = `补货: ${need.sku_code} → ${need.loc_code} (需${suggestedQty}件)`;

    // 使用 WorkOrderRepository 创建工单
    await this.workOrderRepo.create({
      tenant_id: this.config.tenantId || '',
      type: 'REPLENISH',
      status: 'OPEN',
      order_id: null,
      wave_id: null,
      parent_wo_id: null,
      assigned_user_id: null,
      device_id: null,
      expected_duration_seconds: 300,
      pda_summary: pdaSummary,
      metadata: {
        replenishment: true,
        target_sku_id: need.sku_id,
        target_loc_id: need.loc_id,
        target_qty: suggestedQty,
        source_loc_id: sourceLoc?.location_id,
        current_qty: need.current_qty,
        target_fill_rate: this.config.rules.maxFillRatePct,
      },
    } as any);
  }
}

export default ScheduleReplenishmentUseCase;