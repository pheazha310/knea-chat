/**
 * ChatWebSocketServer — OOP WebSocket server class.
 *
 * Authenticates connections with JWT, registers sockets in the connection
 * registry, routes events to the injected handlers, and runs a heartbeat.
 * Handler dependencies (MessageHandler, TypingHandler, PresenceHandler) are
 * injected via the constructor.
 */
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import http from 'http';
import type {
  MessageHandler,
  SendMessageEvent,
  ForwardEvent,
  EditEvent,
  DeleteEvent,
  PinEvent,
  JoinEvent,
} from './message.handler';
import type { TypingHandler, TypingEvent } from './typing.handler';
import type { PresenceHandler } from './presence.handler';
import type {
  CallHandler,
  CallStartEvent,
  CallRespondEvent,
  CallEndEvent,
  RtcRelayEvent,
} from './call.handler';
import { userConnections } from './connection.registry';
import type { AuthedSocket } from './connection.registry';

/** Live server instance, readable by non-handler modules (avatar uploads). */
export const wssRef: { current: WebSocket.Server | null } = { current: null };

export interface WebSocketDeps {
  messageHandler: MessageHandler;
  typingHandler: TypingHandler;
  presenceHandler: PresenceHandler;
  callHandler: CallHandler;
}

const getSecret = (): string => process.env.JWT_SECRET || 'your-secret-key';

export class ChatWebSocketServer {
  constructor(private deps: WebSocketDeps) {}

  attach(wss: WebSocket.Server, server: http.Server): void {
    // Expose the server instance so non-handler modules (e.g. the avatar upload
    // route) can broadcast profile updates to every connected client.
    wssRef.current = wss;

    wss.on('connection', (ws, req) => {
      console.log('🔌 New WebSocket connection established');

      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Unauthorized: Token required');
        console.log('❌ Connection rejected: No token provided');
        return;
      }

      try {
        const decoded = jwt.verify(token, getSecret()) as jwt.JwtPayload;

        const socket = ws as AuthedSocket;
        socket.userId = decoded.id as number;
        socket.email = decoded.email as string;
        socket.role = decoded.role as string;
        socket.companyId = decoded.companyId as number;
        socket.isAlive = true;

        if (!userConnections.has(socket.userId)) {
          userConnections.set(socket.userId, []);
        }
        userConnections.get(socket.userId)!.push(socket);

        console.log(`✅ User ${socket.email} connected (ID: ${socket.userId})`);

        this.deps.presenceHandler.broadcastUserOnline(socket.userId, socket.email, wss);

        socket.send(
          JSON.stringify({
            type: 'connection_ack',
            message: 'Connected to KneaChat WebSocket server',
            userId: socket.userId,
            timestamp: new Date().toISOString(),
          }),
        );

        // Presence snapshot: let this socket know who was already online so a
        // fresh login (or reconnect) shows real presence immediately.
        this.deps.presenceHandler.sendPresenceSnapshot(socket);

        socket.on('message', (data) => this.handleMessage(socket, data, wss));

        socket.on('close', () => this.handleClose(socket, wss));

        socket.on('error', (error) => {
          console.error(`❌ WebSocket error for user ${socket.userId}:`, error.message);
        });

        socket.on('pong', () => {
          socket.isAlive = true;
        });
      } catch (error) {
        ws.close(4001, 'Unauthorized: Invalid token');
        console.log('❌ Connection rejected: Invalid token');
      }
    });

    const heartbeat = setInterval(() => {
      wss.clients.forEach((client) => {
        const socket = client as AuthedSocket;
        if (socket.isAlive === false) {
          return socket.terminate();
        }
        socket.isAlive = false;
        socket.ping();
      });
    }, 30000);

    wss.on('close', () => {
      clearInterval(heartbeat);
    });
  }

  handleMessage(ws: AuthedSocket, data: WebSocket.RawData, wss: WebSocket.Server): void {
    try {
      const event = JSON.parse(data.toString()) as { type?: string } & Record<string, unknown>;
      console.log(`📨 Message from user ${ws.userId}: ${event.type}`);

      switch (event.type) {
        case 'send_message':
          this.deps.messageHandler.handleSendMessage(ws, event as SendMessageEvent);
          break;

        case 'forward_message':
          this.deps.messageHandler.handleForwardMessage(ws, event as ForwardEvent);
          break;

        case 'message_edited':
          this.deps.messageHandler.handleMessageEdited(ws, event as EditEvent);
          break;

        case 'message_deleted':
          this.deps.messageHandler.handleMessageDeleted(ws, event as DeleteEvent);
          break;

        case 'message_pinned':
          this.deps.messageHandler.handleMessagePinned(ws, event as PinEvent, true);
          break;

        case 'message_unpinned':
          this.deps.messageHandler.handleMessagePinned(ws, event as PinEvent, false);
          break;

        case 'typing_start':
          this.deps.typingHandler.handleTypingStart(ws, event as TypingEvent);
          break;

        case 'typing_stop':
          this.deps.typingHandler.handleTypingStop(ws, event as TypingEvent);
          break;

        case 'join_channel':
          this.deps.messageHandler.handleJoinChannel(ws, event as JoinEvent);
          break;

        case 'leave_channel':
          this.deps.messageHandler.handleLeaveChannel(ws, event as JoinEvent);
          break;

        case 'call_start':
          this.deps.callHandler.handleCallStart(ws, event as CallStartEvent);
          break;

        case 'call_accept':
          this.deps.callHandler.handleCallAccept(ws, event as CallRespondEvent);
          break;

        case 'call_decline':
          this.deps.callHandler.handleCallDecline(ws, event as CallRespondEvent);
          break;

        case 'call_end':
          this.deps.callHandler.handleCallEnd(ws, event as CallEndEvent);
          break;

        case 'webrtc_offer':
          this.deps.callHandler.handleRtcOffer(ws, event as RtcRelayEvent);
          break;

        case 'webrtc_answer':
          this.deps.callHandler.handleRtcAnswer(ws, event as RtcRelayEvent);
          break;

        case 'webrtc_ice':
          this.deps.callHandler.handleRtcIce(ws, event as RtcRelayEvent);
          break;

        case 'user_status':
          this.deps.presenceHandler.handleUserStatusChange(ws, event as { status?: string }, wss);
          break;

        case 'ping':
          ws.send(
            JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString(),
            }),
          );
          break;

        default:
          console.warn(`⚠️ Unknown event type: ${event.type}`);
          ws.send(
            JSON.stringify({
              type: 'error',
              message: `Unknown event type: ${event.type}`,
            }),
          );
      }
    } catch (error) {
      console.error('❌ Error processing message:', (error as Error).message);
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Failed to process message: ' + (error as Error).message,
        }),
      );
    }
  }

  handleClose(ws: AuthedSocket, wss: WebSocket.Server): void {
    console.log(`👋 User ${ws.userId} disconnected`);

    if (userConnections.has(ws.userId)) {
      const connections = userConnections.get(ws.userId)!;
      const index = connections.indexOf(ws);
      if (index > -1) {
        connections.splice(index, 1);
      }

      if (connections.length === 0) {
        userConnections.delete(ws.userId);
        this.deps.presenceHandler.broadcastUserOffline(ws.userId, ws.email, wss);
      }
    }
  }
}
