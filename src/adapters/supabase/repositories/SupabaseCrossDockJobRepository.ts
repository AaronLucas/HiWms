/**
 * Supabase 交叉转运作业仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ICrossDockJobRepository } from '@core/ports/db/ICrossDockJobRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type CrossDockJobRow = Tables<'cross_dock_jobs'>;
type CrossDockJobInsert = TablesInsert<'cross_dock_jobs'>;
type CrossDockJobUpdate = TablesUpdate<'cross_dock_jobs'>;

export class SupabaseCrossDockJobRepository extends SupabaseBaseRepository<
  CrossDockJobRow,
  CrossDockJobInsert,
  CrossDockJobUpdate,
  string
> implements ICrossDockJobRepository {
  protected tableName = 'cross_dock_jobs';
  protected idColumn = 'id';

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string }
  ): Promise<CrossDockJobRow[]> {
    const { limit = 100, offset = 0, status } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return (data as CrossDockJobRow[]) || [];
  }

  async findPendingMatch(tenantId: string): Promise<CrossDockJobRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_match')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as CrossDockJobRow[]) || [];
  }

  async findPendingStaging(tenantId: string): Promise<CrossDockJobRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'matched')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as CrossDockJobRow[]) || [];
  }

  async findTimeoutJobs(tenantId: string, before: string): Promise<CrossDockJobRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .in('status', ['pending_match', 'matched'])
      .lt('created_at', before);

    if (error) throw error;
    return (data as CrossDockJobRow[]) || [];
  }

  async findByInboundReceipt(inboundReceiptId: string): Promise<CrossDockJobRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('inbound_receipt_id', inboundReceiptId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as CrossDockJobRow[]) || [];
  }

  async findByOutboundOrder(outboundOrderId: string): Promise<CrossDockJobRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('outbound_order_id', outboundOrderId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as CrossDockJobRow[]) || [];
  }

  async findBySku(skuId: string, tenantId: string): Promise<CrossDockJobRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('sku_id', skuId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as CrossDockJobRow[]) || [];
  }

  async updateStatus(
    jobId: string,
    status: string,
    extra?: { matchedAt?: string; shippedAt?: string; fallbackReason?: string }
  ): Promise<CrossDockJobRow> {
    const updateData: Partial<CrossDockJobUpdate> = { status };
    if (extra?.matchedAt) updateData.matched_at = extra.matchedAt;
    if (extra?.shippedAt) updateData.shipped_at = extra.shippedAt;
    if (extra?.fallbackReason) updateData.fallback_reason = extra.fallbackReason;
    return this.update(jobId, updateData as CrossDockJobUpdate);
  }

  async matchReceiptToOrder(
    jobId: string,
    inboundReceiptId: string,
    outboundOrderId: string,
    matchedQty: number
  ): Promise<CrossDockJobRow> {
    return this.update(jobId, {
      inbound_receipt_id: inboundReceiptId,
      outbound_order_id: outboundOrderId,
      matched_qty: matchedQty,
      status: 'matched',
      matched_at: new Date().toISOString(),
    } as CrossDockJobUpdate);
  }

  async assignStagingLocation(jobId: string, stagingLocId: string): Promise<CrossDockJobRow> {
    return this.update(jobId, { staging_location_id: stagingLocId } as CrossDockJobUpdate);
  }

  async getEfficiencyStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalJobs: number;
    shippedJobs: number;
    fallbackJobs: number;
    timeoutJobs: number;
    avgLeadTimeMinutes: number;
    shipRatePct: number;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('status, created_at, matched_at, shipped_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const jobs = data as { status: string; created_at: string; matched_at: string | null; shipped_at: string | null }[];

    const totalJobs = jobs.length;
    const shippedJobs = jobs.filter(j => j.status === 'shipped').length;
    const fallbackJobs = jobs.filter(j => j.status === 'fallback').length;
    const timeoutJobs = jobs.filter(j => j.status === 'timeout').length;

    const shippedWithTimes = jobs.filter(j => j.shipped_at && j.created_at);
    const avgLeadTimeMinutes = shippedWithTimes.length > 0
      ? Math.round(
          shippedWithTimes.reduce((sum, j) =>
            sum + (new Date(j.shipped_at!).getTime() - new Date(j.created_at).getTime()) / 60000, 0
          ) / shippedWithTimes.length
        )
      : 0;

    return {
      totalJobs,
      shippedJobs,
      fallbackJobs,
      timeoutJobs,
      avgLeadTimeMinutes,
      shipRatePct: totalJobs > 0 ? Math.round((shippedJobs / totalJobs) * 100) : 0,
    };
  }
}