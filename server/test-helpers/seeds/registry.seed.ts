/**
 * Seeds a stub for the websocket `connection.registry` module BEFORE any
 * module that imports it (message.handler, presence.handler, websocket.server)
 * is loaded.
 *
 * IMPORTANT: import this file FIRST in test files that exercise those modules.
 * ES module imports are evaluated in source order, so the `seed()` call in this
 * module's body runs before the module under test loads and captures the stub.
 *
 * The stub object is mutable: tests may override `sendToUser` /
 * `getConnectedUsers` / etc. after importing — consumers resolve these
 * properties at call time, so the overrides take effect.
 */
import { seed } from '../module-stub';
import type { AuthedSocket } from '../../src/websocket/connection.registry';

export interface RegistryStub {
  userConnections: Map<number, AuthedSocket[]>;
  sendToUser: (userId: number, event: string | Record<string, unknown>) => void;
  getConnectedUsers: () => number[];
  isUserConnected: (userId: number) => boolean;
}

export const registryStub: RegistryStub = {
  userConnections: new Map(),
  sendToUser: () => {},
  getConnectedUsers: () => [],
  isUserConnected: () => false,
};

seed('../src/websocket/connection.registry', registryStub);
