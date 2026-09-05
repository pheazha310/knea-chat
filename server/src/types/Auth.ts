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
  /**
   * Random per-issuance claim — makes each login's JWT (and therefore its
   * session token_hash) unique, so concurrent sign-ins of the same user get
   * distinct tokens and "current session" lookups stay unambiguous.
   */
  jti?: string;
}

export interface LoginResult {
  user: Record<string, unknown>;
  token: string;
  expiresIn: string;
}
