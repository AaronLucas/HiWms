/**
 * 设备/PDA API 入口
 * 设备端点：/api/device/*
 * 中间件：轻量认证 + 离线队列支持 + 批量同步
 * 专门针对 PDA/扫码枪/手持终端优化
 */
import express, { Request, Response } from 'express';
import { ExpressMiddlewareFactory } from '../../adapters/express/ExpressMiddlewareFactory';
import { createSupabaseAdapters } from '../../adapters/supabase';
import { IndexedDBQueue } from '../../adapters/offline/IndexedDBQueue';

interface DeviceApiConfig {
  supabase: {
    url: string;
    anonKey: string;
  };
  offlineQueue?: {
    maxSize: number;
    syncIntervalMs: number;
  };
}

export async function createDeviceApiApp(config: DeviceApiConfig): Promise<express.Application> {
  const app = express();

  // 增加请求体大小限制（设备批量上传）
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 初始化 Supabase 适配器
  const supabaseAdapters = createSupabaseAdapters({
    url: config.supabase.url,
    anonKey: config.supabase.anonKey,
  });

  // 初始化离线队列（实际运行在设备端，这里提供同步端点）
  const offlineQueue = new IndexedDBQueue({
    maxSize: config.offlineQueue?.maxSize || 10000,
  });

  // 创建中间件工厂
  const middlewareFactory = new ExpressMiddlewareFactory(
    supabaseAdapters.auth.provider,
    supabaseAdapters.auth.permissionChecker,
    supabaseAdapters.auth.tenantResolver,
    supabaseAdapters.cache.provider,
    supabaseAdapters.cache.keyBuilder
  );

  // 全局中间件
  app.use(middlewareFactory.correlationId());

  // 健康检查
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'device-api', timestamp: new Date().toISOString() });
  });

  // 设备注册/心跳（无需完整租户上下文）
  app.post('/devices/register', async (req: Request, res: Response) => {
    try {
      const { deviceCode, deviceType, firmwareVersion } = req.body;
      // 注册设备逻辑
      res.json({ success: true, deviceId: `dev-${Date.now()}` });
    } catch (error) {
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  app.post('/devices/heartbeat', async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.body;
      // 更新设备最后在线时间
      res.json({ success: true, serverTime: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: 'Heartbeat failed' });
    }
  });

  // 受保护路由：设备认证 + 租户解析
  const deviceRouter = express.Router();
  deviceRouter.use(middlewareFactory.authenticate());
  deviceRouter.use(middlewareFactory.resolveTenant());
  deviceRouter.use(middlewareFactory.injectRlsContext());

  // ===== 离线同步端点 =====

  // 批量上传离线操作
  deviceRouter.post('/sync/upload', async (req: Request, res: Response) => {
    try {
      const { operations } = req.body; // Array of { type, payload, timestamp }
      const userId = req.context!.user!.id;
      const tenantId = req.context!.tenantId!;

      const results = [];
      for (const op of operations) {
        try {
          let result;
          switch (op.type) {
            case 'work_order_action':
              result = await supabaseAdapters.repositories.workOrders.logAction(op.payload);
              break;
            case 'inventory_scan':
              result = await supabaseAdapters.rpc.inventoryAdjust.adjust({
                p_tenant_id: tenantId,
                p_sku: op.payload.sku,
                p_quantity: op.payload.qty,
                p_reason: 'device_scan',
              });
              break;
            case 'location_move':
              // 移库操作
              break;
            default:
              result = { success: false, error: 'Unknown operation type' };
          }
          results.push({ id: op.id, success: true, result });
        } catch (error) {
          results.push({ id: op.id, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: 'Sync upload failed' });
    }
  });

  // 下载同步数据（库存、工单、配置等）
  deviceRouter.get('/sync/download', async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const { lastSyncTime } = req.query;

      // 获取增量数据
      const [workOrders, inventory, config] = await Promise.all([
        supabaseAdapters.repositories.workOrders.findPendingDispatch(tenantId),
        supabaseAdapters.repositories.inventory.findAll({ filters: { tenant_id: tenantId } }),
        supabaseAdapters.repositories.tenants.findById(tenantId),
      ]);

      res.json({
        workOrders,
        inventory,
        config: config?.billing_strategy,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: 'Sync download failed' });
    }
  });

  // ===== 工单执行 =====
  deviceRouter.get('/work-orders/assigned', async (req: Request, res: Response) => {
    try {
      const userId = req.context!.user!.id;
      const workOrders = await supabaseAdapters.repositories.workOrders.findByAssignee(userId, 'dispatched');
      res.json({ data: workOrders });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch work orders' });
    }
  });

  deviceRouter.post('/work-orders/:id/start', async (req: Request, res: Response) => {
    try {
      const userId = req.context!.user!.id;
      await supabaseAdapters.repositories.workOrders.updateStatus(req.params.id, 'in_progress');
      await supabaseAdapters.repositories.workOrders.logAction({
        wo_id: req.params.id,
        action_type: 'start',
        qty_acted: 0,
        start_at: new Date().toISOString(),
        end_at: new Date().toISOString(),
      } as any);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start work order' });
    }
  });

  deviceRouter.post('/work-orders/:id/complete', async (req: Request, res: Response) => {
    try {
      const userId = req.context!.user!.id;
      const { actionType, fromLocId, toLocId, skuId, qtyActed, capturedData } = req.body;

      await supabaseAdapters.repositories.workOrders.updateStatus(req.params.id, 'completed');
      const log = await supabaseAdapters.repositories.workOrders.logAction({
        wo_id: req.params.id,
        action_type: actionType,
        from_loc_id: fromLocId,
        to_loc_id: toLocId,
        sku_id: skuId,
        qty_acted: qtyActed,
        captured_data: capturedData,
        start_at: req.body.startAt,
        end_at: new Date().toISOString(),
      } as any);

      res.json({ success: true, log });
    } catch (error) {
      res.status(500).json({ error: 'Failed to complete work order' });
    }
  });

  // ===== 扫码/库存操作 =====
  deviceRouter.post('/scan/inventory', async (req: Request, res: Response) => {
    try {
      const tenantId = req.context!.tenantId!;
      const { lpnCode, skuId, qty, action } = req.body; // action: 'putaway' | 'pick' | 'move'

      // 根据动作类型处理
      let result;
      if (action === 'putaway') {
        result = await supabaseAdapters.rpc.inventoryAdjust.adjust({
          p_tenant_id: tenantId,
          p_sku: skuId,
          p_quantity: qty,
          p_reason: 'putaway',
        });
      } else if (action === 'pick') {
        result = await supabaseAdapters.rpc.inventoryAdjust.adjust({
          p_tenant_id: tenantId,
          p_sku: skuId,
          p_quantity: -qty,
          p_reason: 'picking',
        });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ error: 'Scan operation failed' });
    }
  });

  // ===== 复核/打包/装车 =====
  deviceRouter.post('/verification/check', async (req: Request, res: Response) => {
    try {
      const { workOrderId, skuId, actualQty, actualWeight } = req.body;

      // 重量校验
      const verification = await supabaseAdapters.rpc.weightVerification.verify({
        p_sku_id: skuId,
        p_actual_weight: actualWeight,
      });

      res.json({ passed: verification.passed, details: verification });
    } catch (error) {
      res.status(500).json({ error: 'Verification failed' });
    }
  });

  app.use('/api/device', deviceRouter);

  // 错误处理
  app.use(middlewareFactory.errorHandler());

  return app;
}

export async function startDeviceApiServer(config: DeviceApiConfig, port: number = 3003): Promise<void> {
  const app = await createDeviceApiApp(config);
  app.listen(port, () => {
    console.log(`Device API server running on port ${port}`);
  });
}