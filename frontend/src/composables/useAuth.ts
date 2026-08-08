import { ref, computed } from "vue";
import { useRouter } from "vue-router";

const TOKEN_KEY = "hiwms_access_token";
const REFRESH_KEY = "hiwms_refresh_token";
const TENANT_KEY = "hiwms_tenant_id";
const USER_KEY = "hiwms_user";

export function useAuth() {
  const router = useRouter();
  const isAuthenticated = ref(false);
  const user = ref<User | null>(null);
  const accessToken = ref<string | null>(null);
  const refreshToken = ref<string | null>(null);
  const tenantId = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isTokenExpired = computed(() => {
    if (!accessToken.value) return true;
    try {
      const payload = JSON.parse(atob(accessToken.value.split(".")[1]));
      return payload.exp * 1000 < Date.now();
    } catch {
      return true;
    }
  });

  function loadFromStorage() {
    const storedAccess = localStorage.getItem(TOKEN_KEY);
    const storedRefresh = localStorage.getItem(REFRESH_KEY);
    const storedTenant = localStorage.getItem(TENANT_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (storedAccess && storedRefresh) {
      accessToken.value = storedAccess;
      refreshToken.value = storedRefresh;
      tenantId.value = storedTenant;
      if (storedUser) {
        try {
          user.value = JSON.parse(storedUser);
        } catch {
          user.value = null;
        }
      }
      isAuthenticated.value = true;
    }
  }

  function saveToStorage(tokens: AuthTokens, userData: User, tenant: string) {
    accessToken.value = tokens.access_token;
    refreshToken.value = tokens.refresh_token;
    tenantId.value = tenant;
    user.value = userData;

    localStorage.setItem(TOKEN_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
    localStorage.setItem(TENANT_KEY, tenant);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));

    isAuthenticated.value = true;
  }

  function clearStorage() {
    accessToken.value = null;
    refreshToken.value = null;
    tenantId.value = null;
    user.value = null;
    isAuthenticated.value = false;

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function login(credentials: LoginCredentials): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:8787"}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(credentials),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "登录失败");
      }

      const data = await response.json();
      saveToStorage(data.tokens, data.user, credentials.tenantId);
      return true;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "登录失败";
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function refreshAccessToken(): Promise<boolean> {
    if (!refreshToken.value) return false;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:8787"}/api/auth/refresh`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${refreshToken.value}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Token 刷新失败");
      }

      const data = await response.json();
      accessToken.value = data.access_token;
      localStorage.setItem(TOKEN_KEY, data.access_token);
      return true;
    } catch {
      logout();
      return false;
    }
  }

  async function logout(): Promise<void> {
    if (accessToken.value) {
      try {
        await fetch(
          `${import.meta.env.VITE_API_BASE_URL || "http://localhost:8787"}/api/auth/logout`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken.value}`,
            },
          }
        );
      } catch {
        // 忽略登出错误
      }
    }
    clearStorage();
    router.push("/login");
  }

  async function changePassword(newPassword: string): Promise<boolean> {
    if (!accessToken.value) return false;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:8787"}/api/users/me/password`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken.value}`,
          },
          body: JSON.stringify({ newPassword }),
        }
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    isAuthenticated,
    user,
    accessToken,
    refreshToken,
    tenantId,
    loading,
    error,
    isTokenExpired,
    login,
    logout,
    refreshAccessToken,
    changePassword,
    loadFromStorage,
  };
}

import type { User } from "@/types/auth";
import type { AuthTokens, LoginCredentials } from "@/types/auth";
