/**
 * 命令总线端口接口
 * 用于发送命令（同步/异步执行）
 */
export interface ICommandBus {
  /**
   * 发送命令
   */
  send<T extends { type: string }>(command: T): Promise<void>;

  /**
   * 发送命令并等待结果
   */
  sendAndWait<T extends { type: string }, R>(command: T): Promise<R>;
}

/**
 * 事件总线端口接口
 * 用于发布领域事件
 */
export interface IEventBus {
  /**
   * 发布事件
   */
  publish<T extends { type: string }>(event: T): Promise<void>;

  /**
   * 批量发布事件
   */
  publishAll<T extends { type: string }>(events: T[]): Promise<void>;

  /**
   * 订阅事件
   */
  subscribe<T extends { type: string }>(
    eventType: string,
    handler: (event: T) => Promise<void>
  ): () => void;
}

/**
 * 队列端口聚合接口
 * 组合命令总线和事件总线
 */
export interface IQueuePorts {
  commandBus: ICommandBus;
  eventBus: IEventBus;
}