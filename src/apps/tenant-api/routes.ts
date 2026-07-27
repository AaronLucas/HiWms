/**
 * Tenant API 业务路由
 * 端点将在后续任务中按域（订单/库存/商品/波次）逐步补充
 */
import express, { Request, Response, NextFunction, Router } from 'express';
import { TenantApiDependencies } from './di';
import { CreateOrderUseCase } from '../../core/usecases/order/CreateOrderUseCase';
import {
  createOrderBodySchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  validateBody,
  validateQuery,
  validateParams,
  type ListOrdersQuery,
  type OrderIdParams,
} from './validation';

export function createTenantApiRouter(deps: TenantApiDependencies): Router {
  const router = express.Router();
  const { orders } = deps.supabaseAdapters.repositories;

  // GET /api/orders — 列出当前租户订单
  router.get('/orders', validateQuery(listOrdersQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
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
  router.get('/orders/:id', validateParams(orderIdParamsSchema), async (req: Request, res: Response, next: NextFunction) => {
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
  router.post('/orders', validateBody(createOrderBodySchema), async (req: Request, res: Response, next: NextFunction) => {
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

  return router;
}
