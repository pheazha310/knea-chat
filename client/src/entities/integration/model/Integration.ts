// Integration domain model — MVVM Model layer.
// Data access for the /api/integrations endpoints.
import api from '../../../shared/lib/api';

export interface IntegrationConfig {
  id: number;
  companyId: number;
  channel: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  connected: boolean;
  health?: {
    connected: boolean;
    info?: Record<string, unknown>;
  } | null;
}

export interface AvailableChannel {
  channel: string;
  label: string;
  description: string;
  icon: string;
  supported: boolean;
  enabled: boolean;
}

export const IntegrationModel = {
  /** List integrations configured for the current company. */
  list: () =>
    api.get<{ success: boolean; data: IntegrationConfig[] }>('/integrations'),

  /** List all known channels with their enable/support status. */
  listAvailable: () =>
    api.get<{ success: boolean; data: AvailableChannel[] }>('/integrations/available'),

  /** Enable a channel for the current company. */
  enable: (channel: string) =>
    api.post<{ success: boolean; message: string; data: IntegrationConfig }>(
      `/integrations/${encodeURIComponent(channel)}`,
      {},
    ),

  /** Update channel config for the current company. */
  updateConfig: (channel: string, config: Record<string, unknown>) =>
    api.patch<{ success: boolean; message: string; data: IntegrationConfig }>(
      `/integrations/${encodeURIComponent(channel)}`,
      { config },
    ),

  /** Disable a channel for the current company. */
  disable: (channel: string) =>
    api.delete<{ success: boolean; message: string }>(
      `/integrations/${encodeURIComponent(channel)}`,
    ),

  /** Health check for a specific channel. */
  health: (channel: string) =>
    api.get<{ success: boolean; channel: string; connected: boolean; info?: Record<string, unknown> }>(
      `/integrations/${encodeURIComponent(channel)}/health`,
    ),
};
