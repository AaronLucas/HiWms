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
import type { TablesInsert, TablesUpdate } from '../../types/database';
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
  // Sprint 6: 库存操作 + 主数据
  adjustInventoryBodySchema,
  transferInventoryBodySchema,
  reserveInventoryBodySchema,
  lockInventoryBodySchema,
  releaseReservationBodySchema,
  unlockInventoryBodySchema,
  listInventoryHistoryQuerySchema,
  getAvailableInventoryQuerySchema,
  createLocationBodySchema,
  updateLocationBodySchema,
  listLocationsQuerySchema,
  locationIdParamsSchema,
  updateLocationStatusBodySchema,
  updateLocationCapacityBodySchema,
  createContainerBodySchema,
  updateContainerBodySchema,
  listContainersQuerySchema,
  containerIdParamsSchema,
  sealContainerBodySchema,
  moveContainerBodySchema,
  containerContentsQuerySchema,
  lpnQueryParamsSchema,
  createProductBodySchema,
  updateProductBodySchema,
  addProductBarcodeBodySchema,
  listProductBarcodesQuerySchema,
  productConstraintBodySchema,
  updateProductAbcClassBodySchema,
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
  // Sprint 6 types
  type AdjustInventoryBody,
  type TransferInventoryBody,
  type ReserveInventoryBody,
  type LockInventoryBody,
  type ReleaseReservationBody,
  type UnlockInventoryBody,
  type ListInventoryHistoryQuery,
  type GetAvailableInventoryQuery,
  type CreateLocationBody,
  type UpdateLocationBody,
  type ListLocationsQuery,
  type LocationIdParams,
  type UpdateLocationStatusBody,
  type UpdateLocationCapacityBody,
  type CreateContainerBody,
  type UpdateContainerBody,
  type ListContainersQuery,
  type ContainerIdParams,
  type SealContainerBody,
  type MoveContainerBody,
  type ContainerContentsQuery,
  type LpnQueryParams,
  type CreateProductBody,
  type UpdateProductBody,
  type AddProductBarcodeBody,
  type ListProductBarcodesQuery,
  type ProductConstraintBody,
  type UpdateProductAbcClassBody,
} from './validation';

export function createTenantApiRouter(deps: TenantApiDependencies): Router {
  const router = express.Router();
  const { orders, inventory, products, waves, asn, inboundReceipts, qualityInspections, locations, containers, workOrders: wo, shippingDocuments: shipping, vehicles: vehiclesRepo } = deps.supabaseAdapters.repositories;

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
      const body = req.body as CreateWorkOrderBody;
      const insertData: TablesInsert<'work_orders'> = {
        tenant_id: tenantId,
        related_order_id: body.orderId ?? null,
        wave_id: body.waveId ?? null,
        task_type: body.type,
        assigned_user_id: body.assignedTo ?? null,
        expected_duration_seconds: body.priority ?? null,
        pda_summary: body.notes ?? null,
      };
      const result = await wo.create(insertData, req.context?.supabaseToken);
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
      const body = req.body as CreateShippingDocBody;
      const insertData: TablesInsert<'shipping_documents'> = {
        tenant_id: tenantId,
        doc_number: `SD-${Date.now()}`,
        doc_type: 'shipping',
        content: { orderIds: body.orderIds, carrierId: body.carrierId, trackingNumber: body.trackingNumber, notes: body.notes },
        issued_at: new Date().toISOString(),
        issued_by: req.context?.user?.id ?? null,
      };
      const result = await shipping.create(insertData, req.context?.supabaseToken);
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
      const body = req.body as CreateVehicleBody;
      const insertData: TablesInsert<'vehicles'> = {
        tenant_id: tenantId,
        vehicle_no: body.plateNumber,
        type: body.vehicleType ?? 'truck',
        license_plate: body.plateNumber,
        driver_name: body.driverName ?? null,
        driver_phone: body.driverPhone ?? null,
        max_volume: 0,
        max_weight: 0,
      };
      const result = await vehiclesRepo.create(insertData, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // ===== Sprint 5: 入库全链路（ASN→收货→质检→上架） =====

  // --- 创建 ASN ---
  router.post('/asn', deps.middlewareFactory.requirePermission('asn', 'CREATE'), validateBody(createAsnBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateAsnBody;
      const insertData: TablesInsert<'inbound_receipts'> = {
        tenant_id: tenantId,
        receipt_no: body.receiptNo,
        supplier_name: body.supplierName ?? null,
        expected_at: body.expectedAt ?? null,
        metadata: body.metadata as any,
        status: 'PENDING',
      };
      const result = await asn.create(insertData, req.context?.supabaseToken);
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
      const insertData: TablesInsert<'inbound_receipts'> = {
        tenant_id: tenantId,
        receipt_no: body.receiptNo,
        supplier_name: body.supplierName ?? null,
        expected_at: body.expectedAt ?? null,
        wave_id: body.waveId ?? null,
        metadata: body.metadata as any,
        status: 'PENDING',
      };
      const result = await inboundReceipts.create(insertData, req.context?.supabaseToken);
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
      const insertData: TablesInsert<'quality_inspections'> = {
        tenant_id: tenantId,
        inspection_no: body.inspectionNo,
        order_id: body.orderId ?? null,
        wave_id: body.waveId ?? null,
        sku_id: body.skuId ?? null,
        inspector_id: body.inspectorId ?? null,
        device_id: body.deviceId ?? null,
        metadata: body.metadata as any,
        status: 'PENDING',
      };
      const result = await qualityInspections.create(insertData, req.context?.supabaseToken);
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
        expected_value: item.expectedValue as any ?? null,
        tolerance_pct: item.tolerancePct ?? null,
        notes: item.notes ?? null,
      })));
      res.status(201).json({ success: true, data: inserted });
    } catch (error) {
      next(error);
    }
  });

  // ===== Sprint 6: 库存操作 + 主数据（库位/容器/商品写） =====

  // --- 库存写操作 ---
  // POST /api/inventory/adjust — 库存调整
  router.post('/inventory/adjust', deps.middlewareFactory.requirePermission('inventory', 'UPDATE'), validateBody(adjustInventoryBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as AdjustInventoryBody;
      const result = await inventory.adjustInventory({ ...body, tenantId, authToken: req.context?.supabaseToken });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/inventory/transfer — 库存移库
  router.post('/inventory/transfer', deps.middlewareFactory.requirePermission('inventory', 'UPDATE'), validateBody(transferInventoryBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as TransferInventoryBody;
      const result = await inventory.transferInventory({ ...body, tenantId, authToken: req.context?.supabaseToken });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/inventory/reserve — 预留库存
  router.post('/inventory/reserve', deps.middlewareFactory.requirePermission('inventory', 'UPDATE'), validateBody(reserveInventoryBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as ReserveInventoryBody;
      const result = await inventory.reserveInventory({ ...body, tenantId, authToken: req.context?.supabaseToken });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/inventory/lock — 锁定库存
  router.post('/inventory/lock', deps.middlewareFactory.requirePermission('inventory', 'UPDATE'), validateBody(lockInventoryBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as LockInventoryBody;
      const result = await inventory.lockInventory({ ...body, tenantId, authToken: req.context?.supabaseToken });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/inventory/release-reservation — 释放预留库存
  router.post('/inventory/release-reservation', deps.middlewareFactory.requirePermission('inventory', 'UPDATE'), validateBody(releaseReservationBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as ReleaseReservationBody;
      const result = await inventory.releaseReservation({ ...body, tenantId, authToken: req.context?.supabaseToken });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/inventory/unlock — 解除锁定库存
  router.post('/inventory/unlock', deps.middlewareFactory.requirePermission('inventory', 'UPDATE'), validateBody(unlockInventoryBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as UnlockInventoryBody;
      const result = await inventory.unlockInventory({ ...body, tenantId, authToken: req.context?.supabaseToken });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/inventory/history — 库存历史变动
  router.get('/inventory/history', deps.middlewareFactory.requirePermission('inventory', 'READ'), validateQuery(listInventoryHistoryQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset, productId, locationId, startDate, endDate } = req.query as unknown as ListInventoryHistoryQuery;
      const result = await inventory.getInventoryHistory(tenantId, { limit, offset, productId, locationId, startDate, endDate, authToken: req.context?.supabaseToken });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/inventory/available — 查询可用库存量
  router.get('/inventory/available', deps.middlewareFactory.requirePermission('inventory', 'READ'), validateQuery(getAvailableInventoryQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId, locationId, excludeReserved, excludeLocked } = req.query as unknown as GetAvailableInventoryQuery;
      const result = await inventory.getAvailableQuantity({ productId, locationId, excludeReserved, excludeLocked, authToken: req.context?.supabaseToken });
      res.json({ success: true, data: { availableQuantity: result } });
    } catch (error) {
      next(error);
    }
  });

  // --- 库位 CRUD + 状态/容量/利用率 ---
  // POST /api/locations — 创建库位
  router.post('/locations', deps.middlewareFactory.requirePermission('locations', 'CREATE'), validateBody(createLocationBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateLocationBody;
      const insertData: TablesInsert<'locations'> = {
        tenant_id: tenantId,
        code: body.code,
        name: body.name ?? null,
        zone_id: body.zoneId ?? null,
        zone_type: body.zoneType ?? null,
        aisle: body.aisle ?? null,
        bay: body.rack ?? null,
        level: body.level ?? null,
        position: body.position ?? null,
        max_volume_capacity: body.maxVolumeCapacity ?? null,
        max_weight_capacity: body.maxWeightCapacity ?? null,
        picking_max_qty: body.pickingMaxQty ?? null,
        picking_threshold_pct: body.pickingThresholdPct ?? null,
        is_active: body.isActive ?? true,
        is_frozen: body.isFrozen ?? false,
        force_unique_tracking: body.forceUniqueTracking ?? false,
      };
      const result = await locations.create(insertData, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/locations — 库位列表
  router.get('/locations', deps.middlewareFactory.requirePermission('locations', 'READ'), validateQuery(listLocationsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset, zoneId, zoneType, isActive, isFrozen } = req.query as unknown as ListLocationsQuery;
      const result = await locations.findByTenant(tenantId, { limit, offset, zoneType, isActive, isFrozen });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/locations/:id — 库位详情
  router.get('/locations/:id', deps.middlewareFactory.requirePermission('locations', 'READ'), validateParams(locationIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as LocationIdParams;
      const result = await locations.findWithDetails(id);
      if (!result) return res.status(404).json({ success: false, error: 'Location not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/locations/:id — 更新库位
  router.patch('/locations/:id', deps.middlewareFactory.requirePermission('locations', 'UPDATE'), validateParams(locationIdParamsSchema), validateBody(updateLocationBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { id } = req.params as unknown as LocationIdParams;
      const body = req.body as UpdateLocationBody;
      const updateData: TablesUpdate<'locations'> = {
        name: body.name ?? undefined,
        zone_id: body.zoneId ?? undefined,
        zone_type: body.zoneType ?? undefined,
        aisle: body.aisle ?? undefined,
        bay: body.rack ?? undefined,
        level: body.level ?? undefined,
        position: body.position ?? undefined,
        max_volume_capacity: body.maxVolumeCapacity ?? undefined,
        max_weight_capacity: body.maxWeightCapacity ?? undefined,
        picking_max_qty: body.pickingMaxQty ?? undefined,
        picking_threshold_pct: body.pickingThresholdPct ?? undefined,
        force_unique_tracking: body.forceUniqueTracking ?? undefined,
      };
      const result = await locations.update(id, updateData);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/locations/:id/status — 更新库位状态
  router.patch('/locations/:id/status', deps.middlewareFactory.requirePermission('locations', 'UPDATE'), validateParams(locationIdParamsSchema), validateBody(updateLocationStatusBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as LocationIdParams;
      const { isActive, isFrozen } = req.body as UpdateLocationStatusBody;
      const result = await locations.updateStatus(id, isActive, isFrozen);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/locations/:id/capacity — 更新库位容量
  router.patch('/locations/:id/capacity', deps.middlewareFactory.requirePermission('locations', 'UPDATE'), validateParams(locationIdParamsSchema), validateBody(updateLocationCapacityBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as LocationIdParams;
      const body = req.body as UpdateLocationCapacityBody;
      const result = await locations.updateCapacity(id, body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/locations/utilization — 库位利用率统计
  router.get('/locations/utilization', deps.middlewareFactory.requirePermission('locations', 'READ'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const result = await locations.getUtilizationStats(tenantId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 容器 CRUD + 封箱/移动/内容物/层级树/LPN ---
  // POST /api/containers — 创建容器
  router.post('/containers', deps.middlewareFactory.requirePermission('containers', 'CREATE'), validateBody(createContainerBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateContainerBody;
      const insertData: TablesInsert<'containers'> = {
        lpn_code: body.lpnCode,
        container_type: body.containerType ?? 'box',
        parent_container_id: body.parentContainerId ?? undefined,
        status: body.status ?? 'IDLE',
        is_sealed: body.isSealed ?? false,
        lpn_source: body.lpnSource ?? 'internal',
      };
      const result = await containers.create(insertData, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/containers — 容器列表
  router.get('/containers', deps.middlewareFactory.requirePermission('containers', 'READ'), validateQuery(listContainersQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { limit, offset, status, containerType } = req.query as unknown as ListContainersQuery;
      const result = await containers.findByTenant(tenantId, { limit, offset, status, containerType });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/containers/:id — 容器详情
  router.get('/containers/:id', deps.middlewareFactory.requirePermission('containers', 'READ'), validateParams(containerIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ContainerIdParams;
      const result = await containers.findById(id);
      if (!result) return res.status(404).json({ success: false, error: 'Container not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/containers/:id — 更新容器
  router.patch('/containers/:id', deps.middlewareFactory.requirePermission('containers', 'UPDATE'), validateParams(containerIdParamsSchema), validateBody(updateContainerBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { id } = req.params as unknown as ContainerIdParams;
      const body = req.body as UpdateContainerBody;
      const updateData: TablesUpdate<'containers'> = {
        container_type: body.containerType ?? undefined,
        parent_container_id: body.parentContainerId ?? undefined,
        lpn_source: body.lpnSource ?? undefined,
      };
      const result = await containers.update(id, updateData);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/containers/:id/seal — 封箱/解封
  router.patch('/containers/:id/seal', deps.middlewareFactory.requirePermission('containers', 'UPDATE'), validateParams(containerIdParamsSchema), validateBody(sealContainerBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ContainerIdParams;
      const { isSealed } = req.body as SealContainerBody;
      const result = await containers.updateSealStatus(id, isSealed);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/containers/:id/move — 移动容器
  router.patch('/containers/:id/move', deps.middlewareFactory.requirePermission('containers', 'UPDATE'), validateParams(containerIdParamsSchema), validateBody(moveContainerBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ContainerIdParams;
      const { parentContainerId } = req.body as MoveContainerBody;
      const result = await containers.moveContainer(id, parentContainerId ?? null);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/containers/:id/contents — 容器内容物
  router.get('/containers/:id/contents', deps.middlewareFactory.requirePermission('containers', 'READ'), validateParams(containerIdParamsSchema), validateQuery(containerContentsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ContainerIdParams;
      const { limit, offset, includeNested } = req.query as unknown as ContainerContentsQuery;
      const result = await containers.getContents(id, includeNested);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/containers/:id/hierarchy — 容器层级树
  router.get('/containers/:id/hierarchy', deps.middlewareFactory.requirePermission('containers', 'READ'), validateParams(containerIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ContainerIdParams;
      const result = await containers.getHierarchy(id);
      if (!result) return res.status(404).json({ success: false, error: 'Container not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/containers/lpn/:lpnCode — 按 LPN 查询容器
  router.get('/containers/lpn/:lpnCode', deps.middlewareFactory.requirePermission('containers', 'READ'), validateParams(lpnQueryParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { lpnCode } = req.params as unknown as LpnQueryParams;
      const result = await containers.findByLpn(lpnCode, tenantId);
      if (!result) return res.status(404).json({ success: false, error: 'Container not found' });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/containers/utilization — 容器利用率统计
  router.get('/containers/utilization', deps.middlewareFactory.requirePermission('containers', 'READ'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const result = await containers.getUtilizationStats(tenantId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 商品写操作 CRUD + 条码/约束/ABC分类 ---
  // POST /api/products — 创建商品
  router.post('/products', deps.middlewareFactory.requirePermission('products', 'CREATE'), validateBody(createProductBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const body = req.body as CreateProductBody;
      const insertData: TablesInsert<'products'> = {
        tenant_id: tenantId,
        sku: body.sku,
        name: body.name,
        abc_class: body.abcClass ?? 'C',
        unit_volume: body.volumePerUnit ?? null,
        unit_weight: body.weightPerUnit ?? null,
      };
      const result = await products.create(insertData, req.context?.supabaseToken);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/products/:id — 更新商品
  router.patch('/products/:id', deps.middlewareFactory.requirePermission('products', 'UPDATE'), validateParams(productIdParamsSchema), validateBody(updateProductBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { id } = req.params as unknown as ProductIdParams;
      const body = req.body as UpdateProductBody;
      const updateData: TablesUpdate<'products'> = {
        name: body.name ?? undefined,
        abc_class: body.abcClass ?? undefined,
        unit_volume: body.volumePerUnit ?? undefined,
        unit_weight: body.weightPerUnit ?? undefined,
      };
      const result = await products.update(id, updateData);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/products/:id/barcodes — 添加条码
  router.post('/products/:id/barcodes', deps.middlewareFactory.requirePermission('products', 'UPDATE'), validateParams(productIdParamsSchema), validateBody(addProductBarcodeBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.context!.tenantId;
      if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant context required' });
      const { id } = req.params as unknown as ProductIdParams;
      const { barcode, targetType, targetSubtype, isPrimary } = req.body as AddProductBarcodeBody;
      const result = await products.addBarcode(id, barcode, targetType, targetSubtype, isPrimary);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /api/products/:id/barcodes/:barcodeId — 删除条码
  router.delete('/products/:id/barcodes/:barcodeId', deps.middlewareFactory.requirePermission('products', 'UPDATE'), validateParams(productIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { barcodeId } = req.params;
      await products.removeBarcode(barcodeId);
      res.json({ success: true, data: { deleted: true } });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/products/:id/barcodes — 商品条码列表
  router.get('/products/:id/barcodes', deps.middlewareFactory.requirePermission('products', 'READ'), validateParams(productIdParamsSchema), validateQuery(listProductBarcodesQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ProductIdParams;
      const { limit, offset } = req.query as unknown as ListProductBarcodesQuery;
      const result = await products.getBarcodes(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/products/:id/constraints — 添加/更新约束
  router.post('/products/:id/constraints', deps.middlewareFactory.requirePermission('products', 'UPDATE'), validateParams(productIdParamsSchema), validateBody(productConstraintBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ProductIdParams;
      const { constraintType, constraintValue, severity } = req.body as ProductConstraintBody;
      const result = await products.upsertConstraint(id, constraintType, constraintValue, severity);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /api/products/:id/constraints/:constraintId — 删除约束
  router.delete('/products/:id/constraints/:constraintId', deps.middlewareFactory.requirePermission('products', 'UPDATE'), validateParams(productIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { constraintId } = req.params;
      await products.removeConstraint(constraintId);
      res.json({ success: true, data: { deleted: true } });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/products/:id/abc-class — 更新 ABC 分类
  router.patch('/products/:id/abc-class', deps.middlewareFactory.requirePermission('products', 'UPDATE'), validateParams(productIdParamsSchema), validateBody(updateProductAbcClassBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as unknown as ProductIdParams;
      const { abcClass } = req.body as UpdateProductAbcClassBody;
      const result = await products.updateAbcClass(id, abcClass);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // --- 记录质检结果（同时视为完成质检） ---
  return router;
}
