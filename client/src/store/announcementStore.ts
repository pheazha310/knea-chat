// announcementStore — Zustand store for announcements (SRS FR-24).
//
// Owns the announcements list and the commands that mutate it (load, publish,
// edit, delete, mark-read). Real-time `announcement_*` events from the
// WebSocket client are dispatched here by wsListeners.ts, so the
// Announcements view updates automatically when a manager publishes.
import { create } from 'zustand';
import { AnnouncementModel } from '../models';
import type { Announcement, AnnouncementReader, CreateAnnouncementData, Reaction } from '../models';
import { useAuthStore } from './authStore';
import { getErrorMessage } from './utils';

/** Announcement reactions with an in-flight toggle request (guards double-clicks). */
const reactionInFlight = new Set<string>();

interface AnnouncementState {
  announcements: Announcement[];
  loading: boolean;
  error: string | null;
  setAnnouncements: (announcements: Announcement[]) => void;
  /** Insert or replace an announcement (used by WS events + create/update). */
  addAnnouncement: (announcement: Announcement) => void;
  removeAnnouncement: (id: number) => void;
  load: () => Promise<void>;
  createAnnouncement: (data: CreateAnnouncementData) => Promise<Announcement | undefined>;
  updateAnnouncement: (
    id: number,
    data: Partial<CreateAnnouncementData>,
  ) => Promise<Announcement | undefined>;
  deleteAnnouncement: (id: number) => Promise<void>;
  /** Mark an announcement as read by the current user (idempotent). */
  markRead: (id: number) => Promise<Announcement | undefined>;
  /** Read-confirmation ledger for one announcement (manager+). */
  loadReaders: (id: number) => Promise<{
    readers: AnnouncementReader[];
    total_recipients: number;
  }>;
  /** Replace the reaction list on a cached announcement (live broadcasts). */
  applyReactions: (id: number, reactions: Reaction[]) => void;
  /** Add or remove the current user's emoji on an announcement. Resolves with
   *  the fresh reaction list (null on failure). */
  toggleReaction: (
    id: number,
    reaction: string,
    knownMine?: boolean,
  ) => Promise<Reaction[] | null>;
  clear: () => void;
}

export const useAnnouncementStore = create<AnnouncementState>()((set, get) => ({
  announcements: [],
  loading: false,
  error: null,

  setAnnouncements: (announcements) => set({ announcements }),

  addAnnouncement: (announcement) =>
    set((state) => {
      const existing = state.announcements.some((a) => a.id === announcement.id);
      const next = existing
        ? state.announcements.map((a) => (a.id === announcement.id ? announcement : a))
        : [announcement, ...state.announcements];
      return { announcements: next };
    }),

  removeAnnouncement: (id) =>
    set((state) => ({
      announcements: state.announcements.filter((a) => a.id !== id),
    })),

  applyReactions: (id, reactions) =>
    set((state) => ({
      announcements: state.announcements.map((a) =>
        a.id === id ? { ...a, reactions } : a,
      ),
    })),

  toggleReaction: async (id, reaction, knownMine) => {
    const key = `${id}:${reaction}`;
    if (reactionInFlight.has(key)) return null;
    reactionInFlight.add(key);
    try {
      const current = get().announcements.find((a) => a.id === id);
      const userId = useAuthStore.getState().user?.id ?? null;
      const cachedMine =
        current?.reactions?.some(
          (r) => userId !== null && Number(r.user_id) === Number(userId) && r.reaction === reaction,
        ) ?? false;
      const mine = current ? cachedMine : (knownMine ?? false);
      const res = mine
        ? await AnnouncementModel.removeReaction(id, reaction)
        : await AnnouncementModel.addReaction(id, reaction);
      const reactions: Reaction[] = res.data?.data?.reactions || [];
      get().applyReactions(id, reactions);
      return reactions;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Failed to toggle reaction') });
      return null;
    } finally {
      reactionInFlight.delete(key);
    }
  },

  load: async () => {
    set({ loading: true, error: null });
    try {
      const res = await AnnouncementModel.getAll();
      set({ announcements: res.data.data?.announcements || [], loading: false });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load announcements'), loading: false });
    }
  },

  createAnnouncement: async (data) => {
    try {
      const res = await AnnouncementModel.create(data);
      const announcement = res.data?.data?.announcement;
      if (announcement) get().addAnnouncement(announcement);
      return announcement;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not publish announcement') });
      throw err;
    }
  },

  updateAnnouncement: async (id, data) => {
    try {
      const res = await AnnouncementModel.update(id, data);
      const announcement = res.data?.data?.announcement;
      if (announcement) get().addAnnouncement(announcement);
      return announcement;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not update announcement') });
      throw err;
    }
  },

  deleteAnnouncement: async (id) => {
    try {
      await AnnouncementModel.remove(id);
      get().removeAnnouncement(id);
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not delete announcement') });
      throw err;
    }
  },

  markRead: async (id) => {
    try {
      const res = await AnnouncementModel.markRead(id);
      const announcement = res.data?.data?.announcement;
      if (announcement) get().addAnnouncement(announcement);
      return announcement;
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not mark announcement as read') });
      throw err;
    }
  },

  loadReaders: async (id) => {
    const res = await AnnouncementModel.getReads(id);
    return {
      readers: res.data?.data?.readers || [],
      total_recipients: res.data?.data?.total_recipients || 0,
    };
  },

  clear: () => set({ announcements: [], loading: false, error: null }),
}));