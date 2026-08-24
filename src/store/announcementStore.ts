// announcementStore — Zustand store for company-wide announcements (SRS FR-24).
//
// Owns the announcements list and the commands that mutate it (load, publish,
// edit, delete). Real-time `announcement_*` events from the WebSocket client
// are dispatched here by wsListeners.ts, so the Announcements view updates
// automatically when a manager publishes.
import { create } from 'zustand';
import { AnnouncementModel } from '../models';
import type { Announcement } from '../models';
import { getErrorMessage } from './utils';

interface AnnouncementState {
  announcements: Announcement[];
  loading: boolean;
  error: string | null;
  setAnnouncements: (announcements: Announcement[]) => void;
  /** Insert or replace an announcement (used by WS events + create/update). */
  addAnnouncement: (announcement: Announcement) => void;
  removeAnnouncement: (id: number) => void;
  load: () => Promise<void>;
  createAnnouncement: (data: {
    title: string;
    content: string;
  }) => Promise<Announcement | undefined>;
  updateAnnouncement: (
    id: number,
    data: { title?: string; content?: string },
  ) => Promise<Announcement | undefined>;
  deleteAnnouncement: (id: number) => Promise<void>;
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

  clear: () => set({ announcements: [], loading: false, error: null }),
}));
