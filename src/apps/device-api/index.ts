/**
 * Device API 导出
 */
export { loadDeviceApiConfig, type DeviceApiConfig } from './config';
export { createDeviceApiDependencies, type DeviceApiDependencies } from './di';
export { createDeviceApiRouter } from './routes';
export { createDeviceApiApp, startDeviceApiServer } from './main';
export { createDeviceAuthMiddleware, type DeviceAuthConfig } from './DeviceAuthMiddleware';
export { type ExpressRequestContext } from '../../adapters/express/ExpressMiddlewareFactory';
export {
  // Schemas
  uuidSchema,
  isoDateTimeSchema,
  positiveIntSchema,
  nonNegativeIntSchema,
  syncEventSchema,
  syncEventsRequestSchema,
  syncPullQuerySchema,
  syncPolicyQuerySchema,
  taskClaimRequestSchema,
  taskClaimParamsSchema,
  taskClaimReleaseParamsSchema,
  exceptionStatusSchema,
  exceptionDomainSchema,
  exceptionSeveritySchema,
  exceptionsQuerySchema,
  exceptionParamsSchema,
  // Types
  type SyncEventRequest,
  type SyncEventsRequest,
  type SyncPullQuery,
  type SyncPolicyQuery,
  type TaskClaimRequest,
  type TaskClaimParams,
  type TaskClaimReleaseParams,
  type ExceptionsQuery,
  type ExceptionParams,
  // Middleware
  validateBody,
  validateQuery,
  validateParams,
  validateRequest,
} from './validation';