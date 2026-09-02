// userStore — Zustand store for people.
//
// Owns the workspace user list, online/presence state, user search results
// and profile (avatar) updates. WebSocket presence/profile events write here
// (see wsListeners.ts); views read `users` and `onlineUsers`.
import { create } from 'zustand';
import { UserModel } from '../models';
import type { PresenceStatus, User } from '../models';
import { getErrorMessage } from './utils';

interface UserState {
  users: User[];
  onlineUsers: Set<number>;
  searchResults: User[];
  loading: boolean;
  error: string | null;
  fetchUsers: () => Promise<void>;
  searchUsers: (query: string) => Promise<void>;
  setUsers: (users: User[]) => void;
  /** Mark a user online/offline (updates `onlineUsers` + their status). */
  setOnline: (userId: number, isOnline: boolean) => void;
  setUserStatus: (userId: number, status: PresenceStatus) => void;
  setUserProfile: (userId: number, profilePicture: string | null) => void;
  clear: () => void;
}

export const useUserStore = create<UserState>()((set) => ({
  users: [],
  onlineUsers: new Set(),
  searchResults: [],
  loading: false,
  error: null,

  fetchUsers: async () => {
    set({ loading: true, error: null });
    try {
      const res = await UserModel.getAll();
      set({ users: res.data.data?.users || [], loading: false });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load users'), loading: false });
    }
  },

  searchUsers: async (query) => {
    try {
      const res = await UserModel.search(query);
      set({ searchResults: res.data.data?.results || [] });
    } catch (err) {
      set({ error: getErrorMessage(err, 'User search failed') });
    }
  },

  setUsers: (users) => set({ users }),

  setOnline: (userId, isOnline) =>
    set((state) => {
      const onlineUsers = new Set(state.onlineUsers);
      if (isOnline) onlineUsers.add(userId);
      else onlineUsers.delete(userId);
      const status: PresenceStatus = isOnline ? 'online' : 'offline';
      return {
        onlineUsers,
        users: state.users.map((u) => (u.id === userId ? { ...u, status } : u)),
      };
    }),

  setUserStatus: (userId, status) =>
    set((state) => ({
      users: state.users.map((u) => (u.id === userId ? { ...u, status } : u)),
    })),

  setUserProfile: (userId, profilePicture) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.id === userId ? { ...u, profile_picture: profilePicture } : u,
      ),
    })),

  clear: () => set({ users: [], onlineUsers: new Set(), searchResults: [] }),
}));
