export type AppRoute =
  | '/login'
  | '/forgot-password'
  | '/reset-password'
  | '/dashboard'
  | '/profile'
  | '/admin'
  | '/platform'
  | '/manage';

export const ROUTES: Record<AppRoute, { element: string; requiresAuth: boolean; allowedRoles?: string[] }> = {
  '/login': { element: 'Login', requiresAuth: false },
  '/forgot-password': { element: 'ForgotPassword', requiresAuth: false },
  '/reset-password': { element: 'ResetPassword', requiresAuth: false },
  '/dashboard': { element: 'Dashboard', requiresAuth: true },
  '/profile': { element: 'Profile', requiresAuth: true },
  '/admin': { element: 'Admin', requiresAuth: true, allowedRoles: ['admin', 'super_admin'] },
  '/platform': { element: 'SuperAdmin', requiresAuth: true, allowedRoles: ['super_admin'] },
  '/manage': { element: 'Manager', requiresAuth: true, allowedRoles: ['manager', 'admin', 'super_admin'] },
};

export const PUBLIC_ROUTES: AppRoute[] = ['/login', '/forgot-password', '/reset-password'];
export const PROTECTED_ROUTES: AppRoute[] = ['/dashboard', '/profile', '/admin', '/platform', '/manage'];
