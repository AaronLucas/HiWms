import { ElMessage } from "element-plus";
import { useAuth } from "@/composables/useAuth";

const auth = useAuth();

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(endpoint: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }
  return url.toString();
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, headers = {}, ...fetchOptions } = options;

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers as Record<string, string>,
  };

  if (auth.accessToken.value) {
    requestHeaders.Authorization = `Bearer ${auth.accessToken.value}`;
  }

  if (auth.tenantId.value) {
    requestHeaders["X-Tenant-ID"] = auth.tenantId.value;
  }

  let response = await fetch(buildUrl(endpoint, params), {
    ...fetchOptions,
    headers: requestHeaders,
  });

  if (response.status === 401 && auth.refreshToken.value) {
    const refreshed = await auth.refreshAccessToken();
    if (refreshed) {
      requestHeaders.Authorization = `Bearer ${auth.accessToken.value}`;
      response = await fetch(buildUrl(endpoint, params), {
        ...fetchOptions,
        headers: requestHeaders,
      });
    } else {
      auth.logout();
      throw new Error("会话已过期，请重新登录");
    }
  }

  if (!response.ok) {
    let errorMessage = "请求失败";
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
    } catch {
      errorMessage = `HTTP ${response.status}`;
    }

    ElMessage.error(errorMessage);

    if (response.status === 403) {
      ElMessage.error("权限不足");
    } else if (response.status === 404) {
      ElMessage.error("资源不存在");
    } else if (response.status >= 500) {
      ElMessage.error("服务器错误，请稍后重试");
    }

    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export const api = {
  get<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return request<T>(endpoint, { method: "GET", params });
  },

  post<T>(endpoint: string, data?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
      params,
    });
  },

  put<T>(endpoint: string, data?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
      params,
    });
  },

  patch<T>(endpoint: string, data?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return request<T>(endpoint, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
      params,
    });
  },

  delete<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return request<T>(endpoint, { method: "DELETE", params });
  },
};

export const ENDPOINTS = {
  AUTH_LOGIN: "/api/auth/login",
  AUTH_REFRESH: "/api/auth/refresh",
  AUTH_LOGOUT: "/api/auth/logout",
  AUTH_CHANGE_PASSWORD: "/api/users/me/password",
  DASHBOARD_STATS: "/api/dashboard/stats",
  MATERIALS_LIST: "/api/products",
  MATERIALS_GET: (id: string) => `/api/products/${id}`,
  MATERIALS_CREATE: "/api/products",
  MATERIALS_UPDATE: (id: string) => `/api/products/${id}`,
  MATERIALS_DELETE: (id: string) => `/api/products/${id}`,
  MATERIALS_BARCODES: (id: string) => `/api/products/${id}/barcodes`,
  MATERIALS_BARCODE_CREATE: (id: string) => `/api/products/${id}/barcodes`,
  MATERIALS_BARCODE_DELETE: (id: string, barcodeId: string) => `/api/products/${id}/barcodes/${barcodeId}`,
  MATERIALS_CONSTRAINTS: (id: string) => `/api/products/${id}/constraints`,
  MATERIALS_CONSTRAINT_CREATE: (id: string) => `/api/products/${id}/constraints`,
  MATERIALS_CONSTRAINT_DELETE: (id: string, constraintId: string) => `/api/products/${id}/constraints/${constraintId}`,
  MATERIALS_ABC_UPDATE: (id: string) => `/api/products/${id}/abc-class`,
  INVENTORY_LIST: "/api/inventory",
  INVENTORY_GET: (id: string) => `/api/inventory/${id}`,
  INVENTORY_ADJUST: "/api/inventory/adjust",
  INVENTORY_TRANSFER: "/api/inventory/transfer",
  INVENTORY_RESERVE: "/api/inventory/reserve",
  INVENTORY_RELEASE: "/api/inventory/release-reservation",
  INVENTORY_LOCK: "/api/inventory/lock",
  INVENTORY_UNLOCK: "/api/inventory/unlock",
  INVENTORY_HISTORY: "/api/inventory/history",
  INVENTORY_AVAILABLE: "/api/inventory/available",
  LOCATIONS_LIST: "/api/locations",
  LOCATIONS_GET: (id: string) => `/api/locations/${id}`,
  LOCATIONS_CREATE: "/api/locations",
  LOCATIONS_UPDATE: (id: string) => `/api/locations/${id}`,
  LOCATIONS_STATUS: (id: string) => `/api/locations/${id}/status`,
  LOCATIONS_CAPACITY: (id: string) => `/api/locations/${id}/capacity`,
  LOCATIONS_UTILIZATION: "/api/locations/utilization",
  ORDERS_LIST: "/api/orders",
  ORDERS_GET: (id: string) => `/api/orders/${id}`,
  ORDERS_CREATE: "/api/orders",
  ORDERS_ALLOCATE: (id: string) => `/api/orders/${id}/allocate`,
  ORDERS_STATUS: (id: string) => `/api/orders/${id}/status`,
  WAVES_LIST: "/api/waves",
  WAVES_GET: (id: string) => `/api/waves/${id}`,
  WAVES_GENERATE: "/api/waves/generate",
  WAVES_STATUS: (id: string) => `/api/waves/${id}/status`,
  WAVES_RELEASE: (id: string) => `/api/waves/${id}/release`,
  WAVES_ADD_ORDERS: (id: string) => `/api/waves/${id}/orders`,
  WAVES_REMOVE_ORDER: (id: string, orderId: string) => `/api/waves/${id}/orders/${orderId}`,
  WORK_ORDERS_LIST: "/api/work-orders",
  WORK_ORDERS_GET: (id: string) => `/api/work-orders/${id}`,
  WORK_ORDERS_CREATE: "/api/work-orders",
  WORK_ORDERS_STATUS: (id: string) => `/api/work-orders/${id}/status`,
  WORK_ORDERS_ASSIGN: (id: string) => `/api/work-orders/${id}/assign`,
  WORK_ORDERS_LOGS: (id: string) => `/api/work-orders/${id}/logs`,
  SHIPPING_LIST: "/api/shipping-documents",
  SHIPPING_GET: (id: string) => `/api/shipping-documents/${id}`,
  SHIPPING_CREATE: "/api/shipping-documents",
  SHIPPING_HANDOVER: (id: string) => `/api/shipping-documents/${id}/handover`,
  VEHICLES_LIST: "/api/vehicles",
  VEHICLES_CREATE: "/api/vehicles",
  ASN_LIST: "/api/asn",
  ASN_GET: (id: string) => `/api/asn/${id}`,
  ASN_CREATE: "/api/asn",
  INBOUND_LIST: "/api/inbound-receipts",
  INBOUND_GET: (id: string) => `/api/inbound-receipts/${id}`,
  INBOUND_CREATE: "/api/inbound-receipts",
  INBOUND_STATUS: (id: string) => `/api/inbound-receipts/${id}/status`,
  INBOUND_RECEIVE: (id: string) => `/api/inbound-receipts/${id}/receive`,
  INBOUND_PUTAWAY: (id: string) => `/api/inbound-receipts/${id}/putaway`,
  QUALITY_LIST: "/api/quality-inspections",
  QUALITY_GET: (id: string) => `/api/quality-inspections/${id}`,
  QUALITY_CREATE: "/api/quality-inspections",
  QUALITY_ITEMS: (id: string) => `/api/quality-inspections/${id}/items`,
  CONTAINERS_LIST: "/api/containers",
  CONTAINERS_GET: (id: string) => `/api/containers/${id}`,
  CONTAINERS_CREATE: "/api/containers",
  CONTAINERS_UPDATE: (id: string) => `/api/containers/${id}`,
  CONTAINERS_SEAL: (id: string) => `/api/containers/${id}/seal`,
  CONTAINERS_MOVE: (id: string) => `/api/containers/${id}/move`,
  CONTAINERS_CONTENTS: (id: string) => `/api/containers/${id}/contents`,
  CONTAINERS_HIERARCHY: (id: string) => `/api/containers/${id}/hierarchy`,
  CONTAINERS_LPN: (lpnCode: string) => `/api/containers/lpn/${lpnCode}`,
  CONTAINERS_UTILIZATION: "/api/containers/utilization",
} as const;

export default api;
