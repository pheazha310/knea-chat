// notificationPreferenceStore — Zustand store for the user's notification
// preferences (opt-out toggles per category).
import { create } from 'zustand';
import { NotificationPreferenceModel } from '../models';
import type { NotificationPreference } from '../models';

interface NotificationPreferenceState {
  preferences: NotificationPreference[];
  isLoading: boolean;
  error: string | null;

  setPreferences: (preferences: NotificationPreference[]) => void;
  setError: (error: string | null) => void;
  load: () => Promise<void>;
  /** Toggle one category; updates state optimistically, reverts on failure. */
  setCategory: (category: string, enabled: boolean) => Promise<boolean>;
  clear: () => void;
}

export const useNotificationPreferenceStore = create<NotificationPreferenceState>()((set, get) => ({
  preferences: [],
  isLoading: false,
  error: null,

  setPreferences: (preferences) => set({ preferences }),
  setError: (error) => set({ error }),

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await NotificationPreferenceModel.getAll();
      const preferences = response.data.data?.preferences || [];
      set({ preferences, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  setCategory: async (category, enabled) => {
    const previous = get().preferences;
    set({
      preferences: previous.map((p) => (p.category === category ? { ...p, enabled } : p)),
      error: null,
    });
    try {
      await NotificationPreferenceModel.set(category, enabled);
      return true;
    } catch (error) {
      // Revert on failure so the toggle reflects what the server accepted.
      set({ preferences: previous, error: (error as Error).message });
      return false;
    }
  },

  clear: () => set({ preferences: [], isLoading: false, error: null }),
}));
