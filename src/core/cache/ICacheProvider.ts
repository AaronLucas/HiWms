/**
 * 缓存提供者端口接口
 * 基础的 get/set/del/invalidate 操作
 */
export interface ICacheProvider {
  /**
   * 获取缓存值
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * 设置缓存值
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * 删除缓存
   */
  delete(key: string): Promise<void>;

  /**
   * 批量删除（按前缀）
   */
  deleteByPrefix(prefix: string): Promise<void>;

  /**
   * 检查键是否存在
   */
  has(key: string): Promise<boolean>;

  /**
   * 获取并设置（原子操作）
   */
  getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T>;

  /**
   * 递增计数器
   */
  increment(key: string, delta?: number): Promise<number>;

  /**
   * 设置过期时间
   */
  expire(key: string, ttlSeconds: number): Promise<void>;
}