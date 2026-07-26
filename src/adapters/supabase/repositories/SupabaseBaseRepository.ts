/**
 * Supabase 基础仓储实现
 * 封装通用的 PostgREST 查询逻辑
 * ADR-015: 支持 per-request authenticated client 用于 RLS 租户隔离
 */
import { WmsSupabaseClient, type TypedSupabaseClient } from '../SupabaseClient';
import { IRepository } from '../../../core/ports/db/IRepository';
import type { Database } from '../../../types/database';
import type { PostgrestError } from '@supabase/supabase-js';

export abstract class SupabaseBaseRepository<T, TInsert, TUpdate, TId extends string = string> implements IRepository<T, TInsert, TUpdate, TId> {
  protected abstract tableName: string;
  protected abstract idColumn: string;

  constructor(protected supabase: WmsSupabaseClient) {}

  /**
   * 获取客户端
   * @param useAdmin 是否使用管理员 client（绕过 RLS）
   * @param authToken 可选的用户 access_token，用于创建 per-request authenticated client（RLS 生效）
   */
  protected getClient(useAdmin = false, authToken?: string): TypedSupabaseClient {
    if (authToken) {
      // Per-request authenticated client：带用户 JWT，RLS 会生效
      return this.supabase.getAuthenticatedClient(authToken);
    }
    return useAdmin ? this.supabase.getAdminClient() : this.supabase.getClient();
  }

  async findById(id: TId, authToken?: string): Promise<T | null> {
    const client = this.getClient(false, authToken);
    const { data, error } = await client
      .from(this.tableName)
      .select('*')
      .eq(this.idColumn, id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // 未找到
      throw error;
    }
    return data as T;
  }

  async findAll(options: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    ascending?: boolean;
    filters?: Record<string, unknown>;
    authToken?: string;
  } = {}): Promise<T[]> {
    const { limit = 100, offset = 0, orderBy = this.idColumn, ascending = true, filters = {}, authToken } = options;

    const client = this.getClient(false, authToken);
    let query = client
      .from(this.tableName)
      .select('*')
      .order(orderBy, { ascending })
      .range(offset, offset + limit - 1);

    // 应用过滤器
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as T[]) || [];
  }

  async count(filters: Record<string, unknown> = {}, authToken?: string): Promise<number> {
    const client = this.getClient(false, authToken);
    let query = client
      .from(this.tableName)
      .select('*', { count: 'exact', head: true });

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    }

    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }

  async create(data: TInsert, authToken?: string): Promise<T> {
    const client = this.getClient(false, authToken);
    const { data: result, error } = await client
      .from(this.tableName)
      .insert(data as any)
      .select()
      .single();

    if (error) throw error;
    return result as T;
  }

  async createMany(data: TInsert[], authToken?: string): Promise<T[]> {
    const client = this.getClient(false, authToken);
    const { data: result, error } = await client
      .from(this.tableName)
      .insert(data as any)
      .select();

    if (error) throw error;
    return (result as T[]) || [];
  }

  async update(id: TId, data: TUpdate, authToken?: string): Promise<T> {
    const client = this.getClient(false, authToken);
    const { data: result, error } = await client
      .from(this.tableName)
      .update(data as any)
      .eq(this.idColumn, id)
      .select()
      .single();

    if (error) throw error;
    return result as T;
  }

  async delete(id: TId, authToken?: string): Promise<void> {
    const client = this.getClient(false, authToken);
    const { error } = await client
      .from(this.tableName)
      .delete()
      .eq(this.idColumn, id);

    if (error) throw error;
  }

  async exists(id: TId, authToken?: string): Promise<boolean> {
    const client = this.getClient(false, authToken);
    const { data, error } = await client
      .from(this.tableName)
      .select(this.idColumn)
      .eq(this.idColumn, id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false;
      throw error;
    }
    return !!data;
  }
}