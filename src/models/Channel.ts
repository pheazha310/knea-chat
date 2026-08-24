// Channel domain model — MVVM Model layer.
// Holds the `Channel` entity plus `ChannelModel`, the data access for the
// /channels endpoints.
import api from '../services/api';
import type { User } from './User';

export type ChannelType = 'public' | 'private';

export interface Channel {
  id: number;
  team_id?: number | null;
  company_id: number;
  created_by: number;
  name: string;
  description?: string | null;
  type: ChannelType;
  is_archived?: number;
  member_count?: number;
  created_at?: string;
  updated_at?: string;
}

export const ChannelModel = {
  getAll: () =>
    api.get<{ success: boolean; data: { channels: Channel[] } }>('/channels'),
  get: (id: number) =>
    api.get<{ success: boolean; data: { channel: Channel } }>(`/channels/${id}`),
  create: (data: {
    name: string;
    description?: string;
    type?: 'public' | 'private';
    team_id?: number | null;
    member_ids?: number[];
  }) =>
    api.post<{ success: boolean; data: { channel: Channel } }>('/channels', data),
  update: (id: number, data: Partial<Channel>) =>
    api.patch<{ success: boolean; data: { channel: Channel } }>(`/channels/${id}`, data),
  remove: (id: number) =>
    api.delete<{ success: boolean; message: string }>(`/channels/${id}`),
  getMembers: (id: number) =>
    api.get<{ success: boolean; data: { members: User[] } }>(`/channels/${id}/members`),
  addMember: (id: number, userId: number, role = 'member') =>
    api.post<{ success: boolean; message: string }>(`/channels/${id}/members`, {
      user_id: userId,
      role,
    }),
  removeMember: (id: number, userId: number) =>
    api.delete<{ success: boolean; message: string }>(`/channels/${id}/members/${userId}`),
};
