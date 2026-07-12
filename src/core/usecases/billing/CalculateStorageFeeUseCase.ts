/**
 * 计算存储费用用例
 * 封装 fn_get_active_billing_rule RPC
 */
import { IBillingRuleRpc } from '../../core/ports/rpc/IBillingRuleRpc';

export interface CalculateStorageFeeInput {
  tenantId: string;
  productId: string;
  quantity: number;
  days: number;
  locationType?: string;
}

export class CalculateStorageFeeUseCase {
  constructor(private billingRuleRpc: IBillingRuleRpc) {}

  async execute(input: CalculateStorageFeeInput): Promise<{
    ruleId: string;
    ruleName: string;
    currency: string;
    totalAmount: number;
    breakdown: Array<{ tier: number; days: number; rate: number; amount: number }>;
  }> {
    // 获取生效计费规则
    const rules = await this.billingRuleRpc.getActive({ p_tenant_id: input.tenantId });
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
  feeType: 'storage' | 'handling' | 'value_added' | 'shipping';
  amount: number;
  currency: string;
  calculationBasis: Record<string, unknown>;
}

export class GenerateBillingTransactionUseCase {
  // 需要 BillingTransactionRepository
  async execute(input: GenerateBillingTransactionInput): Promise<{ transactionId: string }> {
    // 创建计费交易记录
    return { transactionId: `txn-${Date.now()}` };
  }
}