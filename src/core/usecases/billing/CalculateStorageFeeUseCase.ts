/**
 * 计算存储费用用例
 * 封装 fn_get_active_billing_rule RPC
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';

export interface CalculateStorageFeeInput {
  tenantId: string;
  productId: string;
  quantity: number;
  days: number;
  locationType?: string;
}

export class CalculateStorageFeeUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: CalculateStorageFeeInput): Promise<{
    ruleId: string;
    ruleName: string;
    currency: string;
    totalAmount: number;
    breakdown: Array<{ tier: number; days: number; rate: number; amount: number }>;
  }> {
    // 调用 fn_get_active_billing_rule RPC
    const rules = await this.supabase.rpc('fn_get_active_billing_rule', {
      p_tenant_id: input.tenantId,
    });

    if (!rules.length) {
      throw new Error('No active billing rule found for tenant');
    }

    const rule = rules[0];
    // 实际实现需要解析 rule.tiers 计算阶梯费用
    // 这里简化返回

    return {
      ruleId: rule.rule_id,
      ruleName: rule.rule_name,
      currency: rule.currency,
      totalAmount: 0,
      breakdown: [],
    };
  }
}

/**
 * 生成计费交易用例
 * 创建 billing_transactions 记录
 */
export interface GenerateBillingTransactionInput {
  tenantId: string;
  orderId?: string;
  invId?: string;
  feeType: 'STORAGE' | 'LABOR' | 'CONSUMABLE' | 'VAS';
  amount: number;
  currency: string;
  calculationBasis: Record<string, unknown>;
}

export class GenerateBillingTransactionUseCase {
  constructor(private supabase: WmsSupabaseClient) {}

  async execute(input: GenerateBillingTransactionInput): Promise<{ transactionId: string }> {
    // 创建计费交易记录
    const { data, error } = await this.supabase
      .from('billing_transactions')
      .insert({
        tenant_id: input.tenantId,
        order_id: input.orderId,
        inv_id: input.invId,
        fee_type: input.feeType,
        amount: input.amount,
        currency: input.currency,
        calculation_basis: JSON.stringify(input.calculationBasis),
        status: 'PENDING',
      })
      .select('trans_id')
      .single();

    if (error) throw new Error(`创建计费交易失败: ${error.message}`);
    return { transactionId: data.trans_id };
  }
}