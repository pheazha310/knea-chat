import type { Announcement, Reaction, WsMessage, SharedFile } from '../models';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface TypingData {
  conversationId: number;
  userId: number;
  userEmail?: string;
  timestamp?: string;
}

export interface PresenceData {
  userId: number;
  userEmail?: string;
  status?: string;
}

export interface WsError {
  type: 'error';
  message: string;
}

// Payload shapes mirror the server (server/src/websocket/*): broadcast events
// wrap their payload in a `message` or `data` field.
export interface WsEventMap {
  connection: {
    status: ConnectionStatus;
    error?: Event;
    /** Current retry attempt (1-based while reconnecting). */
    attempt?: number;
    maxAttempts?: number;
    nextRetryMs?: number;
  };
  connection_ack: { type: 'connection_ack'; userId: number; message: string; timestamp?: string };
  receive_message: { type: 'receive_message'; message: WsMessage };
  message_sent_ack: { type: 'message_sent_ack'; message?: string; data?: WsMessage };
  message_edited_ack: { type: 'message_edited_ack'; messageId: number; timestamp?: string };
  message_deleted_ack: { type: 'message_deleted_ack'; messageId: number; timestamp?: string };
  message_deleted: { type: 'message_deleted'; message: { id: number; conversationId: number; deletedAt?: string } };
  message_updated: { type: 'message_updated'; message: { id: number; conversationId: number; content: string; updatedAt?: string } };
  message_pinned: { type: 'message_pinned'; message: { id: number; conversationId: number; isPinned: boolean } };
  message_unpinned: { type: 'message_unpinned'; message: { id: number; conversationId: number; isPinned: boolean } };
  message_reacted: {
    type: 'message_reacted';
    data: { conversationId: number; messageId: number; reactions: Reaction[] };
    timestamp?: string;
  };
  message_unreacted: {
    type: 'message_unreacted';
    data: { conversationId: number; messageId: number; reactions: Reaction[] };
    timestamp?: string;
  };
  message_pinned_ack: { type: 'message_pinned_ack'; messageId: number; timestamp?: string };
  message_unpinned_ack: { type: 'message_unpinned_ack'; messageId: number; timestamp?: string };
  message_forwarded: { type: 'message_forwarded'; message: WsMessage };
  message_forwarded_ack: { type: 'message_forwarded_ack'; messageId: number; targetConversationId?: number; timestamp?: string };
  bookmark_added: {
    type: 'bookmark_added';
    data: { messageId: number; bookmark: any };
    timestamp?: string;
  };
  bookmark_removed: {
    type: 'bookmark_removed';
    data: { messageId: number };
    timestamp?: string;
  };
  typing_start: { type: 'typing_start'; data: TypingData };
  typing_stop: { type: 'typing_stop'; data: TypingData };
  user_online: { type: 'user_online'; data: PresenceData };
  user_offline: { type: 'user_offline'; data: PresenceData };
  presence_snapshot: {
    type: 'presence_snapshot';
    data: { userIds: number[]; timestamp?: string };
  };
  user_profile_updated: {
    type: 'user_profile_updated';
    data: { userId: number; profilePicture: string | null };
  };
  user_status_changed: { type: 'user_status_changed'; data: PresenceData & { status: string } };
  workspace_changed: {
    type: 'workspace_changed';
    data: { kind: 'teams' | 'channels' };
    timestamp?: string;
  };
  // --- Calls (signaling only — media stays local; see callStore.ts) ---
  incoming_call: {
    type: 'incoming_call';
    data: {
      callId: string;
      callerUserId: number;
      callerName: string;
      callerStatus?: string;
      type: 'voice' | 'video';
      conversationId?: number;
      conversationName?: string;
      isGroup?: boolean;
      memberCount?: number;
    };
    timestamp?: string;
  };
  call_accepted: {
    type: 'call_accepted';
    data: { callId: string; calleeUserId: number; calleeName: string };
    timestamp?: string;
  };
  call_declined: {
    type: 'call_declined';
    data: { callId: string; calleeUserId: number; calleeName: string };
    timestamp?: string;
  };
  call_ended: { type: 'call_ended'; data: { callId: string }; timestamp?: string };
  call_unavailable: {
    type: 'call_unavailable';
    data: { callId: string };
    timestamp?: string;
  };
  // --- WebRTC media signaling (relayed between call participants) ---
  call_participants: {
    type: 'call_participants';
    data: {
      callId: string;
      participants: Array<{ userId: number; name: string; isCaller: boolean }>;
    };
    timestamp?: string;
  };
  webrtc_offer: {
    type: 'webrtc_offer';
    data: { callId: string; targetUserId: number; sdp: RTCSessionDescriptionInit };
    timestamp?: string;
  };
  webrtc_answer: {
    type: 'webrtc_answer';
    data: { callId: string; targetUserId: number; sdp: RTCSessionDescriptionInit };
    timestamp?: string;
  };
  webrtc_ice: {
    type: 'webrtc_ice';
    data: { callId: string; targetUserId: number; candidate: RTCIceCandidateInit };
    timestamp?: string;
  };
  notification: { type: 'notification'; data?: any };
  announcement_created: {
    type: 'announcement_created';
    data: { announcement: Announcement };
    timestamp?: string;
  };
  announcement_updated: {
    type: 'announcement_updated';
    data: { announcement: Announcement };
    timestamp?: string;
  };
  announcement_deleted: {
    type: 'announcement_deleted';
    data: { id: number };
    timestamp?: string;
  };
  // --- Shared files (SRS §2) ---
  shared_file_created: {
    type: 'shared_file_created';
    data: { file: SharedFile };
    timestamp?: string;
  };
  shared_file_updated: {
    type: 'shared_file_updated';
    data: { file: SharedFile };
    timestamp?: string;
  };
  shared_file_deleted: {
    type: 'shared_file_deleted';
    data: { fileId: number };
    timestamp?: string;
  };
  shared_file_version_uploaded: {
    type: 'shared_file_version_uploaded';
    data: { fileId: number; version: any };
    timestamp?: string;
  };
  shared_file_permission_granted: {
    type: 'shared_file_permission_granted';
    data: { fileId: number; permission: any };
    timestamp?: string;
  };
  shared_file_permission_revoked: {
    type: 'shared_file_permission_revoked';
    data: { fileId: number; userId: number };
    timestamp?: string;
  };
  error: WsError;
}

type WsHandler<T> = (payload: T) => void;

const WS_URL =
  process.env.REACT_APP_WS_URL || 'ws://localhost:8080';

class WebSocketService {
  private socket: WebSocket | null = null;
  private listeners: Record<string, Array<(payload: any) => void>> = {};
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 8;
  private readonly reconnectBaseMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private token: string | null = null;
  private manualClose = false;
  /** CONNECTING sockets that a disconnect() asked to close once they open. */
  private socketsToClose = new Set<WebSocket>();
  private queue: Array<Record<string, unknown>> = [];
  // App-level heartbeat: the server echoes `pong` (see websocket.server.js).
  // Detects a dead connection even when the OS/TCP layer stays silent (e.g. a
  // crashed server) so the reconnect flow — and its visible badge — kick in.
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeatIntervalMs = 15000;
  private readonly pongTimeoutMs = 5000;

  connect(token: string) {
    this.token = token;
    this.manualClose = false;
    // Reuse an open/in-flight socket instead of creating duplicates — React
    // StrictMode re-runs effects and login() also connects directly. A second
    // CONNECTING socket is what produced the "WebSocket is closed before the
    // connection is established" console error.
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.emit('connection', {
      status: 'connecting',
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
    });

    const wsUrl = `${WS_URL}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      // A disconnect() landed while this socket was still CONNECTING — close
      // it right after opening. (Calling close() on a CONNECTING socket is
      // what makes Chrome log "WebSocket is closed before the connection is
      // established".)
      if (this.socketsToClose.delete(socket)) {
        socket.close();
        if (this.socket === socket) this.socket = null;
        return;
      }
      this.reconnectAttempts = 0;
      this.emit('connection', {
        status: 'connected',
        attempt: 0,
        maxAttempts: this.maxReconnectAttempts,
      });
      this.startHeartbeat();
      this.flushQueue();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'pong') {
          // Heartbeat acknowledgement — the connection is alive.
          this.clearPongTimer();
          return;
        }
        this.emit(payload.type, payload);
      } catch {
        // ignore malformed payloads
      }
    };

    socket.onclose = () => {
      // Only the current socket may trigger a reconnect — orphaned sockets
      // (replaced by a newer connect()) must not spawn duplicates.
      if (this.socket === socket) {
        this.stopHeartbeat();
        this.socket = null;
        if (this.manualClose) {
          this.emit('connection', { status: 'disconnected' });
          return;
        }
        const attempt = this.reconnectAttempts + 1;
        const canRetry = attempt <= this.maxReconnectAttempts;
        this.emit('connection', {
          status: canRetry ? 'reconnecting' : 'disconnected',
          attempt,
          maxAttempts: this.maxReconnectAttempts,
          nextRetryMs: this.reconnectBaseMs * 2 ** this.reconnectAttempts,
        });
        this.attemptReconnect();
      } else if (!this.socket) {
        this.stopHeartbeat();
        // A stale socket closed and no socket is active — report it.
        this.emit('connection', { status: 'disconnected' });
      }
      // A stale socket closing while a newer socket is live must not
      // overwrite that healthy socket's state — or stop its heartbeat —
      // intentionally silent.
    };

    socket.onerror = (error) => {
      this.emit('connection', { status: 'error', error });
    };
  }

  private attemptReconnect() {
    if (this.reconnectTimer || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }
    const delay = this.reconnectBaseMs * 2 ** this.reconnectAttempts;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token && !this.manualClose) {
        console.log(`[ws] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.connect(this.token);
      }
    }, delay);
  }

  disconnect() {
    this.manualClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      if (socket.readyState === WebSocket.CONNECTING) {
        // Close it as soon as it finishes connecting — this is the case that
        // used to log "WebSocket is closed before the connection is
        // established" (see connect()).
        this.socketsToClose.add(socket);
      } else {
        socket.close();
      }
    }
    this.listeners = {};
    this.queue = [];
    this.reconnectAttempts = 0;
  }

  send(eventType: string, data: Record<string, unknown> = {}) {
    const payload = { type: eventType, ...data };
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    } else {
      this.queue.push(payload);
    }
  }

  private flushQueue() {
    if (!this.queue.length) return;
    const pending = this.queue.splice(0);
    pending.forEach((payload) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(payload));
      }
    });
  }

  on<K extends keyof WsEventMap>(event: K, handler: WsHandler<WsEventMap[K]>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: (payload: any) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((cb) => cb !== handler);
  }

  emit(event: string, data: any) {
    (this.listeners[event] || []).forEach((cb) => {
      try {
        cb(data);
      } catch (error) {
        console.error(`[ws] Listener error for "${event}":`, error);
      }
    });
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Start the heartbeat loop (called once the socket is OPEN). */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      this.socket.send(JSON.stringify({ type: 'ping' }));
      this.clearPongTimer();
      this.pongTimer = setTimeout(() => {
        // No pong in time — the server is gone. Closing the socket triggers
        // onclose → the reconnect flow (and its retry counter) take over.
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.close();
        }
      }, this.pongTimeoutMs);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimer();
  }

  private clearPongTimer() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }
}

export const wsService = new WebSocketService();
export default wsService;
