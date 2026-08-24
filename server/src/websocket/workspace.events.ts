/**
 * Workspace-scoped WebSocket events.
 *
 * Emits a lightweight `workspace_changed` notice to every connected client in
 * a company when teams or channels change (create / update / delete / member
 * ops). Clients react by refetching the affected collection — the server's
 * list endpoints apply per-user filtering (e.g. private channel membership),
 * so the generic notice is both simple and secure.
 *
 *   team.controller / channel.controller → emitWorkspaceChanged → clients
 */
import WebSocket from 'ws';
import { userConnections } from './connection.registry';

export type WorkspaceKind = 'teams' | 'channels';

const emitToCompany = (companyId: number, event: object, excludeUserId: number | null = null): void => {
  const payload = JSON.stringify(event);
  userConnections.forEach((sockets) => {
    for (const socket of sockets) {
      if (socket.companyId !== companyId || socket.readyState !== WebSocket.OPEN) continue;
      if (excludeUserId !== null && Number(socket.userId) === Number(excludeUserId)) continue;
      socket.send(payload);
    }
  });
};

/** Tell every connected client in the company to refresh a collection. */
export const emitWorkspaceChanged = (companyId: number, kind: WorkspaceKind): void => {
  emitToCompany(companyId, {
    type: 'workspace_changed',
    data: { kind },
    timestamp: new Date().toISOString(),
  });
};

/**
 * Broadcast a company-scoped event (announcement lifecycle, notification,
 * …) to every connected client (SRS FR-24). The publisher can be excluded so
 * they don't double-apply their own change (they already applied the REST
 * response).
 */
export const emitAnnouncementEvent = (
  companyId: number,
  event: { type: string; data: Record<string, unknown> },
  excludeUserId: number | null = null,
): void => {
  emitToCompany(companyId, { ...event, timestamp: new Date().toISOString() }, excludeUserId);
};
