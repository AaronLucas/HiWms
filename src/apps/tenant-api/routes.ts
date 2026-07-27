/**
 * Tenant API 业务路由
 * 端点将在后续任务中按域（订单/库存/商品/波次）逐步补充
 */
import express, { Router } from 'express';
import { TenantApiDependencies } from './di';

export function createTenantApiRouter(_deps: TenantApiDependencies): Router {
  const router = express.Router();
  return router;
}
