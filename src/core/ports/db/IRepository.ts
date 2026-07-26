/**
 * 通用仓储接口
 * 定义基础 CRUD 操作
 * ADR-015: 所有查询方法支持可选的 authToken 参数，用于 per-request RLS 租户隔离
 */
export interface IRepository<T, TInsert, TUpdate, TId = string> {
  /** 根据 ID 查找 */
  findById(id: TId, authToken?: string): Promise<T | null>;

  /** 查找所有（支持分页、排序、过滤） */
  findAll(options?: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    ascending?: boolean;
    filters?: Record<string, unknown>;
    authToken?: string;
  }): Promise<T[]>;

  /** 计数 */
  count(filters?: Record<string, unknown>, authToken?: string): Promise<number>;

  /** 创建 */
  create(data: TInsert, authToken?: string): Promise<T>;

  /** 批量创建 */
  createMany(data: TInsert[], authToken?: string): Promise<T[]>;

  /** 更新 */
  update(id: TId, data: TUpdate, authToken?: string): Promise<T>;

  /** 删除 */
  delete(id: TId, authToken?: string): Promise<void>;

  /** 软删除（如适用） */
  softDelete?(id: TId, authToken?: string): Promise<void>;

  /** 检查是否存在 */
  exists(id: TId, authToken?: string): Promise<boolean>;
}