export interface User {
  id: string;
  email: string;
  full_name?: string;
  role?: string;
  tenant_id?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
  tenantId: string;
}

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
}
