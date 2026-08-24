/**
 * PresenceHandler — WebSocket events for online/offline status.
 * Persists status through UserRepository and broadcasts to every client.
 */
import WebSocket from 'ws';
import type { UserRepository } from '../repositories/userRepository';
import type { UserRow } from '../types';
import { getConnectedUsers } from './connection.registry';
import type { AuthedSocket } from './connection.registry';

const VALID_STATUSES = ['online', 'offline', 'away', 'dnd'];

export class PresenceHandler {
  constructor(private userRepository: UserRepository) {}

  async handleUserStatusChange(
    ws: AuthedSocket,
    event: { status?: string },
    wss: WebSocket.Server,
  ): Promise<void> {
    try {
      const { status } = event;

      if (!status || !VALID_STATUSES.includes(status)) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid status. Must be: online, offline, away, or dnd',
        }));
        return;
      }

      await this.userRepository.updateStatus(ws.userId, status);
      ws.userStatus = status;

      const statusData = {
        type: 'user_status_changed',
        data: {
          userId: ws.userId,
          userEmail: ws.email,
          status,
          timestamp: new Date().toISOString(),
        },
      };

      console.log(`🟢 User ${ws.email} status changed to: ${status}`);

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(statusData));
        }
      });
    } catch (error) {
      console.error('Error in handleUserStatusChange:', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to update status: ' + (error as Error).message,
      }));
    }
  }

  broadcastUserOnline(userId: number, userEmail: string, wss: WebSocket.Server): void {
    const onlineData = {
      type: 'user_online',
      data: {
        userId,
        userEmail,
        timestamp: new Date().toISOString(),
      },
    };

    console.log(`✅ Broadcasting: User ${userEmail} is online`);

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(onlineData));
      }
    });
  }

  /**
   * Tell a freshly-connected socket who is already online. Without this,
   * a new session only hears about itself and everyone else looks offline
   * until they do something.
   */
  sendPresenceSnapshot(ws: AuthedSocket): void {
    const connectedUserIds = getConnectedUsers().filter((id) => id !== ws.userId);
    ws.send(JSON.stringify({
      type: 'presence_snapshot',
      data: {
        userIds: connectedUserIds,
        timestamp: new Date().toISOString(),
      },
    }));
  }

  broadcastUserOffline(userId: number, userEmail: string, wss: WebSocket.Server): void {
    const offlineData = {
      type: 'user_offline',
      data: {
        userId,
        userEmail,
        timestamp: new Date().toISOString(),
      },
    };

    console.log(`❌ Broadcasting: User ${userEmail} is offline`);

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(offlineData));
      }
    });
  }

  async getOnlineUsers(userId: number, wss: WebSocket.Server): Promise<Array<UserRow & { isOnline: boolean }>> {
    const connectedUserIds = getConnectedUsers();
    if (!connectedUserIds.length) {
      return [];
    }

    const users = await this.userRepository.findByIds(connectedUserIds);

    return users.map((u) => ({
      ...u,
      isOnline: true,
    }));
  }
}
