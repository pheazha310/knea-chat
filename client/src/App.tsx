import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore, registerWsListeners } from './store';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import Login from './views/Login';
import ForgotPassword from './views/ForgotPassword';
import ResetPassword from './views/ResetPassword';
import Dashboard from './views/Dashboard';
import Profile from './views/Profile';
import Admin from './views/Admin';
import SuperAdmin from './views/SuperAdmin';
import Manager from './views/Manager';
import './animations.css';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

const AdminRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Company admins run the workspace console; super admins inherit it too.
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
  // Managers run the team console; admins & super admins inherit it.
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
    // Restore the session (token + user) from localStorage and connect the
    // WebSocket, then wire real-time events to the Zustand stores.
    // The WebSocket client clears its listeners on disconnect (logout), so
    // re-register the wiring whenever the auth state flips.
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
