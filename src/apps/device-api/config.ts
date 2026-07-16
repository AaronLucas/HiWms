/**
 * Device API 配置
 * PDA/手持终端端 API 服务
 */
export interface DeviceApiConfig {
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
  server: {
    port: number;
    host: string;
  };
  device: {
    // 设备认证相关
    jwtSecret: string;
    jwtIssuer: string;
    jwtAudience: string;
  };
}

export function loadDeviceApiConfig(): DeviceApiConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const port = parseInt(process.env.DEVICE_API_PORT || '3003', 10);
  const host = process.env.DEVICE_API_HOST || '0.0.0.0';
  const jwtSecret = process.env.DEVICE_JWT_SECRET || '';
  const jwtIssuer = process.env.DEVICE_JWT_ISSUER || 'wms7-device-api';
  const jwtAudience = process.env.DEVICE_JWT_AUDIENCE || 'wms7-devices';

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error('Missing required Supabase environment variables');
  }
  if (!jwtSecret) {
    throw new Error('Missing DEVICE_JWT_SECRET environment variable');
  }

  return {
    supabase: {
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
      serviceRoleKey: supabaseServiceRoleKey,
    },
    server: { port, host },
    device: { jwtSecret, jwtIssuer, jwtAudience },
  };
}