/**
 * Connection registry — maps user ids to their live WebSocket connections.
 * Kept separate from the server/handlers so presence and broadcast logic can
 * share one source of truth.
 */
import WebSocket from 'ws';

/** A connected socket with the authenticated user attached. */
export interface AuthedSocket extends WebSocket {
  userId: number;
  email: string;
  role: string;
  companyId: number;
  isAlive: boolean;
  userStatus?: string;
}

export const userConnections = new Map<number, AuthedSocket[]>();

export const sendToUser = (userId: number, event: string | object): void => {
  const connections = userConnections.get(userId) || [];
  // Accept an already-serialized string (e.g. from broadcast.utils toJson) or
  // a raw object. Double-stringifying previously corrupted every broadcast.
  const payload = typeof event === 'string' ? event : JSON.stringify(event);
  connections.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  });
};

export const getConnectedUsers = (): number[] => Array.from(userConnections.keys());

export const isUserConnected = (userId: number): boolean => {
  const connections = userConnections.get(userId);
  return !!connections && connections.length > 0;
};
