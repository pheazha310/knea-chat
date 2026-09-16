import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '../entities/auth/model';
import { registerWsListeners } from '../entities/store';
import { ThemeProvider } from './providers/ThemeProvider';
import { ToastProvider } from './providers/ToastProvider';
import Login from '../pages/auth/ui/LoginPage';
import ForgotPassword from '../pages/auth/ui/ForgotPasswordPage';
import ResetPassword from '../pages/auth/ui/ResetPasswordPage';
import Dashboard from '../pages/dashboard/ui/DashboardPage';
import Profile from '../pages/profile/ui/ProfilePage';
import Admin from '../pages/admin/ui/AdminPage';
import SuperAdmin from '../pages/super-admin/ui/SuperAdminPage';
import Manager from '../pages/manager/ui/ManagerPage';
import './styles/animations.css';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

const AdminRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role !== 'admin' && role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

const SuperAdminRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role !== 'super_admin') return <Navigate to="/dashboard" replace />;
  return children;
};

const ManagerRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role !== 'manager' && role !== 'admin' && role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

const AppRoutes = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/forgot-password" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <ForgotPassword />} />
      <Route path="/reset-password" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <ResetPassword />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
      <Route path="/platform" element={<SuperAdminRoute><SuperAdmin /></SuperAdminRoute>} />
      <Route path="/manage" element={<ManagerRoute><Manager /></ManagerRoute>} />
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
