// companyStore — Zustand store for the current workspace / company.
//
// Owns the company record, company members, departments, teams and platform
// settings. Team CRUD used by the chat screens lives here; message/chat data
// lives in chatStore and people/presence data in userStore.
import { create } from 'zustand';
import {
  DepartmentModel,
  SystemSettingModel,
  TeamModel,
  UserModel,
} from '../models';
import type {
  Company,
  Department,
  SystemSettings,
  Team,
  User,
} from '../models';
import { getErrorMessage } from './utils';

interface CompanyState {
  company: Company | null;
  companyMembers: User[];
  departments: Department[];
  teams: Team[];
  settings: Partial<SystemSettings> | null;
  loading: boolean;
  error: string | null;
  setCompany: (company: Company | null) => void;
  loadMembers: () => Promise<void>;
  setDepartments: (departments: Department[]) => void;
  setTeams: (teams: Team[]) => void;
  /** Initial workspace load: departments, teams + public settings. */
  load: () => Promise<void>;
  /** Refetch the company's departments (SRS FR-06). */
  loadDepartments: () => Promise<void>;
  createDepartment: (data: {
    name: string;
    description?: string;
  }) => Promise<Department | undefined>;
  updateDepartment: (
    id: number,
    data: { name?: string; description?: string | null },
  ) => Promise<Department | undefined>;
  removeDepartment: (id: number) => Promise<void>;
  createTeam: (data: {
    name: string;
    description: string;
    member_ids?: number[];
  }) => Promise<Team | undefined>;
  refreshTeams: () => Promise<void>;
  loadSettings: () => Promise<void>;
  clear: () => void;
}

export const useCompanyStore = create<CompanyState>()((set, get) => ({
  company: null,
  companyMembers: [],
  departments: [],
  teams: [],
  settings: null,
  loading: false,
  error: null,

  setCompany: (company) => set({ company }),

  loadMembers: async () => {
    try {
      const res = await UserModel.getAll();
      set({ companyMembers: res.data.data?.users || [] });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load company members') });
    }
  },

  setDepartments: (departments) => set({ departments }),
  setTeams: (teams) => set({ teams }),

  load: async () => {
    set({ loading: true, error: null });
    try {
      await Promise.allSettled([
        get().loadDepartments(),
        get().refreshTeams(),
        get().loadSettings(),
      ]);
      set({ loading: false });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load workspace data'), loading: false });
    }
  },

  loadDepartments: async () => {
    try {
      const res = await DepartmentModel.getAll();
      set({ departments: res.data.data?.departments || [] });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load departments') });
    }
  },

  createDepartment: async (data) => {
    const res = await DepartmentModel.create(data);
    const department = res.data?.data?.department;
    if (department) {
      set((state) =>
        state.departments.some((d) => d.id === department.id)
          ? state
          : { departments: [...state.departments, department] },
      );
    }
    return department;
  },

  updateDepartment: async (id, data) => {
    const res = await DepartmentModel.update(id, data);
    const department = res.data?.data?.department;
    if (department) {
      set((state) => ({
        departments: state.departments.map((d) =>
          d.id === department.id ? department : d,
        ),
      }));
    }
    return department;
  },

  removeDepartment: async (id) => {
    await DepartmentModel.remove(id);
    set((state) => ({
      departments: state.departments.filter((d) => d.id !== id),
    }));
  },

  createTeam: async (data) => {
    const res = await TeamModel.create(data);
    const team = res.data?.data?.team;
    if (team) {
      set((state) =>
        state.teams.some((t) => t.id === team.id)
          ? state
          : { teams: [team, ...state.teams] },
      );
    }
    return team;
  },

  refreshTeams: async () => {
    try {
      const res = await TeamModel.getAll();
      set({ teams: res.data.data?.teams || [] });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load teams') });
    }
  },

  loadSettings: async () => {
    try {
      const res = await SystemSettingModel.getPublic();
      set({ settings: res.data.data?.settings || null });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load settings') });
    }
  },

  clear: () =>
    set({
      company: null,
      companyMembers: [],
      departments: [],
      teams: [],
      settings: null,
    }),
}));
