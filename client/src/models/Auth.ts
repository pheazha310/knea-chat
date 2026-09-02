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
};
