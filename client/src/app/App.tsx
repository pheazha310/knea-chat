import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '../entities/auth/model';
import { registerWsListeners } from './stores';
import { ThemeProvider } from './providers/ThemeProvider';
import { ToastProvider } from './providers/ToastProvider';
import { ROUTES, AppRoute } from './routes';
import Login from '../pages/auth/ui/LoginPage';
import ForgotPassword from '../pages/auth/ui/ForgotPasswordPage';
import ResetPassword from '../pages/auth/ui/ResetPasswordPage';
import Dashboard from '../pages/dashboard/ui/DashboardPage';
import Profile from '../pages/profile/ui/ProfilePage';
import Admin from '../pages/admin/ui/AdminPage';
import SuperAdmin from '../pages/super-admin/ui/SuperAdminPage';
import Manager from '../pages/manager/ui/ManagerPage';
import './styles/animations.css';

const routeElementMap: Record<string, React.ReactNode> = {
  Login: <Login />,
  ForgotPassword: <ForgotPassword />,
  ResetPassword: <ResetPassword />,
  Dashboard: <Dashboard />,
  Profile: <Profile />,
  Admin: <Admin />,
  SuperAdmin: <SuperAdmin />,
  Manager: <Manager />,
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

const RoleRoute = ({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role && allowedRoles.includes(role)) return <>{children}</>;
  return <Navigate to="/dashboard" replace />;
};

const AppRoutes = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const entries = Object.entries(ROUTES) as [AppRoute, (typeof ROUTES)[AppRoute]][];

  return (
    <Routes>
      {entries.map(([path, config]) => {
        const element = routeElementMap[config.element];
        if (path === '/login' || path === '/forgot-password' || path === '/reset-password') {
          return (
            <Route
              key={path}
              path={path}
              element={isAuthenticated ? <Navigate to="/dashboard" replace /> : element}
            />
          );
        }
        if (config.allowedRoles) {
          return (
            <Route
              key={path}
              path={path}
              element={<RoleRoute allowedRoles={config.allowedRoles}>{element}</RoleRoute>}
            />
          );
        }
        return (
          <Route
            key={path}
            path={path}
            element={<ProtectedRoute>{element}</ProtectedRoute>}
          />
        );
      })}
      <Route path="/" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  useEffect(() => {
    let unregister = registerWsListeners();
    useAuthStore.getState().restore();
    const unsubscribeAuth = useAuthStore.subscribe((state, prevState) => {
      if (state.isAuthenticated !== prevState.isAuthenticated) {
        unregister();
        unregister = registerWsListeners();
      }
    });
    return () => {
      unsubscribeAuth();
      unregister();
    };
  }, []);

  return (
    <ThemeProvider>
      <ToastProvider>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </Router>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
