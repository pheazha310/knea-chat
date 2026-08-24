// sharedFileStore — Zustand store for shared files.
//
// Owns the shared files list, current file preview, versions, permissions,
// plus every command that mutates them (upload, edit, delete, versioning,
// permissions, search).
import { create } from "zustand";
import { SharedFileModel } from "../models";
import type { SharedFile, FileVersion, FilePermission } from "../models";

interface SharedFileState {
  files: SharedFile[];
  total: number;
  currentFile: SharedFile | null;
  versions: FileVersion[];
  permissions: FilePermission[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;

  // --- setters ---
  setFiles: (files: SharedFile[], total: number) => void;
  setCurrentFile: (file: SharedFile | null) => void;
  setVersions: (versions: FileVersion[]) => void;
  setPermissions: (permissions: FilePermission[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSearchQuery: (query: string) => void;

  // --- loads ---
  loadFiles: (params?: { search?: string; fileType?: string; isPublic?: boolean; page?: number; limit?: number }) => Promise<void>;
  loadFile: (id: number) => Promise<void>;
  loadVersions: (id: number) => Promise<void>;
  loadPermissions: (id: number) => Promise<void>;

  // --- mutations ---
  uploadFile: (formData: FormData, onProgress?: (pct: number) => void) => Promise<SharedFile | null>;
  updateFile: (id: number, data: { file_name?: string; description?: string | null; is_public?: boolean }) => Promise<SharedFile | null>;
  deleteFile: (id: number) => Promise<boolean>;
  uploadVersion: (id: number, formData: FormData, onProgress?: (pct: number) => void) => Promise<FileVersion | null>;
  grantPermission: (fileId: number, userId: number, permission: string) => Promise<FilePermission | null>;
  revokePermission: (fileId: number, userId: number) => Promise<boolean>;
  searchFiles: (query: string) => Promise<SharedFile[]>;

  // --- reset ---
  clear: () => void;
}

export const useSharedFileStore = create<SharedFileState>()((set, get) => ({
  files: [],
  total: 0,
  currentFile: null,
  versions: [],
  permissions: [],
  isLoading: false,
  error: null,
  searchQuery: '',

  setFiles: (files, total) => set({ files, total }),
  setCurrentFile: (currentFile) => set({ currentFile }),
  setVersions: (versions) => set({ versions }),
  setPermissions: (permissions) => set({ permissions }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  loadFiles: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const response = await SharedFileModel.getAll(params);
      const files = response.data.data?.files || [];
      const total = response.data.data?.total || 0;
      set({ files, total, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  loadFile: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const response = await SharedFileModel.getById(id);
      const file = response.data.data?.file;
      set({ currentFile: file || null, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  loadVersions: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const response = await SharedFileModel.getVersions(id);
      const versions = response.data.data?.versions || [];
      set({ versions, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  loadPermissions: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const response = await SharedFileModel.getPermissions(id);
      const permissions = response.data.data?.permissions || [];
      set({ permissions, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  uploadFile: async (formData, onProgress) => {
    set({ isLoading: true, error: null });
    try {
      const response = await SharedFileModel.upload(formData, onProgress);
      const file = response.data.data?.file;
      if (file) {
        set((state) => ({ files: [file, ...state.files], total: state.total + 1, isLoading: false }));
      }
      return file || null;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return null;
    }
  },

  updateFile: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await SharedFileModel.update(id, data);
      const file = response.data.data?.file;
      if (file) {
        set((state) => ({
          files: state.files.map((f) => (f.id === id ? file : f)),
          currentFile: state.currentFile?.id === id ? file : state.currentFile,
          isLoading: false,
        }));
      }
      return file || null;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return null;
    }
  },

  deleteFile: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await SharedFileModel.remove(id);
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
        total: state.total - 1,
        currentFile: state.currentFile?.id === id ? null : state.currentFile,
        isLoading: false,
      }));
      return true;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  uploadVersion: async (id, formData, onProgress) => {
    set({ isLoading: true, error: null });
    try {
      const response = await SharedFileModel.uploadVersion(id, formData, onProgress);
      const version = response.data.data?.version;
      if (version) {
        set((state) => ({ versions: [version, ...state.versions], isLoading: false }));
      }
      return version || null;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return null;
    }
  },

  grantPermission: async (fileId, userId, permission) => {
    set({ isLoading: true, error: null });
    try {
      const response = await SharedFileModel.grantPermission(fileId, userId, permission);
      const perm = response.data.data?.permission;
      if (perm) {
        set((state) => ({ permissions: [...state.permissions, perm], isLoading: false }));
      }
      return perm || null;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return null;
    }
  },

  revokePermission: async (fileId, userId) => {
    set({ isLoading: true, error: null });
    try {
      await SharedFileModel.revokePermission(fileId, userId);
      set((state) => ({
        permissions: state.permissions.filter((p) => !(p.file_id === fileId && p.user_id === userId)),
        isLoading: false,
      }));
      return true;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  searchFiles: async (query) => {
    set({ isLoading: true, error: null, searchQuery: query });
    try {
      const response = await SharedFileModel.search({ q: query });
      const files = response.data.data?.files || [];
      set({ files, total: response.data.data?.total || 0, isLoading: false });
      return files;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return [];
    }
  },

  clear: () => set({
    files: [],
    total: 0,
    currentFile: null,
    versions: [],
    permissions: [],
    isLoading: false,
    error: null,
    searchQuery: '',
  }),
}));
