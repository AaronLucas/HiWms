import { SupabaseClient } from '../supabase/SupabaseClient';

/**
 * 计费引擎
 * 解析 tenants.billing_strategy JSONB，支持：
 * - 阶梯存储费 (storage_stepped)
 * - 人工费
 * - 耗材费
 * - 增值服务费 (VAS)
 * - 货币换算
 * - 体量折扣
 */
export interface BillingStrategy {
  storage_stepped: StorageStep[];
  currency: string;
  labor_rates?: LaborRate[];
  consumable_rates?: ConsumableRate[];
  vas_rates?: VasRate[];
}

export interface StorageStep {
  min_days: number;
  max_days: number | null;
  rate: number;           // 单价 (每立方米/天 或 每托盘/天)
  description: string;
  billing_cycle: 'DAILY' | 'MONTHLY';
  prorated: boolean;      // 是否按天折算
  min_charge: number;     // 最低收费
  max_charge: number | null; // 最高收费
  currency: string;
  effective_date: string; // YYYY-MM-DD
  expiry_date: string | null; // YYYY-MM-DD
  escalation?: { after_days: number; new_rate: number };
  discounts?: VolumeDiscount[];
}

export interface LaborRate {
  task_type: 'PICK' | 'PACK' | 'PUTAWAY' | 'COUNT' | 'REPLENISH';
  unit: 'PER_ORDER' | 'PER_LINE' | 'PER_UNIT' | 'PER_HOUR';
  rate: number;
  currency: string;
}

export interface ConsumableRate {
  item_type: 'BOX' | 'TAPE' | 'LABEL' | 'PALLET' | 'STRETCH_FILM';
  unit: 'PER_UNIT';
  rate: number;
  currency: string;
}

export interface VasRate {
  process_type: 'RELABEL' | 'KITTING' | 'DEKITTING' | 'QUALITY_CHECK';
  unit: 'PER_ORDER' | 'PER_UNIT' | 'PER_HOUR';
  rate: number;
  currency: string;
}

export interface VolumeDiscount {
  type: 'VOLUME' | 'REVENUE' | 'ORDERS';
  threshold: number;
  discount_rate: number; // 0.1 = 10% off
  max_discount?: number;
}

export interface BillingContext {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  currency?: string; // 目标结算货币，默认使用策略货币
}

export interface StorageBillingInput {
  skuId: string;
  volumeM3: number;        // 单品体积 (m³)
  qty: number;             // 数量
  daysInStorage: number;   // 实际存储天数
  zoneType: string;        // 库位类型
}

export interface LaborBillingInput {
  taskType: 'PICK' | 'PACK' | 'PUTAWAY' | 'COUNT' | 'REPLENISH';
  orderCount: number;
  lineCount: number;
  unitCount: number;
  hours: number;
}

export interface ConsumableBillingInput {
  itemType: 'BOX' | 'TAPE' | 'LABEL' | 'PALLET' | 'STRETCH_FILM';
  quantity: number;
}

export interface VasBillingInput {
  processType: 'RELABEL' | 'KITTING' | 'DEKITTING' | 'QUALITY_CHECK';
  orderCount: number;
  unitCount: number;
  hours: number;
}

export interface BillingResult {
  storage: number;
  labor: number;
  consumable: number;
  vas: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  breakdown: BillingBreakdownItem[];
}

export interface BillingBreakdownItem {
  category: 'STORAGE' | 'LABOR' | 'CONSUMABLE' | 'VAS';
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  discountApplied: number;
  netAmount: number;
}

export class BillingEngine {
  private strategyCache = new Map<string, { strategy: BillingStrategy; cachedAt: number }>();
  private cacheTtl = 10 * 60 * 1000; // 10分钟

  constructor(private supabase: SupabaseClient) {}

  /**
   * 获取租户计费策略（带缓存）
   */
  async getStrategy(tenantId: string): Promise<BillingStrategy | null> {
    const now = Date.now();
    const cached = this.strategyCache.get(tenantId);
    if (cached && now - cached.cachedAt < this.cacheTtl) {
      return cached.strategy;
    }

    const { data, error } = await this.supabase
      .from('tenants')
      .select('billing_strategy')
      .eq('id', tenantId)
      .single();

    if (error || !data?.billing_strategy) {
      return null;
    }

    const strategy = data.billing_strategy as BillingStrategy;
    this.strategyCache.set(tenantId, { strategy, cachedAt: now });
    return strategy;
  }

  /**
   * 清除缓存
   */
  invalidateCache(tenantId?: string): void {
    if (tenantId) {
      this.strategyCache.delete(tenantId);
    } else {
      this.strategyCache.clear();
    }
  }

  /**
   * 计算存储费
   */
  async calculateStorage(input: StorageBillingInput[], context: BillingContext): Promise<{
    total: number;
    breakdown: BillingBreakdownItem[];
  }> {
    const strategy = await this.getStrategy(context.tenantId);
    if (!strategy) {
      return { total: 0, breakdown: [] };
    }

    const breakdown: BillingBreakdownItem[] = [];
    let total = 0;

    for (const item of input) {
      // 匹配阶梯费率
      const step = this.matchStorageStep(strategy.storage_stepped, item.daysInStorage);
      if (!step) continue;

      // 计算计费体积
      const billableVolume = item.volumeM3 * item.qty;
      const days = step.prorated ? item.daysInStorage : this.getBillingDays(step.billing_cycle, item.daysInStorage);

      let amount = billableVolume * step.rate * days;

      // 应用最低/最高收费
      amount = Math.max(amount, step.min_charge);
      if (step.max_charge !== null) {
        amount = Math.min(amount, step.max_charge);
      }

      // 应用体量折扣
      const discount = this.calculateVolumeDiscount(strategy.storage_stepped, billableVolume * item.qty);
      const discountAmount = amount * discount;
      const netAmount = amount - discountAmount;

      breakdown.push({
        category: 'STORAGE',
        description: `${step.description} - ${item.skuId} (${billableVolume.toFixed(4)} m³ × ${days} 天)`,
        quantity: billableVolume * days,
        unit: 'm³·day',
        unitPrice: step.rate,
        amount,
        discountApplied: discountAmount,
        netAmount,
      });

      total += netAmount;
    }

    return { total, breakdown };
  }

  /**
   * 计算人工费
   */
  async calculateLabor(input: LaborBillingInput, context: BillingContext): Promise<{
    total: number;
    breakdown: BillingBreakdownItem[];
  }> {
    const strategy = await this.getStrategy(context.tenantId);
    if (!strategy?.labor_rates) {
      return { total: 0, breakdown: [] };
    }

    const rate = strategy.labor_rates.find(r => r.task_type === input.taskType);
    if (!rate) {
      return { total: 0, breakdown: [] };
    }

    let billableQty = 0;
    let unit = '';

    switch (rate.unit) {
      case 'PER_ORDER':
        billableQty = input.orderCount;
        unit = 'order';
        break;
      case 'PER_LINE':
        billableQty = input.lineCount;
        unit = 'line';
        break;
      case 'PER_UNIT':
        billableQty = input.unitCount;
        unit = 'unit';
        break;
      case 'PER_HOUR':
        billableQty = input.hours;
        unit = 'hour';
        break;
    }

    const amount = billableQty * rate.rate;
    const breakdown: BillingBreakdownItem[] = [{
      category: 'LABOR',
      description: `${input.taskType} - ${rate.unit}`,
      quantity: billableQty,
      unit,
      unitPrice: rate.rate,
      amount,
      discountApplied: 0,
      netAmount: amount,
    }];

    return { total: amount, breakdown };
  }

  /**
   * 计算耗材费
   */
  async calculateConsumable(input: ConsumableBillingInput, context: BillingContext): Promise<{
    total: number;
    breakdown: BillingBreakdownItem[];
  }> {
    const strategy = await this.getStrategy(context.tenantId);
    if (!strategy?.consumable_rates) {
      return { total: 0, breakdown: [] };
    }

    const rate = strategy.consumable_rates.find(r => r.item_type === input.itemType);
    if (!rate) {
      return { total: 0, breakdown: [] };
    }

    const amount = input.quantity * rate.rate;
    const breakdown: BillingBreakdownItem[] = [{
      category: 'CONSUMABLE',
      description: `${input.itemType}`,
      quantity: input.quantity,
      unit: rate.unit,
      unitPrice: rate.rate,
      amount,
      discountApplied: 0,
      netAmount: amount,
    }];

    return { total: amount, breakdown };
  }

  /**
   * 计算增值服务费
   */
  async calculateVas(input: VasBillingInput, context: BillingContext): Promise<{
    total: number;
    breakdown: BillingBreakdownItem[];
  }> {
    const strategy = await this.getStrategy(context.tenantId);
    if (!strategy?.vas_rates) {
      return { total: 0, breakdown: [] };
    }

    const rate = strategy.vas_rates.find(r => r.process_type === input.processType);
    if (!rate) {
      return { total: 0, breakdown: [] };
    }

    let billableQty = 0;
    let unit = '';

    switch (rate.unit) {
      case 'PER_ORDER':
        billableQty = input.orderCount;
        unit = 'order';
        break;
      case 'PER_UNIT':
        billableQty = input.unitCount;
        unit = 'unit';
        break;
      case 'PER_HOUR':
        billableQty = input.hours;
        unit = 'hour';
        break;
    }

    const amount = billableQty * rate.rate;
    const breakdown: BillingBreakdownItem[] = [{
      category: 'VAS',
      description: `${input.processType} - ${rate.unit}`,
      quantity: billableQty,
      unit,
      unitPrice: rate.rate,
      amount,
      discountApplied: 0,
      netAmount: amount,
    }];

    return { total: amount, breakdown };
  }

  /**
   * 完整计费（生成账单记录）
   */
  async generateBill(
    storageInputs: StorageBillingInput[],
    laborInputs: LaborBillingInput[],
    consumableInputs: ConsumableBillingInput[],
    vasInputs: VasBillingInput[],
    context: BillingContext
  ): Promise<BillingResult> {
    const [storage, labor, consumable, vas] = await Promise.all([
      this.calculateStorage(storageInputs, context),
      Promise.all(laborInputs.map(i => this.calculateLabor(i, context))),
      Promise.all(consumableInputs.map(i => this.calculateConsumable(i, context))),
      Promise.all(vasInputs.map(i => this.calculateVas(i, context))),
    ]);

    const laborTotal = labor.reduce((sum, r) => sum + r.total, 0);
    const laborBreakdown = labor.flatMap(r => r.breakdown);
    const consumableTotal = consumable.reduce((sum, r) => sum + r.total, 0);
    const consumableBreakdown = consumable.flatMap(r => r.breakdown);
    const vasTotal = vas.reduce((sum, r) => sum + r.total, 0);
    const vasBreakdown = vas.flatMap(r => r.breakdown);

    const subtotal = storage.total + laborTotal + consumableTotal + vasTotal;
    const allBreakdown = [...storage.breakdown, ...laborBreakdown, ...consumableBreakdown, ...vasBreakdown];

    // 计算总体折扣（基于总量/营收/订单数）
    const strategy = await this.getStrategy(context.tenantId);
    const discountRate = this.calculateOverallDiscount(strategy, subtotal, context);
    const discount = subtotal * discountRate;
    const total = subtotal - discount;

    // 将折扣按比例分配到各明细
    for (const item of allBreakdown) {
      const proportion = subtotal > 0 ? item.netAmount / subtotal : 0;
      item.discountApplied += discount * proportion;
      item.netAmount -= discount * proportion;
    }

    const result: BillingResult = {
      storage: storage.total,
      labor: laborTotal,
      consumable: consumableTotal,
      vas: vasTotal,
      subtotal,
      discount,
      total,
      currency: strategy?.currency || context.currency || 'USD',
      breakdown: allBreakdown,
    };

    // 记录计费交易
    await this.recordBillingTransaction(result, context);

    return result;
  }

  /**
   * 记录计费交易到 billing_transactions
   */
  private async recordBillingTransaction(result: BillingResult, context: BillingContext): Promise<void> {
    const breakdown = result.breakdown.map(item => ({
      category: item.category,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unitPrice,
      amount: item.amount,
      discount: item.discountApplied,
      net_amount: item.netAmount,
    }));

    await this.supabase.from('billing_transactions').insert({
      tenant_id: context.tenantId,
      fee_type: 'COMPOSITE',
      amount: result.total,
      currency: result.currency,
      calculation_basis: JSON.stringify({
        period_start: context.periodStart.toISOString(),
        period_end: context.periodEnd.toISOString(),
        breakdown,
      }),
      status: 'pending',
    });
  }

  // ========== 私有辅助方法 ==========

  private matchStorageStep(steps: StorageStep[], daysInStorage: number): StorageStep | null {
    // 先按生效日期过滤
    const today = new Date().toISOString().split('T')[0];
    const validSteps = steps.filter(s => {
      const effective = s.effective_date <= today;
      const notExpired = !s.expiry_date || s.expiry_date >= today;
      return effective && notExpired && daysInStorage >= s.min_days && (s.max_days === null || daysInStorage <= s.max_days);
    });

    if (validSteps.length === 0) return null;

    // 优先匹配最精确的阶梯（max_days 最小的）
    return validSteps.sort((a, b) => (a.max_days || 99999) - (b.max_days || 99999))[0];
  }

  private getBillingDays(cycle: 'DAILY' | 'MONTHLY', actualDays: number): number {
    if (cycle === 'DAILY') return actualDays;
    // 月度计费：按自然月向上取整
    return Math.ceil(actualDays / 30) * 30;
  }

  private calculateVolumeDiscount(steps: StorageStep[], totalVolume: number): number {
    let maxDiscount = 0;
    for (const step of steps) {
      for (const disc of step.discounts || []) {
        if (disc.type === 'VOLUME' && totalVolume >= disc.threshold) {
          maxDiscount = Math.max(maxDiscount, disc.discount_rate);
        }
      }
    }
    return maxDiscount;
  }

  private calculateOverallDiscount(
    strategy: BillingStrategy | null,
    subtotal: number,
    context: BillingContext
  ): number {
    if (!strategy) return 0;

    let maxDiscount = 0;

    // 检查存储阶梯中的折扣
    for (const step of strategy.storage_stepped) {
      for (const disc of step.discounts || []) {
        if (disc.type === 'REVENUE' && subtotal >= disc.threshold) {
          maxDiscount = Math.max(maxDiscount, disc.discount_rate);
        }
      }
    }

    // TODO: 检查订单量折扣（需要查询期间订单数）

    return Math.min(maxDiscount, 0.5); // 最高 50% 折扣
  }
}

export default BillingEngine;