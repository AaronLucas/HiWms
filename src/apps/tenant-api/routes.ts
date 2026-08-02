/**
 * Tenant API 业务路由
 * 端点将在后续任务中按域（订单/库存/商品/波次）逐步补充
 */
import express, { Request, Response, NextFunction, Router } from 'express';
import { TenantApiDependencies } from './di';
import { CreateOrderUseCase, AllocateOrderUseCase } from '../../core/usecases/order/CreateOrderUseCase';
import { GenerateWaveUseCase } from '../../core/usecases/wave/GenerateWaveUseCase';
import { ReceiveInboundReceiptUseCase } from '../../core/usecases/inbound/ReceiveInboundReceiptUseCase';
import { GeneratePutawayWorkOrderUseCase } from '../../core/usecases/inbound/GeneratePutawayWorkOrderUseCase';
import { RecordInspectionResultUseCase } from '../../core/usecases/inspection/RecordInspectionResultUseCase';
import type { QualityInspectionResult } from '../../core/constants/status';
import {
  createOrderBodySchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  listInventoryQuerySchema,
  inventoryIdParamsSchema,
  listProductsQuerySchema,
  productIdParamsSchema,
  listWavesQuerySchema,
  generateWaveBodySchema,
  changePasswordBodySchema,
  updateOrderStatusBodySchema,
  createShippingDocBodySchema,
  handoverShippingBodySchema,
  createVehicleBodySchema,
  createWorkOrderBodySchema,
  assignWorkOrderBodySchema,
  updateWorkOrderStatusBodySchema,
  updateWaveStatusBodySchema,
  addOrdersToWaveBodySchema,
  waveIdParamsSchema,
  workOrderIdParamsSchema,
  shippingDocIdParamsSchema,
  vehicleIdParamsSchema,
  listWorkOrdersQuerySchema,
  listVehiclesQuerySchema,
  listShippingDocsQuerySchema,
  createAsnBodySchema,
  listAsnQuerySchema,
  asnIdParamsSchema,
  createInboundReceiptBodySchema,
  listInboundReceiptsQuerySchema,
  inboundReceiptIdParamsSchema,
  updateInboundReceiptStatusBodySchema,
  receiveInboundReceiptBodySchema,
  putawayInboundReceiptBodySchema,
  createQualityInspectionBodySchema,
  listQualityInspectionsQuerySchema,
  qualityInspectionIdParamsSchema,
  addInspectionItemsBodySchema,
  recordInspectionResultBodySchema,
  validateBody,
  validateQuery,
  validateParams,
  type ListOrdersQuery,
  type OrderIdParams,
  type ListInventoryQuery,
  type InventoryIdParams,
  type ListProductsQuery,
  type ProductIdParams,
  type ListWavesQuery,
  type ChangePasswordBody,
  type UpdateOrderStatusBody,
  type CreateShippingDocBody,
  type HandoverShippingBody,
  type CreateVehicleBody,
  type CreateWorkOrderBody,
  type AssignWorkOrderBody,
  type UpdateWorkOrderStatusBody,
  type UpdateWaveStatusBody,
  type AddOrdersToWaveBody,
  type WaveIdParams,
  type WorkOrderIdParams,
  type ShippingDocIdParams,
  type VehicleIdParams,
  type ListWorkOrdersQuery,
  type ListVehiclesQuery,
  type ListShippingDocsQuery,
  type CreateAsnBody,
  type ListAsnQuery,
  type AsnIdParams,
  type CreateInboundReceiptBody,
  type ListInboundReceiptsQuery,
  type InboundReceiptIdParams,
  type UpdateInboundReceiptStatusBody,
  type ReceiveInboundReceiptBody,
  type PutawayInboundReceiptBody,
  type CreateQualityInspectionBody,
  type ListQualityInspectionsQuery,
  type QualityInspectionIdParams,
  type AddInspectionItemsBody,
  type RecordInspectionResultBody,
} from './validation';

export function createTenantApiRouter(deps: TenantApiDependencies): Router {
  const router = express.Router();
  const { orders, inventory, products, waves } = deps.supabaseAdapters.repositories;

  // GET /api/orders — 列出当前租户订单
  router.get('/orders', deps.middlewareFactory.requirePermission('orders', 'READ'), validateQuery(listOrdersQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

      const { limit, offset, status } = req.query as unknown as ListOrdersQuery;
      const result = await orders.findByTenant(tenantId, { limit, offset, status, authToken: req.context?.supabaseToken });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/orders/:id — 获取订单及明细
  router.get('/orders/:id', deps.middlewareFactory.requirePermission('orders', 'READ'), validateParams(orderIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as OrderIdParams;
      const result = await orders.findWithLines(id, req.context?.supabaseToken);

      if (!result) return res.status(404).json({ success: false, error: 'Order not found' });

      // 防御性租户隔离检查（RLS 是第一道防线，这里是应用层第二道防线）
      const tenantId = req.context!.tenantId;
      if (!req.context!.user!.isSystemUser && result.order.tenant_id !== tenantId) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/orders — 创建订单
  router.post('/orders', deps.middlewareFactory.requirePermission('orders', 'CREATE'), validateBody(createOrderBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

      const useCase = new CreateOrderUseCase(deps.supabaseAdapters.client);
      const result = await useCase.execute({ tenantId, ...req.body }, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/orders/:id/allocate — 将订单从 PENDING 推进到 ALLOCATED（按明细逐行分配库存）
  router.post('/orders/:id/allocate', deps.middlewareFactory.requirePermission('orders', 'UPDATE'), validateParams(orderIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

      const { id } = req.params as unknown as OrderIdParams;
      const authToken = req.context?.supabaseToken;
      const order = await orders.findById(id, authToken);

      if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
      if (!req.context!.user!.isSystemUser && order.tenant_id !== tenantId) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      const useCase = new AllocateOrderUseCase(deps.supabaseAdapters.client);
      const result = await useCase.execute({ orderId: id, tenantId }, authToken);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/inventory — 列出当前租户库存（只读）
  router.get('/inventory', deps.middlewareFactory.requirePermission('inventory', 'READ'), validateQuery(listInventoryQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

      const { limit, offset, productId, locationId } = req.query as unknown as ListInventoryQuery;
      const filters: Record<string, unknown> = { tenant_id: tenantId };
      if (productId) filters.product_id = productId;
      if (locationId) filters.location_id = locationId;

      const result = await inventory.findAll({
        limit,
        offset,
        filters,
        orderBy: 'product_id',
        ascending: true,
        authToken: req.context?.supabaseToken,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/inventory/:id — 获取单条库存记录
  router.get('/inventory/:id', deps.middlewareFactory.requirePermission('inventory', 'READ'), validateParams(inventoryIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as InventoryIdParams;
      const result = await inventory.findById(id, req.context?.supabaseToken);

      if (!result) return res.status(404).json({ success: false, error: 'Inventory record not found' });

      const tenantId = req.context!.tenantId;
      if (!req.context!.user!.isSystemUser && (result as { tenant_id: string }).tenant_id !== tenantId) {
        return res.status(404).json({ success: false, error: 'Inventory record not found' });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/products — 列出/搜索当前租户商品
  router.get('/products', deps.middlewareFactory.requirePermission('products', 'READ'), validateQuery(listProductsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

      const { limit, offset, q } = req.query as unknown as ListProductsQuery;
      const result = q
        ? await products.search(q, tenantId, req.context?.supabaseToken)
        : await products.findByTenant(tenantId, { limit, offset, authToken: req.context?.supabaseToken });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/products/:id — 获取单个商品
  router.get('/products/:id', deps.middlewareFactory.requirePermission('products', 'READ'), validateParams(productIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ProductIdParams;
      const result = await products.findById(id, req.context?.supabaseToken);

      if (!result) return res.status(404).json({ success: false, error: 'Product not found' });

      const tenantId = req.context!.tenantId;
      if (!req.context!.user!.isSystemUser && (result as { tenant_id: string }).tenant_id !== tenantId) {
        return res.status(404).json({ success: false, error: 'Product not found' });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/waves — 列出当前租户波次
  router.get('/waves', deps.middlewareFactory.requirePermission('waves', 'READ'), validateQuery(listWavesQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

      const { limit, offset, status, strategyType } = req.query as unknown as ListWavesQuery;
      const result = await waves.findByTenant(tenantId, {
        limit,
        offset,
        status,
        strategyType,
        authToken: req.context?.supabaseToken,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/waves/generate — 生成波次
  router.post('/waves/generate', deps.middlewareFactory.requirePermission('waves', 'CREATE'), validateBody(generateWaveBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

      const useCase = new GenerateWaveUseCase(deps.supabaseAdapters.client);
      const result = await useCase.execute({ tenantId, ...req.body }, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/users/me/password — 用户自助改密码（ROADMAP 5.4）
  // 不走 requirePermission：改自己的密码不是 RBAC 资源权限问题，是身份问题——
  // 已通过认证中间件（authenticate()）即代表就是 req.context.user.id 本人。
  router.patch('/users/me/password', validateBody(changePasswordBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.context!.user!.id;
      const { newPassword } = req.body as ChangePasswordBody;
      await deps.supabaseAdapters.auth.provider.changePassword(userId, newPassword);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });


  // ===== Sprint 4: 出库闭环 =====
  const { workOrders: wo, shippingDocuments: shipping, vehicles: vehiclesRepo } = deps.supabaseAdapters.repositories;

  // --- 订单状态更新 ---
  router.patch('/orders/:id/status', deps.middlewareFactory.requirePermission('orders', 'UPDATE'), validateParams(orderIdParamsSchema), validateBody(updateOrderStatusBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as OrderIdParams;
      const { status } = req.body as UpdateOrderStatusBody;
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });

      const order = await orders.findById(id, req.context?.supabaseToken);
      if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
      if (!req.context!.user!.isSystemUser && (order as Record<string,unknown>).tenant_id !== tenantId) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      const updated = await orders.update(id, { status } as Record<string,unknown>, req.context?.supabaseToken);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  });

  // --- 波次详情 ---
  router.get('/waves/:id', deps.middlewareFactory.requirePermission('waves', 'READ'), validateParams(waveIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as WaveIdParams;
      const result = await waves.findById(id, req.context?.supabaseToken);
      if (!result) return res.status(404).json({ success: false, error: 'Wave not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 波次状态更新 ---
  router.patch('/waves/:id/status', deps.middlewareFactory.requirePermission('waves', 'UPDATE'), validateParams(waveIdParamsSchema), validateBody(updateWaveStatusBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as WaveIdParams;
      const { status } = req.body as UpdateWaveStatusBody;
      const updated = await waves.updateStatus(id, status);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  });

  // --- 波次释放 ---
  router.post('/waves/:id/release', deps.middlewareFactory.requirePermission('waves', 'UPDATE'), validateParams(waveIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as WaveIdParams;
      const updated = await waves.updateStatus(id, 'RELEASED');
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  });

  // --- 波次添加订单 ---
  router.post('/waves/:id/orders', deps.middlewareFactory.requirePermission('waves', 'UPDATE'), validateParams(waveIdParamsSchema), validateBody(addOrdersToWaveBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as WaveIdParams;
      const { orderIds } = req.body as AddOrdersToWaveBody;
      const added = await waves.addOrdersToWave(id, orderIds);
      res.json({ success: true, data: { added } });
    } catch (error) {
      next(error);
    }
  });

  // --- 波次移除订单 ---
  router.delete('/waves/:id/orders/:orderId', deps.middlewareFactory.requirePermission('waves', 'UPDATE'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await waves.removeOrdersFromWave(req.params.id, [req.params.orderId]);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // --- 工单列表 ---
  router.get('/work-orders', deps.middlewareFactory.requirePermission('work_orders', 'READ'), validateQuery(listWorkOrdersQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset, status, type } = req.query as unknown as ListWorkOrdersQuery;
      const result = await wo.findAll({ limit, offset, filters: { tenant_id: tenantId }, authToken: req.context?.supabaseToken });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 工单详情 ---
  router.get('/work-orders/:id', deps.middlewareFactory.requirePermission('work_orders', 'READ'), validateParams(workOrderIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as WorkOrderIdParams;
      const result = await wo.findById(id, req.context?.supabaseToken);
      if (!result) return res.status(404).json({ success: false, error: 'Work order not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 创建工单 ---
  router.post('/work-orders', deps.middlewareFactory.requirePermission('work_orders', 'CREATE'), validateBody(createWorkOrderBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateWorkOrderBody & { tenant_id: string };
      body.tenant_id = tenantId;
      const result = await wo.create(body as any, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 工单状态更新 ---
  router.patch('/work-orders/:id/status', deps.middlewareFactory.requirePermission('work_orders', 'UPDATE'), validateParams(workOrderIdParamsSchema), validateBody(updateWorkOrderStatusBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as WorkOrderIdParams;
      const { status, notes } = req.body as UpdateWorkOrderStatusBody;
      const updated = await wo.updateStatus(id, status);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  });

  // --- 工单派发 ---
  router.post('/work-orders/:id/assign', deps.middlewareFactory.requirePermission('work_orders', 'UPDATE'), validateParams(workOrderIdParamsSchema), validateBody(assignWorkOrderBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as WorkOrderIdParams;
      const { assigneeId } = req.body as AssignWorkOrderBody;
      const updated = await wo.update(id, { assigned_to: assigneeId, status: 'assigned' } as Record<string,unknown>, req.context?.supabaseToken);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  });

  // --- 工单操作日志 ---
  router.get('/work-orders/:id/logs', deps.middlewareFactory.requirePermission('work_orders', 'READ'), validateParams(workOrderIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as WorkOrderIdParams;
      const logs = await wo.getActionLogsByWorkOrder(id);
      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  });

  // --- 发货单列表 ---
  router.get('/shipping-documents', deps.middlewareFactory.requirePermission('shipping', 'READ'), validateQuery(listShippingDocsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset, status } = req.query as unknown as ListShippingDocsQuery;
      const result = await shipping.findByTenant(tenantId, { limit, offset, status,  });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 发货单详情 ---
  router.get('/shipping-documents/:id', deps.middlewareFactory.requirePermission('shipping', 'READ'), validateParams(shippingDocIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ShippingDocIdParams;
      const result = await shipping.findById(id);
      if (!result) return res.status(404).json({ success: false, error: 'Shipping document not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 创建发货单 ---
  router.post('/shipping-documents', deps.middlewareFactory.requirePermission('shipping', 'CREATE'), validateBody(createShippingDocBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateShippingDocBody & { tenant_id: string };
      body.tenant_id = tenantId;
      const result = await shipping.create(body as any, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 发货单交接承运商 ---
  router.post('/shipping-documents/:id/handover', deps.middlewareFactory.requirePermission('shipping', 'UPDATE'), validateParams(shippingDocIdParamsSchema), validateBody(handoverShippingBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ShippingDocIdParams;
      const now = new Date().toISOString();
      const updated = await shipping.updateStatus(id, 'in_transit', now);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  });

  // --- 车辆列表 ---
  router.get('/vehicles', deps.middlewareFactory.requirePermission('vehicles', 'READ'), validateQuery(listVehiclesQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset } = req.query as unknown as ListVehiclesQuery;
      const result = await vehiclesRepo.findAll({ limit, offset, filters: { tenant_id: tenantId }, authToken: req.context?.supabaseToken });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 车辆登记 ---
  router.post('/vehicles', deps.middlewareFactory.requirePermission('vehicles', 'CREATE'), validateBody(createVehicleBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateVehicleBody & { tenant_id: string };
      body.tenant_id = tenantId;
      const result = await vehiclesRepo.create(body as any, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // ===== Sprint 5: 入库全链路（ASN→收货→质检→上架） =====
  const { asn, inboundReceipts, qualityInspections } = deps.supabaseAdapters.repositories;

  // --- 创建 ASN ---
  router.post('/asn', deps.middlewareFactory.requirePermission('asn', 'CREATE'), validateBody(createAsnBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateAsnBody;
      const result = await asn.create({
        tenant_id: tenantId,
        receipt_no: body.receiptNo,
        supplier_name: body.supplierName ?? null,
        expected_at: body.expectedAt ?? null,
        metadata: body.metadata ?? null,
        status: 'PENDING',
      } as any, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- ASN 列表 ---
  router.get('/asn', deps.middlewareFactory.requirePermission('asn', 'READ'), validateQuery(listAsnQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset, status, supplierName } = req.query as unknown as ListAsnQuery;
      const result = await asn.findByTenant(tenantId, { limit, offset, status, supplierName });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- ASN 详情 ---
  router.get('/asn/:id', deps.middlewareFactory.requirePermission('asn', 'READ'), validateParams(asnIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as AsnIdParams;
      const result = await asn.findById(id, req.context?.supabaseToken);
      if (!result) return res.status(404).json({ success: false, error: 'ASN not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 入库单列表 ---
  router.get('/inbound-receipts', deps.middlewareFactory.requirePermission('inbound_receipts', 'READ'), validateQuery(listInboundReceiptsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset, status, supplierName } = req.query as unknown as ListInboundReceiptsQuery;
      const result = await inboundReceipts.findByTenant(tenantId, { limit, offset, status, supplierName });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 入库单详情 ---
  router.get('/inbound-receipts/:id', deps.middlewareFactory.requirePermission('inbound_receipts', 'READ'), validateParams(inboundReceiptIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as InboundReceiptIdParams;
      const result = await inboundReceipts.findById(id, req.context?.supabaseToken);
      if (!result) return res.status(404).json({ success: false, error: 'Inbound receipt not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 创建入库单 ---
  router.post('/inbound-receipts', deps.middlewareFactory.requirePermission('inbound_receipts', 'CREATE'), validateBody(createInboundReceiptBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateInboundReceiptBody;
      const result = await inboundReceipts.create({
        tenant_id: tenantId,
        receipt_no: body.receiptNo,
        supplier_name: body.supplierName ?? null,
        expected_at: body.expectedAt ?? null,
        wave_id: body.waveId ?? null,
        metadata: body.metadata ?? null,
        status: 'PENDING',
      } as any, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 入库单状态更新 ---
  router.patch('/inbound-receipts/:id/status', deps.middlewareFactory.requirePermission('inbound_receipts', 'UPDATE'), validateParams(inboundReceiptIdParamsSchema), validateBody(updateInboundReceiptStatusBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as InboundReceiptIdParams;
      const { status } = req.body as UpdateInboundReceiptStatusBody;
      const updated = await inboundReceipts.updateStatus(id, status);
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  });

  // --- 入库单收货 ---
  router.post('/inbound-receipts/:id/receive', deps.middlewareFactory.requirePermission('inbound_receipts', 'UPDATE'), validateParams(inboundReceiptIdParamsSchema), validateBody(receiveInboundReceiptBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { id } = req.params as unknown as InboundReceiptIdParams;
      const { receivedAt } = req.body as ReceiveInboundReceiptBody;
      const useCase = new ReceiveInboundReceiptUseCase(deps.supabaseAdapters.client);
      const result = await useCase.execute({ tenantId, receiptId: id, receivedAt }, req.context?.supabaseToken);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 入库单触发上架 ---
  router.post('/inbound-receipts/:id/putaway', deps.middlewareFactory.requirePermission('inbound_receipts', 'UPDATE'), validateParams(inboundReceiptIdParamsSchema), validateBody(putawayInboundReceiptBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { id } = req.params as unknown as InboundReceiptIdParams;
      const { assignedUserId } = req.body as PutawayInboundReceiptBody;
      const useCase = new GeneratePutawayWorkOrderUseCase(deps.supabaseAdapters.client);
      const result = await useCase.execute({ tenantId, receiptId: id, assignedUserId }, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 质检单列表 ---
  router.get('/quality-inspections', deps.middlewareFactory.requirePermission('quality_inspections', 'READ'), validateQuery(listQualityInspectionsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset, status, result, orderId, waveId } = req.query as unknown as ListQualityInspectionsQuery;
      const data = await qualityInspections.findByTenant(tenantId, { limit, offset, status, result, orderId, waveId });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // --- 质检单详情（含明细项） ---
  router.get('/quality-inspections/:id', deps.middlewareFactory.requirePermission('quality_inspections', 'READ'), validateParams(qualityInspectionIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as QualityInspectionIdParams;
      const result = await qualityInspections.findWithItems(id);
      if (!result) return res.status(404).json({ success: false, error: 'Quality inspection not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 创建质检单 ---
  router.post('/quality-inspections', deps.middlewareFactory.requirePermission('quality_inspections', 'CREATE'), validateBody(createQualityInspectionBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateQualityInspectionBody;
      const result = await qualityInspections.create({
        tenant_id: tenantId,
        inspection_no: body.inspectionNo,
        order_id: body.orderId ?? null,
        wave_id: body.waveId ?? null,
        sku_id: body.skuId ?? null,
        inspector_id: body.inspectorId ?? null,
        device_id: body.deviceId ?? null,
        metadata: body.metadata ?? null,
        status: 'PENDING',
      } as any, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 添加质检明细项 ---
  router.post('/quality-inspections/:id/items', deps.middlewareFactory.requirePermission('quality_inspections', 'UPDATE'), validateParams(qualityInspectionIdParamsSchema), validateBody(addInspectionItemsBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as QualityInspectionIdParams;
      const tenantId = req.context!.tenantId;
      const { items } = req.body as AddInspectionItemsBody;
      const inserted = await qualityInspections.createInspectionItems(items.map(item => ({
        inspection_id: id,
        tenant_id: tenantId,
        check_type: item.checkType,
        expected_value: item.expectedValue ?? null,
        tolerance_pct: item.tolerancePct ?? null,
        notes: item.notes ?? null,
      })) as any);
      res.status(201).json({ success: true, data: inserted });
    } catch (error) {
      next(error);
    }
  });

  // --- 记录质检结果（同时视为完成质检） ---
  router.patch('/quality-inspections/:id/result', deps.middlewareFactory.requirePermission('quality_inspections', 'UPDATE'), validateParams(qualityInspectionIdParamsSchema), validateBody(recordInspectionResultBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { id } = req.params as unknown as QualityInspectionIdParams;
      const { result, discrepancyDetails, notes } = req.body as RecordInspectionResultBody;
      const useCase = new RecordInspectionResultUseCase(deps.supabaseAdapters.client);
      const data = await useCase.execute({ tenantId, inspectionId: id, result: result as QualityInspectionResult, discrepancyDetails, notes }, req.context?.supabaseToken);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
