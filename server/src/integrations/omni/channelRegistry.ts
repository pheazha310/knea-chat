/**
 * ChannelRegistry — maps channel names to their ChannelAdapter instances.
 * The generic omni-channel engine looks adapters up here, so adding a channel
 * is just "register an adapter" (see container.ts).
 */
import type { ChannelAdapter } from './omni.types';

export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
  }

  get(channel: string): ChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

  has(channel: string): boolean {
    return this.adapters.has(channel);
  }

  channels(): string[] {
    return Array.from(this.adapters.keys());
  }
}