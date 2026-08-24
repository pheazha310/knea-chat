// authStore — Zustand store for authentication.
//
// Owns the current user, the JWT token, the authentication status and the
// login / register / logout / restore flows. Replaces the old AuthContext:
// components read auth state from this store and auth actions persist to
// localStorage and manage the WebSocket connection.
import { create } from 'zustand';
import { AuthModel } from '../models';
import type { User } from '../models';
import { wsService } from '../services/websocket';
import { useChatStore } from './chatStore';
import { useUserStore } from './userStore';
import { useNotificationStore } from './notificationStore';
import { useCompanyStore } from './companyStore';
import { useCallStore } from './callStore';
import { getErrorMessage } from './utils';

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (credentials: { email: string; password: string }) => Promise<AuthResult>;
  register: (account: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) => Promise<AuthResult>;
  logout: () => void;
  /** Restore auth state + WebSocket connection from localStorage on app boot. */
  restore: () => void;
  /** Replace the current user (profile edits, avatar updates). */
  setUser: (user: User) => void;
  clearError: () => void;
}

const TOKEN_KEY = 'kneachat_token';
const USER_KEY = 'kneachat_user';

const readStoredUser = (): User | null => {
  try {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? (JSON.parse(stored) as User) : null;
  } catch {
    return null;
  }
};

const persist = (token: string, user: User) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: readStoredUser(),
  token: localStorage.getItem(TOKEN_KEY),
  loading: false,
  error: null,
  isAuthenticated: !!localStorage.getItem(TOKEN_KEY),

  login: async (credentials) => {
    set({ loading: true, error: null });
    try {
      const response = await AuthModel.login(credentials);
      const { token, user } = response.data.data;
      persist(token, user);
      set({ token, user, isAuthenticated: true, loading: false });
      wsService.connect(token);
      return { success: true, user };
    } catch (err) {
      const message = getErrorMessage(err, 'Login failed. Please check your credentials.');
      set({ error: message, loading: false });
      return { success: false, error: message };
    }
  },

  register: async (account) => {
    set({ loading: true, error: null });
    try {
      const response = await AuthModel.register(account);
      const { token, user } = response.data.data;
      persist(token, user);
      set({ token, user, isAuthenticated: true, loading: false });
      wsService.connect(token);
      return { success: true, user };
    } catch (err) {
      const message = getErrorMessage(err, 'Could not create your account.');
      set({ error: message, loading: false });
      return { success: false, error: message };
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    wsService.disconnect();
    // Wipe all shared application state so the next sign-in starts clean.
    useChatStore.getState().clear();
    useUserStore.getState().clear();
    useNotificationStore.getState().clear();
    useCompanyStore.getState().clear();
    useCallStore.getState().clear();
    set({ user: null, token: null, isAuthenticated: false, error: null });
  },

  restore: () => {
    const { token, user } = get();
    if (token && user) {
      wsService.connect(token);
    }
  },

  setUser: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },

  clearError: () => set({ error: null }),
}));
