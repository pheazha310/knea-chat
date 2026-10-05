/**
 * IntegrationConfigService — per-company/workspace integration management.
 *
 * Owns:
 *   - Listing enabled/available channels for a company
 *   - Enabling/disabling channels
 *   - Persisting channel-specific config (JSON blob)
 *   - Health checks per channel
 */
import type { IntegrationConfigRow, IntegrationChannel } from '../repositories/integrationConfigRepository';
import { IntegrationConfigRepository } from '../repositories/integrationConfigRepository';
import type { ChannelRegistry } from '../integrations/omni/channelRegistry';
import type { ChannelAdapter, OmniHealthResult } from '../integrations/omni/omni.types';

type Repo = IntegrationConfigRepository;

export interface IntegrationConfigDTO {
  id: number;
  companyId: number;
  channel: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  connected: boolean;
  health?: OmniHealthResult | null;
}

export interface AvailableChannel {
  channel: string;
  label: string;
  description: string;
  icon: string;
  supported: boolean;
  enabled: boolean;
}

const KNOWN_CHANNELS: AvailableChannel[] = [
  { channel: 'email', label: 'Email', description: 'Receive and reply to customer emails', icon: 'email', supported: true, enabled: false },
  { channel: 'telegram', label: 'Telegram', description: 'Connect a Telegram bot for customer support', icon: 'telegram', supported: true, enabled: false },
  { channel: 'website', label: 'Website Widget', description: 'Embed a chat widget on your website', icon: 'website', supported: true, enabled: false },
  { channel: 'whatsapp', label: 'WhatsApp', description: 'Connect WhatsApp Business for messaging', icon: 'whatsapp', supported: false, enabled: false },
  { channel: 'facebook', label: 'Facebook Messenger', description: 'Connect Facebook Messenger', icon: 'facebook', supported: false, enabled: false },
  { channel: 'instagram', label: 'Instagram', description: 'Connect Instagram DMs', icon: 'instagram', supported: false, enabled: false },
  { channel: 'tiktok', label: 'TikTok', description: 'Connect TikTok messages', icon: 'tiktok', supported: false, enabled: false },
  { channel: 'line', label: 'LINE', description: 'Connect LINE messaging', icon: 'line', supported: false, enabled: false },
  { channel: 'zalo', label: 'Zalo', description: 'Connect Zalo for customer chat', icon: 'zalo', supported: false, enabled: false },
  { channel: 'vkontakte', label: 'VKontakte', description: 'Connect VK messaging', icon: 'vkontakte', supported: false, enabled: false },
  { channel: 'youtube', label: 'YouTube', description: 'Connect YouTube comments and messages', icon: 'youtube', supported: false, enabled: false },
];

export class IntegrationConfigService {
  constructor(
    private integrationConfigRepository: IntegrationConfigRepository,
    private channelRegistry: ChannelRegistry,
  ) {}

  async listForCompany(companyId: number): Promise<IntegrationConfigDTO[]> {
    const rows = await this.integrationConfigRepository.findByCompany(companyId);
    const results: IntegrationConfigDTO[] = [];

    for (const row of rows) {
      const adapter = this.channelRegistry.get(row.channel);
      const dto: IntegrationConfigDTO = {
        id: row.id,
        companyId: row.company_id,
        channel: row.channel,
        enabled: row.enabled,
        config: (row.config as Record<string, unknown> | null) ?? null,
        connected: !!adapter,
      };

      if (adapter) {
        try {
          dto.health = await adapter.getHealth();
        } catch {
          dto.health = { connected: false };
        }
      }

      results.push(dto);
    }

    return results;
  }

  async getForCompany(companyId: number, channel: string): Promise<IntegrationConfigDTO | null> {
    const row = await this.integrationConfigRepository.findByCompanyAndChannel(companyId, channel);
    if (!row) return null;

    const adapter = this.channelRegistry.get(channel);
    const dto: IntegrationConfigDTO = {
      id: row.id,
      companyId: row.company_id,
      channel: row.channel,
      enabled: row.enabled,
      config: (row.config as Record<string, unknown> | null) ?? null,
      connected: !!adapter,
    };

    if (adapter) {
      try {
        dto.health = await adapter.getHealth();
      } catch {
        dto.health = { connected: false };
      }
    }

    return dto;
  }

  async listAvailable(): Promise<AvailableChannel[]> {
    const rows = await this.integrationConfigRepository.findAll();
    const enabledChannels = new Set(rows.filter((r) => r.enabled).map((r) => r.channel));

    return KNOWN_CHANNELS.map((ch) => ({
      ...ch,
      enabled: enabledChannels.has(ch.channel as IntegrationChannel),
      supported: this.channelRegistry.has(ch.channel),
    }));
  }

  async enable(companyId: number, channel: string): Promise<IntegrationConfigDTO> {
    if (!this.channelRegistry.has(channel)) {
      throw new Error(`Channel "${channel}" is not supported`);
    }

    const id = await this.integrationConfigRepository.upsert({
      company_id: companyId,
      channel: channel as IntegrationChannel,
      enabled: true,
      config: {},
    });

    return this.getForCompany(companyId, channel) as Promise<IntegrationConfigDTO>;
  }

  async disable(companyId: number, channel: string): Promise<void> {
    await this.integrationConfigRepository.update(companyId, channel, { enabled: false });
  }

  async updateConfig(companyId: number, channel: string, config: Record<string, unknown>): Promise<IntegrationConfigDTO> {
    if (!this.channelRegistry.has(channel)) {
      throw new Error(`Channel "${channel}" is not supported`);
    }

    await this.integrationConfigRepository.upsert({
      company_id: companyId,
      channel: channel as IntegrationChannel,
      enabled: true,
      config,
    });

    return this.getForCompany(companyId, channel) as Promise<IntegrationConfigDTO>;
  }

  async delete(companyId: number, channel: string): Promise<void> {
    await this.integrationConfigRepository.delete(companyId, channel);
  }

  async checkHealth(companyId: number, channel: string): Promise<OmniHealthResult | null> {
    const adapter = this.channelRegistry.get(channel);
    if (!adapter) return { connected: false };

    try {
      return await adapter.getHealth();
    } catch {
      return { connected: false };
    }
  }
}

export default IntegrationConfigService;
