/**
 * 通知发送端口接口
 * 多渠道通知抽象（短信、邮件、推送、Webhook 等）
 */
export interface INotificationSender {
  /**
   * 发送通知
   */
  send(params: {
    /** 接收者标识 */
    to: string | string[];
    /** 通知类型 */
    type: 'sms' | 'email' | 'push' | 'webhook' | 'in_app';
    /** 标题 */
    title: string;
    /** 内容 */
    body: string;
    /** 附加数据 */
    data?: Record<string, unknown>;
    /** 优先级 */
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    /** 模板 ID（可选） */
    templateId?: string;
    /** 模板变量（可选） */
    templateVars?: Record<string, unknown>;
  }): Promise<{
    /** 消息 ID */
    messageId: string;
    /** 发送状态 */
    status: 'sent' | 'queued' | 'failed';
    /** 错误信息（如有） */
    error?: string;
  }>;

  /**
   * 批量发送
   */
  sendBatch(params: Array<{
    to: string;
    type: 'sms' | 'email' | 'push' | 'webhook' | 'in_app';
    title: string;
    body: string;
    data?: Record<string, unknown>;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    templateId?: string;
    templateVars?: Record<string, unknown>;
  }>): Promise<Array<{
    messageId: string;
    status: 'sent' | 'queued' | 'failed';
    error?: string;
  }>>;

  /**
   * 获取发送状态
   */
  getStatus(messageId: string): Promise<{
    status: 'sent' | 'delivered' | 'failed' | 'pending';
    deliveredAt?: Date;
    error?: string;
  }>;
}