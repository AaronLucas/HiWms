/**
 * 通用仓储接口
 * 定义基础 CRUD 操作
 */
export interface IRepository<T, TInsert, TUpdate, TId = string> {
  /** 根据 ID 查找 */
  findById(id: TId): Promise<T | null>;

  /** 查找所有（支持分页、排序、过滤） */
  findAll(options?: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    ascending?: boolean;
    filters?: Record<string, unknown>;
  }): Promise<T[]>;

  /** 计数 */
  count(filters?: Record<string, unknown>): Promise<number>;

  /** 创建 */
  create(data: TInsert): Promise<T>;

  /** 批量创建 */
  createMany(data: TInsert[]): Promise<T[]>;

  /** 更新 */
  update(id: TId, data: TUpdate): Promise<T>;

  /** 删除 */
  delete(id: TId): Promise<void>;

  /** 软删除（如适用） */
  softDelete?(id: TId): Promise<void>;

  /** 检查是否存在 */
  exists(id: TId): Promise<boolean>;
}