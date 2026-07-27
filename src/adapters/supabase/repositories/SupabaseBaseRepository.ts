/**
 * Supabase 基础仓储实现
 * 封装通用的 PostgREST 查询逻辑
 * ADR-015: 支持 per-request authenticated client 用于 RLS 租户隔离
 */
import { WmsSupabaseClient, type TypedSupabaseClient } from '../SupabaseClient';
import { IRepository } from '../../../core/ports/db/IRepository';
import type { Database } from '../../../types/database';
import type { PostgrestError } from '@supabase/supabase-js';

export type TableNameLiteral = keyof Database['public']['Tables'];

export abstract class SupabaseBaseRepository<
  T,
  TInsert,
  TUpdate,
  TId extends string = string,
  TTableName extends TableNameLiteral = TableNameLiteral
> implements IRepository<T, TInsert, TUpdate, TId> {
  protected abstract tableName: TTableName;
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

  /**
   * 从表创建查询构建器（内部使用，支持 authToken）
   * 使用类型参数确保表名类型安全
   */
  protected from(authToken?: string) {
    return this.getClient(false, authToken).from(this.tableName);
  }

  /**
   * 从表创建查询构建器（管理员权限）
   */
  protected fromAdmin() {
    return this.getClient(true).from(this.tableName);
  }

  async findById(id: TId, authToken?: string): Promise<T | null> {
    const { data, error } = await this.from(authToken)
      .select('*')
      .eq(this.idColumn as any, id)
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

    let query = this.from(authToken)
      .select('*')
      .order(orderBy as any, { ascending })
      .range(offset, offset + limit - 1);

    // 应用过滤器
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key as any, value);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as T[]) || [];
  }

  async count(filters: Record<string, unknown> = {}, authToken?: string): Promise<number> {
    let query = this.from(authToken)
      .select('*', { count: 'exact', head: true });

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key as any, value);
      }
    }

    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }

  async create(data: TInsert, authToken?: string): Promise<T> {
    const { data: result, error } = await this.from(authToken)
      .insert(data as any)
      .select()
      .single();

    if (error) throw error;
    return result as T;
  }

  async createMany(data: TInsert[], authToken?: string): Promise<T[]> {
    const { data: result, error } = await this.from(authToken)
      .insert(data as any)
      .select();

    if (error) throw error;
    return (result as T[]) || [];
  }

  async update(id: TId, data: TUpdate, authToken?: string): Promise<T> {
    const { data: result, error } = await this.from(authToken)
      .update(data as any)
      .eq(this.idColumn as any, id)
      .select()
      .single();

    if (error) throw error;
    return result as T;
  }

  async delete(id: TId, authToken?: string): Promise<void> {
    const { error } = await this.from(authToken)
      .delete()
      .eq(this.idColumn as any, id);

    if (error) throw error;
  }

  async exists(id: TId, authToken?: string): Promise<boolean> {
    const { data, error } = await this.from(authToken)
      .select(this.idColumn)
      .eq(this.idColumn as any, id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false;
      throw error;
    }
    return !!data;
  }
}