/**
 * Tenant API 业务路由
 * 端点将在后续任务中按域（订单/库存/商品/波次）逐步补充
 */
import express, { Request, Response, NextFunction, Router } from 'express';
import { TenantApiDependencies } from './di';
import { CreateOrderUseCase, AllocateOrderUseCase } from '../../core/usecases/order/CreateOrderUseCase';
import { GenerateWaveUseCase } from '../../core/usecases/wave/GenerateWaveUseCase';
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

  return router;
}
