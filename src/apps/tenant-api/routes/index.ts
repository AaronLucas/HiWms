/**
 * 租户业务路由工厂
 * 所有路由依赖端口接口，不直接依赖实现
 */
import { Router, Request, Response } from 'express';
import { ExpressMiddlewareFactory } from '../../adapters/express/ExpressMiddlewareFactory';
import { ITenantRepository } from '../../core/ports/db/ITenantRepository';
import { IProductRepository } from '../../core/ports/db/IProductRepository';
import { IInventoryRepository } from '../../core/ports/db/IInventoryRepository';
import { IOrderRepository } from '../../core/ports/db/IOrderRepository';
import { IWorkOrderRepository } from '../../core/ports/db/IWorkOrderRepository';
import { IRpcClient } from '../../core/ports/rpc/IRpcClient';
import { IWorkflowEngine } from '../../core/workflows/IWorkflowEngine';

export interface TenantRoutesDeps {
  repositories: {
    tenants: ITenantRepository;
    products: IProductRepository;
    inventory: IInventoryRepository;
    orders: IOrderRepository;
    workOrders: IWorkOrderRepository;
  };
  rpc: IRpcClient;
  workflowEngine: IWorkflowEngine;
  middlewareFactory: ExpressMiddlewareFactory;
}

export function createTenantRoutes(deps: TenantRoutesDeps): Router {
  const router = Router();
  const { repositories, rpc, workflowEngine, middlewareFactory } = deps;

  // ===== 租户管理 =====
  router.get('/tenant', async (req: Request, res: Response) => {
    try {
      const tenantId = req.context?.tenantId;
      if (!tenantId) return res.status(400).json({ error: 'Tenant ID required' });

      const tenant = await repositories.tenants.findById(tenantId);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      res.json(tenant);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tenant' });
    }
  });

  // ===== 产品管理 =====
  router.get('/products', middlewareFactory.requirePermission('products', 'read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const { search, limit = 50, offset = 0 } = req.query;

      let products;
      if (search) {
        products = await repositories.products.search(search as string, tenantId);
      } else {
        products = await repositories.products.findByTenant(tenantId);
      }

      res.json({ data: products.slice(Number(offset), Number(offset) + Number(limit)), total: products.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });

  router.get('/products/:id', middlewareFactory.requirePermission('products', 'read'), async (req: Request, res: Response) => {
    try {
      const product = await repositories.products.findById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json(product);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch product' });
    }
  });

  router.post('/products', middlewareFactory.requirePermission('products', 'write'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const product = await repositories.products.create({ ...req.body, tenant_id: tenantId } as any);
      res.status(201).json(product);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create product' });
    }
  });

  // ===== 库存管理 =====
  router.get('/inventory', middlewareFactory.requirePermission('inventory', 'read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const { productId, locationId, availableOnly } = req.query;

      let inventory;
      if (availableOnly === 'true' && productId) {
        inventory = await repositories.inventory.findAvailable(productId as string, locationId as string);
      } else if (productId) {
        inventory = await repositories.inventory.findByProduct(productId as string);
      } else if (locationId) {
        inventory = await repositories.inventory.findByLocation(locationId as string);
      } else {
        inventory = await repositories.inventory.findAll({ filters: { tenant_id: tenantId } });
      }

      res.json({ data: inventory });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch inventory' });
    }
  });

  router.post('/inventory/adjust', middlewareFactory.requirePermission('inventory', 'write'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const { sku, quantity, reason } = req.body;
      const result = await rpc.inventoryAdjust.adjust({ p_tenant_id: tenantId, p_sku: sku, p_quantity: quantity, p_reason: reason });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to adjust inventory' });
    }
  });

  // ===== 订单管理 =====
  router.get('/orders', middlewareFactory.requirePermission('orders', 'read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const { status, limit = 50, offset = 0 } = req.query;

      const orders = await repositories.orders.findByTenant(tenantId, {
        limit: Number(limit),
        offset: Number(offset),
        status: status as string,
      });

      res.json({ data: orders, total: orders.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  });

  router.get('/orders/:id', middlewareFactory.requirePermission('orders', 'read'), async (req: Request, res: Response) => {
    try {
      const order = await repositories.orders.findWithLines(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      res.json(order);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch order' });
    }
  });

  router.post('/orders', middlewareFactory.requirePermission('orders', 'write'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      // 实际应调用 CreateOrderUseCase
      const order = await repositories.orders.create({ ...req.body, tenant_id: tenantId, status: 'pending' } as any);
      res.status(201).json(order);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create order' });
    }
  });

  // 订单分配库存
  router.post('/orders/:id/allocate', middlewareFactory.requirePermission('orders', 'write'), async (req: Request, res: Response) => {
    try {
      const orderId = req.params.id;
      // 实际应调用 AllocateOrderUseCase
      // 这里简化演示
      const order = await repositories.orders.findWithLines(orderId);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const allocations = [];
      for (const line of order.lines) {
        const result = await rpc.stockAllocation.allocate({
          p_order_id: orderId,
          p_sku_id: line.product_id,
          p_needed_qty: line.qty,
        });
        allocations.push(...result);
      }

      await repositories.orders.updateStatus(orderId, 'allocated');
      res.json({ success: true, allocations });
    } catch (error) {
      res.status(500).json({ error: 'Failed to allocate inventory' });
    }
  });

  // ===== 波次管理 =====
  router.post('/waves', middlewareFactory.requirePermission('waves', 'write'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const { orderIds, strategyType } = req.body;

      // 启动工作流：order-process
      const instance = await workflowEngine.start('order-process', {
        orderIds,
        strategyType,
        tenantId,
      });

      res.status(201).json({ waveId: instance.id, workflowInstanceId: instance.id });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create wave' });
    }
  });

  router.get('/waves/:id/progress', middlewareFactory.requirePermission('waves', 'read'), async (req: Request, res: Response) => {
    try {
      const instance = await workflowEngine.getInstance(req.params.id);
      if (!instance) return res.status(404).json({ error: 'Wave not found' });
      res.json(instance);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch wave progress' });
    }
  });

  // ===== 工单管理 =====
  router.get('/work-orders', middlewareFactory.requirePermission('work_orders', 'read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const { assigneeId, status } = req.query;

      let workOrders;
      if (assigneeId) {
        workOrders = await repositories.workOrders.findByAssignee(assigneeId as string, status as string);
      } else {
        workOrders = await repositories.workOrders.findPendingDispatch(tenantId);
      }

      res.json({ data: workOrders });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch work orders' });
    }
  });

  router.post('/work-orders/:id/action', middlewareFactory.requirePermission('work_orders', 'write'), async (req: Request, res: Response) => {
    try {
      const { actionType, fromLocId, toLocId, skuId, qtyActed, capturedData } = req.body;
      const workOrderId = req.params.id;
      const userId = req.context!.user!.id;

      const log = await repositories.workOrders.logAction({
        wo_id: workOrderId,
        action_type: actionType,
        from_loc_id: fromLocId,
        to_loc_id: toLocId,
        sku_id: skuId,
        qty_acted: qtyActed,
        captured_data: capturedData,
        start_at: new Date().toISOString(),
        end_at: new Date().toISOString(),
      } as any);

      res.json({ success: true, log });
    } catch (error) {
      res.status(500).json({ error: 'Failed to record work order action' });
    }
  });

  // ===== 交叉理货 =====
  router.post('/cross-dock/match', middlewareFactory.requirePermission('cross_dock', 'write'), async (req: Request, res: Response) => {
    try {
      const { receiptId, skuId, qty } = req.body;
      const result = await rpc.crossDock.match({ p_receipt_id: receiptId, p_sku_id: skuId, p_qty: qty });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to match cross dock' });
    }
  });

  // ===== 计费 =====
  router.get('/billing/active-rule', middlewareFactory.requirePermission('billing', 'read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const result = await rpc.billingRule.getActive({ p_tenant_id: tenantId });
      res.json({ data: result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch billing rule' });
    }
  });

  return router;
}