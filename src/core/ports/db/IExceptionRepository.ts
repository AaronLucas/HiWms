/**
 * 统一异常领域仓储端口接口
 * 涵盖：exception_type_catalog / exceptions / exception_events
 * 封装：fn_raise_exception / fn_resolve_exception / fn_confirm_inventory_recount
 * 对应表：exceptions, exception_type_catalog, exception_events
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type ExceptionRow = Tables<'exceptions'>;
export type ExceptionInsert = TablesInsert<'exceptions'>;
export type ExceptionUpdate = TablesUpdate<'exceptions'>;

export type ExceptionEventRow = Tables<'exception_events'>;
export type ExceptionEventInsert = TablesInsert<'exception_events'>;

export type ExceptionTypeCatalogRow = Tables<'exception_type_catalog'>;

// 与 exceptions.status 的 chk_exceptions_status CHECK 约束保持一致（已用 psql \d /
// pg_constraint 核实）。生命周期见 unWMS_Offline_Sync_Exception_Domain_V1.md §4.2：
// PENDING_REVIEW（默认起点）-> CONFLICT（处理中发现情况复杂，即"升级"）/ RESOLVED（已处理）/
// DISMISSED（已知悉但判定不需要处理，误报）。
export type ExceptionStatus = 'PENDING_REVIEW' | 'CONFLICT' | 'RESOLVED' | 'DISMISSED';
export type ExceptionDomain =
  | 'inventory_exception'
  | 'compliance_exception'
  | 'sync_exception'
  | 'task_exception'
  | 'fulfillment_exception'
  | 'billing_exception'
  | 'manual_exception';
export type ExceptionSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface IExceptionRepository {
  // ========== 异常类型目录 ==========

  /**
   * 获取所有异常类型（用于前端下拉/分类）
   */
  getExceptionTypes(): Promise<ExceptionTypeCatalogRow[]>;

  /**
   * 按域获取异常类型
   */
  getExceptionTypesByDomain(domain: ExceptionDomain): Promise<ExceptionTypeCatalogRow[]>;

  /**
   * 根据 code 获取异常类型
   */
  getExceptionTypeByCode(code: string): Promise<ExceptionTypeCatalogRow | null>;

  // ========== 异常主表 ==========

  /**
   * 创建异常（调用 RPC fn_raise_exception）
   */
  raiseException(params: {
    tenantId: string;
    typeCode: string;
    severity: ExceptionSeverity;
    title: string;
    description?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    raisedBy?: string;
    assignedTo?: string;
    context?: Record<string, unknown>;
  }): Promise<ExceptionRow>;

  /**
   * 查找异常详情（含关联审计事件）
   */
  findById(id: string, tenantId: string): Promise<(ExceptionRow & { events: ExceptionEventRow[] }) | null>;

  /**
   * 分页查询异常列表
   */
  findByTenant(params: {
    tenantId: string;
    status?: ExceptionStatus;
    domain?: ExceptionDomain;
    severity?: ExceptionSeverity;
    limit?: number;
    offset?: number;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: ExceptionRow[]; total: number }>;

  /**
   * 统计异常数量（按状态/域/严重度聚合）
   */
  countByStatus(tenantId: string): Promise<Record<ExceptionStatus, number>>;

  /**
   * 更新异常状态/指派
   */
  updateException(id: string, tenantId: string, updates: {
    status?: ExceptionStatus;
    assignedTo?: string;
    resolvedAt?: string;
    resolution?: string;
  }): Promise<ExceptionRow | null>;

  /**
   * 解决异常（调用 RPC fn_resolve_exception）
   * 自动记录 exception_events 审计轨迹
   */
  resolveException(params: {
    exceptionId: string;
    tenantId: string;
    resolvedBy: string;
    resolution: string;
    actionTaken: string;
  }): Promise<ExceptionRow>;

  /**
   * 确认库存复盘（调用 RPC fn_confirm_inventory_recount）
   * 专用于 INVENTORY_COUNT_MISMATCH 类型
   */
  confirmInventoryRecount(params: {
    exceptionId: string;
    tenantId: string;
    confirmedBy: string;
    recountQty: number;
    notes?: string;
  }): Promise<ExceptionRow>;

  /**
   * 升级异常（转派上级/跨部门）：转移到 CONFLICT 状态（真实 CHECK 约束里没有独立的
   * ESCALATED 值，"升级"在这个状态机里就是 PENDING_REVIEW -> CONFLICT，见 ExceptionStatus）。
   * 只允许从 PENDING_REVIEW/CONFLICT 升级；已 RESOLVED/DISMISSED 的异常不允许再被升级。
   */
  escalateException(id: string, tenantId: string, escalatedTo: string, reason: string): Promise<ExceptionRow>;

  /**
   * 获取异常审计轨迹
   */
  getExceptionEvents(exceptionId: string, tenantId: string): Promise<ExceptionEventRow[]>;

  /**
   * 记录异常处理事件（内部使用，由 resolve/escalate 自动调用）
   */
  recordEvent(params: {
    exceptionId: string;
    tenantId: string;
    actorUserId: string;
    eventType: 'CREATED' | 'ASSIGNED' | 'STATUS_CHANGED' | 'RESOLVED' | 'ESCALATED' | 'RECOUNT_CONFIRMED' | 'COMMENT_ADDED';
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<ExceptionEventRow>;
}