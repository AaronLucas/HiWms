/**
 * Supabase 基础仓储实现
 * 封装通用的 PostgREST 查询逻辑
 */
import { WmsSupabaseClient, type TypedSupabaseClient } from '../SupabaseClient';
import { IRepository } from '../../../core/ports/db/IRepository';
import type { Database } from '../../../types/database';
import type { PostgrestError } from '@supabase/supabase-js';

export abstract class SupabaseBaseRepository<T, TInsert, TUpdate, TId extends string = string> implements IRepository<T, TInsert, TUpdate, TId> {
  protected abstract tableName: string;
  protected abstract idColumn: string;

  constructor(protected supabase: WmsSupabaseClient) {}

  protected getClient(useAdmin = false): any {
    return useAdmin ? this.supabase.getAdminClient() : this.supabase.getClient();
  }

  async findById(id: TId): Promise<T | null> {
    const client = this.getClient();
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
  } = {}): Promise<T[]> {
    const { limit = 100, offset = 0, orderBy = this.idColumn, ascending = true, filters = {} } = options;

    const client = this.getClient();
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

  async count(filters: Record<string, unknown> = {}): Promise<number> {
    const client = this.getClient();
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

  async create(data: TInsert): Promise<T> {
    const client = this.getClient();
    const { data: result, error } = await client
      .from(this.tableName)
      .insert(data as any)
      .select()
      .single();

    if (error) throw error;
    return result as T;
  }

  async createMany(data: TInsert[]): Promise<T[]> {
    const client = this.getClient();
    const { data: result, error } = await client
      .from(this.tableName)
      .insert(data as any)
      .select();

    if (error) throw error;
    return (result as T[]) || [];
  }

  async update(id: TId, data: TUpdate): Promise<T> {
    const client = this.getClient();
    const { data: result, error } = await client
      .from(this.tableName)
      .update(data as any)
      .eq(this.idColumn, id)
      .select()
      .single();

    if (error) throw error;
    return result as T;
  }

  async delete(id: TId): Promise<void> {
    const client = this.getClient();
    const { error } = await client
      .from(this.tableName)
      .delete()
      .eq(this.idColumn, id);

    if (error) throw error;
  }

  async exists(id: TId): Promise<boolean> {
    const client = this.getClient();
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