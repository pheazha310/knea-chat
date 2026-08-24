/** Auth types — the JWT payload and the authenticated-user shape on req.user. */

export type Role = 'super_admin' | 'admin' | 'manager' | 'employee';

export interface AuthUser {
  id: number;
  email: string;
  role: string;
  companyId: number;
}

export interface JwtPayload {
  id: number;
  email: string;
  role: string;
  companyId: number;
}

export interface LoginResult {
  user: Record<string, unknown>;
  token: string;
  expiresIn: string;
}
