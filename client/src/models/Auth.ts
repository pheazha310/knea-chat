// Auth domain model — MVVM Model layer.
// Holds the `AuthResponse` entity plus `AuthModel`, the data access for the
// /auth endpoints.
import api from '../services/api';
import type { User } from './User';

export interface AuthResponse {
  token: string;
  expiresIn: string;
  user: User;
}

/** One row of the user's login history (device, IP, times, status). */
export interface LoginSession {
  id: number;
  device_info: string | null;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  logged_out_at: string | null;
  status: 'active' | 'expired' | 'logged_out';
}

export const AuthModel = {
  login: (credentials: { email: string; password: string }) =>
    api.post<{ success: boolean; message: string; data: AuthResponse }>(
      '/auth/login',
      credentials,
    ),
  register: (account: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) =>
    api.post<{ success: boolean; message: string; data: AuthResponse }>(
      '/auth/register',
      account,
    ),
  logout: () => api.post<{ success: boolean; message: string }>('/auth/logout'),
  me: () =>
    api.get<{ success: boolean; message: string; data: { user: User } }>(
      '/auth/me',
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ success: boolean; message: string }>('/auth/change-password', {
      currentPassword,
      newPassword,
    }),
  forgotPassword: (email: string) =>
    api.post<{
      success: boolean;
      message: string;
      data?: { resetToken?: string };
    }>('/auth/forgot-password', {
      email,
    }),
  resetPassword: (token: string, newPassword: string) =>
    api.post<{ success: boolean; message: string }>('/auth/reset-password', {
      token,
      newPassword,
      confirmPassword: newPassword,
    }),
  getSessions: () =>
    api.get<{ success: boolean; message: string; data: { sessions: LoginSession[] } }>(
      '/auth/sessions',
    ),
  revokeOtherSessions: () =>
    api.post<{ success: boolean; message: string; data: { revoked: number } }>(
      '/auth/sessions/revoke-others',
    ),
};
