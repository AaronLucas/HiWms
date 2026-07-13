/**
 * Supabase 计费交易仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IBillingTransactionRepository } from '@core/ports/db/IBillingTransactionRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type BillingTransactionRow = Tables<'billing_transactions'>;
type BillingTransactionInsert = TablesInsert<'billing_transactions'>;
type BillingTransactionUpdate = TablesUpdate<'billing_transactions'>;

export class SupabaseBillingTransactionRepository extends SupabaseBaseRepository<
  BillingTransactionRow,
  BillingTransactionInsert,
  BillingTransactionUpdate,
  string
> implements IBillingTransactionRepository {
  protected tableName = 'billing_transactions';
  protected idColumn = 'trans_id';

  async findByOrder(orderId: string): Promise<BillingTransactionRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as BillingTransactionRow[]) || [];
  }

  async findByInventory(invId: string): Promise<BillingTransactionRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('inv_id', invId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as BillingTransactionRow[]) || [];
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; feeType?: string; status?: string; startDate?: string; endDate?: string }
  ): Promise<BillingTransactionRow[]> {
    const { limit = 100, offset = 0, feeType, status, startDate, endDate } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (feeType) query = query.eq('fee_type', feeType);
    if (status) query = query.eq('status', status);
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return (data as BillingTransactionRow[]) || [];
  }

  async createTransaction(data: BillingTransactionInsert): Promise<BillingTransactionRow> {
    return this.create(data);
  }

  async updateStatus(transId: string, status: string): Promise<BillingTransactionRow> {
    return this.update(transId, { status } as BillingTransactionUpdate);
  }

  async getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalAmount: number;
    totalCount: number;
    byFeeType: Record<string, { count: number; amount: number }>;
    byStatus: Record<string, number>;
    byCurrency: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('fee_type, status, amount, currency')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const transactions = data as { fee_type: string; status: string; amount: number | null; currency: string | null }[];

    const byFeeType: Record<string, { count: number; amount: number }> = {};
    const byStatus: Record<string, number> = {};
    const byCurrency: Record<string, number> = {};
    let totalAmount = 0, totalCount = 0;

    for (const t of transactions) {
      totalCount++;
      totalAmount += t.amount || 0;

      if (!byFeeType[t.fee_type]) byFeeType[t.fee_type] = { count: 0, amount: 0 };
      byFeeType[t.fee_type].count++;
      byFeeType[t.fee_type].amount += t.amount || 0;

      byStatus[t.status] = (byStatus[t.status] || 0) + 1;

      const currency = t.currency || 'UNKNOWN';
      byCurrency[currency] = (byCurrency[currency] || 0) + (t.amount || 0);
    }

    return { totalAmount, totalCount, byFeeType, byStatus, byCurrency };
  }
}