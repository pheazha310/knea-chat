/**
 * Attendance WebSocket events.
 *
 * Bridges attendance changes to connected clients through the native
 * WebSocket infrastructure (connection.registry) and — when Redis is
 * available — publishes to the shared `attendance:events` channel so other
 * server instances can fan the event out to their own sockets.
 *
 * Flow: Employee → Express API → MySQL → Redis Pub/Sub → WebSocket →
 * Manager Dashboard (no page refresh required).
 */
import WebSocket from 'ws';
import { userConnections, sendToUser } from './connection.registry';
import { redisClient, ATTENDANCE_CHANNEL } from '../cache/redisClient';
import type { AttendanceEventPayload } from '../services/Attendance.service';

/** Emit an attendance event to the company and/or targeted users. */
export const publishAttendanceEvent = (payload: AttendanceEventPayload): void => {
  const envelope = {
    type: payload.type,
    data: payload.data,
    timestamp: new Date().toISOString(),
    // Tells other instances this event is theirs to relay — this instance
    // already delivered it to its own sockets above.
    origin: redisClient.getInstanceId(),
  };
  const raw = JSON.stringify(envelope);

  if (payload.userIds && payload.userIds.length > 0) {
    for (const userId of payload.userIds) {
      sendToUser(userId, raw);
    }
  } else {
    userConnections.forEach((sockets) => {
      for (const socket of sockets) {
        if (socket.companyId !== payload.companyId || socket.readyState !== WebSocket.OPEN) continue;
        socket.send(raw);
      }
    });
  }

  // Cross-instance fan-out: other server instances receive this (via Redis,
  // or the in-memory bus when running single-instance) and relay it to their
  // local sockets. Origin echoes are ignored by the relay below.
  void redisClient.publish(ATTENDANCE_CHANNEL, raw).catch(() => {});
};

/** Object bound into the container as the service's event publisher. */
export const attendanceEventPublisher = {
  publish: publishAttendanceEvent,
};

/** Wire up the Redis subscriber once (called from server.ts). */
export const startAttendanceEventRelay = async (): Promise<void> => {
  await redisClient.subscribe(ATTENDANCE_CHANNEL, (message) => {
    try {
      const envelope = JSON.parse(message) as {
        type: string;
        data: Record<string, unknown>;
        timestamp?: string;
        origin?: string;
      };
      if (!envelope?.type) return;
      // Skip our own publish echo — this instance already delivered the event
      // to its local sockets in publishAttendanceEvent.
      if (envelope.origin === redisClient.getInstanceId()) return;
      const raw = typeof message === 'string' ? message : JSON.stringify(envelope);
      userConnections.forEach((sockets) => {
        for (const socket of sockets) {
          if (socket.readyState === WebSocket.OPEN) socket.send(raw);
        }
      });
    } catch {
      // malformed cross-instance message — ignore
    }
  });
};