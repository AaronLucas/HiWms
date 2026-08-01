/**
 * 统一 CORS 配置实现——供有浏览器前端会直接调用的 Express App 使用
 * （tenant-api、admin-api；device-api 是 PDA/扫码枪原生 HTTP 调用，不经过浏览器，
 * CORS 是浏览器侧的同源限制机制，对它没有意义，不接入）。
 *
 * 逻辑共享，配置按 App 独立：tenant-api 和 admin-api 是两个不同的信任边界（租户
 * 前端 vs 平台管理后台，通常部署在不同域名，权限级别也不同），各自的允许来源
 * 列表必须能独立配置——共用一份列表会导致改一个 App 的允许域名时，另一个权限
 * 更高的 App 被连带放开，不必要地扩大攻击面。调用方各自传入自己的环境变量名。
 *
 * 生产环境（NODE_ENV=production）未显式配置对应环境变量时不放行任何跨域来源
 * （fail closed），避免"忘了配就等于放开所有域名"这种更危险的默认值；
 * 非生产环境给一组本地开发常用端口做默认值，方便本地起前端联调。
 */
import cors, { type CorsOptions } from 'cors';

function resolveAllowedOrigins(envVarName: string): string[] {
  const raw = process.env[envVarName]?.trim();
  if (raw) {
    return raw.split(',').map(o => o.trim()).filter(Boolean);
  }
  if (process.env.NODE_ENV === 'production') {
    return [];
  }
  return [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];
}

/** @param envVarName 本 App 专属的允许来源环境变量名（如 `TENANT_API_ALLOWED_ORIGINS`） */
export function createCorsMiddleware(envVarName: string) {
  const allowedOrigins = resolveAllowedOrigins(envVarName);

  const options: CorsOptions = {
    origin(origin, callback) {
      // 无 Origin header：同源请求、服务端到服务端调用、curl/Postman——放行
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS: origin "${origin}" not in ${envVarName}`));
    },
    credentials: true,
  };

  return cors(options);
}
