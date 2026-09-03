/**
 * CallHandler — WebSocket events for voice/video call signaling.
 *
 * Routes call lifecycle events between users (and conversation members) over
 * the existing authenticated WebSocket connection. No media is relayed here —
 * the events announce a call, its acceptance/decline, and its end, so the
 * caller sees "ringing" and the callee sees an incoming-call ring instead of
 * a call only the caller knows about.
 *
 * Events:
 *   call_start   (caller → server)  → incoming_call to the target user(s)
 *   call_accept  (callee → server)  → call_accepted to the caller
 *   call_decline (callee → server)  → call_declined to the caller
 *   call_end     (either → server)  → call_ended to the other participant(s)
 */
import type { UserRepository } from '../repositories/userRepository';
import type { ConversationRepository } from '../repositories/conversationRepository';
import type { NotificationRepository } from '../repositories/notificationRepository';
import type { NotificationPreferenceService } from '../services/NotificationPreference.service';
import { isUserConnected, sendToUser } from './connection.registry';
import type { AuthedSocket } from './connection.registry';

/** In-memory state for one active (ringing or connected) call. */
interface ActiveCall {
  callerId: number;
  /** Target user for 1:1 calls; conversations are handled without miss tracking. */
  calleeId?: number;
  conversationId?: number;
  type: 'voice' | 'video';
  /** Users who accepted (besides the caller) — the participants of the call. */
  accepted: Set<number>;
}

export interface RtcRelayEvent {
  callId?: string;
  /** The participant this SDP/ICE signal is meant for. */
  targetUserId?: number;
  sdp?: unknown;
  candidate?: unknown;
}

export interface CallStartEvent {
  callId?: string;
  targetId?: number;
  targetType?: 'user' | 'conversation';
  /** 'voice' | 'video' — never the envelope `type` (which is the event name). */
  mediaType?: 'voice' | 'video';
}

export interface CallRespondEvent {
  callId?: string;
  callerUserId?: number;
}

export interface CallEndEvent {
  callId?: string;
  targetId?: number;
  targetType?: 'user' | 'conversation';
}

const now = (): string => new Date().toISOString();

export class CallHandler {
  /** Live calls by callId, so acceptance can be tracked for missed-call notices. */
  private activeCalls = new Map<string, ActiveCall>();

  constructor(
    private userRepository: UserRepository,
    private conversationRepository: ConversationRepository,
    private notificationRepository: NotificationRepository,
    private notificationPreferences?: NotificationPreferenceService | null,
  ) {}

  private error(ws: AuthedSocket, message: string): void {
    ws.send(JSON.stringify({ type: 'error', message }));
  }

  /**
   * call_start — the caller rings a user or a whole conversation. Everyone
   * connected in the target (except the caller) receives an incoming_call
   * event. A user target that is offline gets a call_unavailable reply so the
   * caller's UI can say "unavailable" instead of ringing forever.
   */
  async handleCallStart(ws: AuthedSocket, event: CallStartEvent): Promise<void> {
    try {
      const { callId, targetId, targetType = 'user' } = event;
      const type = event.mediaType || 'voice';

      if (!callId || !targetId) {
        this.error(ws, 'Missing required fields: callId, targetId');
        return;
      }

      const caller = await this.userRepository.findById(ws.userId);
      const callerName = caller ? `${caller.first_name} ${caller.last_name}`.trim() : 'User';
      const callerStatus = caller?.status || 'online';

      if (targetType === 'conversation') {
        const conversation = await this.conversationRepository.findById(targetId);
        if (!conversation) {
          this.error(ws, 'Conversation not found');
          return;
        }

        // Same access rules as messaging: team conversations are restricted to
        // team members + privileged roles; everything else needs membership.
        const canAccess =
          conversation.type === 'team'
            ? await this.conversationRepository.canAccessTeamConversation(
                conversation.name || '',
                ws.userId,
              )
            : await this.conversationRepository.isMember(targetId, ws.userId);
        if (!canAccess) {
          this.error(ws, 'You are not a member of this conversation');
          return;
        }

        const isGroup = conversation.type !== 'direct';
        const convName =
          conversation.type === 'channel'
            ? `#${conversation.name}`
            : conversation.name || 'Conversation';

        this.activeCalls.set(callId, {
          callerId: ws.userId,
          conversationId: targetId,
          type,
          accepted: new Set(),
        });

        const memberIds = await this.conversationRepository.findMemberIds(targetId);
        for (const memberId of memberIds) {
          const userId = Number(memberId);
          if (userId === Number(ws.userId)) continue;
          if (!isUserConnected(userId)) continue;
          sendToUser(userId, {
            type: 'incoming_call',
            data: {
              callId,
              callerUserId: ws.userId,
              callerName,
              callerStatus,
              type,
              conversationId: targetId,
              conversationName: convName,
              isGroup,
              memberCount: memberIds.length,
            },
            timestamp: now(),
          });
        }
        console.log(
          `📞 User ${ws.userId} started a ${type} call for conversation ${targetId} (${memberIds.length} members)`,
        );
        return;
      }

      // User target (1:1 call).
      const target = await this.userRepository.findById(targetId);
      if (!target) {
        this.error(ws, 'User not found');
        return;
      }

      this.activeCalls.set(callId, {
        callerId: ws.userId,
        calleeId: targetId,
        type,
        accepted: new Set(),
      });

      if (!isUserConnected(targetId)) {
        console.log(`📞 User ${ws.userId} called ${targetId} — offline`);
        // The callee was unreachable — record the miss so they see a badge
        // when they come back online.
        await this.recordMissedCall({
          callId,
          calleeId: targetId,
          callerId: ws.userId,
          callerName,
          type,
        });
        sendToUser(ws.userId, {
          type: 'call_unavailable',
          data: { callId },
          timestamp: now(),
        });
        return;
      }
      sendToUser(targetId, {
        type: 'incoming_call',
        data: {
          callId,
          callerUserId: ws.userId,
          callerName,
          callerStatus,
          type,
          isGroup: false,
        },
        timestamp: now(),
      });
      console.log(`📞 User ${ws.userId} is calling user ${targetId} (${type})`);
    } catch (error) {
      console.error('Error in handleCallStart:', (error as Error).message);
      this.error(ws, 'Failed to start call: ' + (error as Error).message);
    }
  }

  /** call_accept — the callee picked up; tell the caller it is connected. */
  async handleCallAccept(ws: AuthedSocket, event: CallRespondEvent): Promise<void> {
    try {
      const { callId, callerUserId } = event;
      if (!callId || !callerUserId) {
        this.error(ws, 'Missing required fields: callId, callerUserId');
        return;
      }
      const callee = await this.userRepository.findById(ws.userId);
      const calleeName = callee ? `${callee.first_name} ${callee.last_name}`.trim() : 'User';
      const entry = this.activeCalls.get(callId);
      if (entry) entry.accepted.add(Number(ws.userId));
      sendToUser(Number(callerUserId), {
        type: 'call_accepted',
        data: { callId, calleeUserId: ws.userId, calleeName },
        timestamp: now(),
      });
      // The participant set changed — announce it so every participant can
      // build (or extend) its WebRTC mesh.
      if (entry) await this.broadcastParticipants(callId);
    } catch (error) {
      console.error('Error in handleCallAccept:', (error as Error).message);
      this.error(ws, 'Failed to accept call: ' + (error as Error).message);
    }
  }

  /** call_decline — the callee rejected; tell the caller it was declined. */
  async handleCallDecline(ws: AuthedSocket, event: CallRespondEvent): Promise<void> {
    try {
      const { callId, callerUserId } = event;
      if (!callId || !callerUserId) {
        this.error(ws, 'Missing required fields: callId, callerUserId');
        return;
      }
      const callee = await this.userRepository.findById(ws.userId);
      const calleeName = callee ? `${callee.first_name} ${callee.last_name}`.trim() : 'User';
      // Declining is deliberate — no missed-call notice. For a 1:1 call the
      // call record is retired; in a group call the rest keep talking, so the
      // shared record stays until the caller ends it.
      const entry = this.activeCalls.get(callId);
      if (entry && !entry.conversationId) this.activeCalls.delete(callId);
      sendToUser(Number(callerUserId), {
        type: 'call_declined',
        data: { callId, calleeUserId: ws.userId, calleeName },
        timestamp: now(),
      });
    } catch (error) {
      console.error('Error in handleCallDecline:', (error as Error).message);
      this.error(ws, 'Failed to decline call: ' + (error as Error).message);
    }
  }

  /**
   * call_end — either side hangs up (or the caller's ring times out). Notify
   * the other participant(s) so their UI closes too.
   */
  async handleCallEnd(ws: AuthedSocket, event: CallEndEvent): Promise<void> {
    try {
      const { callId, targetId, targetType = 'user' } = event;
      if (!callId) {
        this.error(ws, 'Missing required field: callId');
        return;
      }

      const ended = { type: 'call_ended', data: { callId }, timestamp: now() };

      if (targetType === 'conversation' && targetId) {
        const entry = this.activeCalls.get(callId);
        const memberIds = await this.conversationRepository.findMemberIds(targetId);
        if (entry && entry.callerId === Number(ws.userId)) {
          // The caller hung up → the whole call ends for every member, and
          // the shared call record is retired.
          this.activeCalls.delete(callId);
          for (const memberId of memberIds) {
            const userId = Number(memberId);
            if (userId === Number(ws.userId)) continue;
            sendToUser(userId, ended);
          }
        } else if (entry) {
          // A member hanging up just leaves the call — the record stays so
          // the caller can still end it for everyone later, but the mesh
          // needs the updated participant list.
          entry.accepted.delete(Number(ws.userId));
          await this.broadcastParticipants(callId);
        }
        return;
      }

      // 1:1 call ended — if it was never accepted, the callee missed it.
      const entry = this.activeCalls.get(callId);
      this.activeCalls.delete(callId);
      if (entry && entry.calleeId && entry.accepted.size === 0) {
        const caller = await this.userRepository.findById(entry.callerId);
        await this.recordMissedCall({
          callId,
          calleeId: entry.calleeId,
          callerId: entry.callerId,
          callerName: caller ? `${caller.first_name} ${caller.last_name}`.trim() : 'User',
          type: entry.type,
        });
      }

      if (targetId && Number(targetId) !== Number(ws.userId)) {
        sendToUser(Number(targetId), ended);
      }
    } catch (error) {
      console.error('Error in handleCallEnd:', (error as Error).message);
      this.error(ws, 'Failed to end call: ' + (error as Error).message);
    }
  }

  /**
   * Tell every current participant who is in the call, so the client mesh can
   * create a peer connection to each other participant. Sent whenever the
   * participant set changes (someone accepts or leaves).
   */
  private async broadcastParticipants(callId: string): Promise<void> {
    const entry = this.activeCalls.get(callId);
    if (!entry) return;
    const caller = await this.userRepository.findById(entry.callerId);
    const callerName = caller ? `${caller.first_name} ${caller.last_name}`.trim() : 'User';
    const participants: Array<{ userId: number; name: string; isCaller: boolean }> = [
      { userId: entry.callerId, name: callerName, isCaller: true },
    ];
    for (const userId of entry.accepted) {
      const u = await this.userRepository.findById(Number(userId));
      participants.push({
        userId: Number(userId),
        name: u ? `${u.first_name} ${u.last_name}`.trim() : 'User',
        isCaller: false,
      });
    }
    const payload = {
      type: 'call_participants',
      data: { callId, participants },
      timestamp: now(),
    };
    for (const p of participants) sendToUser(p.userId, payload);
  }

  /**
   * webrtc_offer / webrtc_answer / webrtc_ice — relay SDP and ICE candidates
   * between two participants of a live call. The server never interprets the
   * payload; it only checks that both ends belong to the call.
   */
  private async handleRtcRelay(
    ws: AuthedSocket,
    event: RtcRelayEvent,
    kind: 'webrtc_offer' | 'webrtc_answer' | 'webrtc_ice',
  ): Promise<void> {
    try {
      const { callId, targetUserId } = event;
      if (!callId || !targetUserId) {
        this.error(ws, 'Missing required fields: callId, targetUserId');
        return;
      }
      const entry = this.activeCalls.get(callId);
      const target = Number(targetUserId);
      const isParticipant =
        !!entry && (target === Number(entry.callerId) || entry.accepted.has(target));
      if (!isParticipant) {
        this.error(ws, 'Target is not in this call');
        return;
      }
      const data: Record<string, unknown> = { callId, targetUserId: ws.userId };
      if (kind === 'webrtc_offer' || kind === 'webrtc_answer') data.sdp = event.sdp;
      else data.candidate = event.candidate;
      sendToUser(target, { type: kind, data, timestamp: now() });
    } catch (error) {
      console.error(`Error in ${kind}:`, (error as Error).message);
      this.error(ws, `Failed to relay ${kind}: ` + (error as Error).message);
    }
  }

  async handleRtcOffer(ws: AuthedSocket, event: RtcRelayEvent): Promise<void> {
    await this.handleRtcRelay(ws, event, 'webrtc_offer');
  }

  async handleRtcAnswer(ws: AuthedSocket, event: RtcRelayEvent): Promise<void> {
    await this.handleRtcRelay(ws, event, 'webrtc_answer');
  }

  async handleRtcIce(ws: AuthedSocket, event: RtcRelayEvent): Promise<void> {
    await this.handleRtcRelay(ws, event, 'webrtc_ice');
  }

  /**
   * Persist a `missed_call` notification for the callee and, if they are
   * online, push a live `notification` event so the bell badge updates.
   */
  private async recordMissedCall(data: {
    callId: string;
    calleeId: number;
    callerId: number;
    callerName: string;
    type: 'voice' | 'video';
  }): Promise<void> {
    const { callId, calleeId, callerId, callerName, type } = data;
    try {
      // Respect the callee's notification preferences (category: calls).
      if (this.notificationPreferences &&
          !(await this.notificationPreferences.isEnabled(calleeId, 'calls'))) {
        return;
      }
      const title = `Missed call from ${callerName}`;
      const message = type === 'video' ? 'Video call' : 'Voice call';
      await this.notificationRepository.create({
        user_id: calleeId,
        actor_id: callerId,
        type: 'missed_call',
        title,
        message,
        data: { callId, callerUserId: callerId, type },
      });
      sendToUser(calleeId, {
        type: 'notification',
        data: { type: 'missed_call', title, message, callId },
        timestamp: now(),
      });
      console.log(`📵 Missed ${type} call recorded for user ${calleeId} from ${callerName}`);
    } catch (error) {
      // A missed-call notice must never break call signaling.
      console.error('[CallHandler] Failed to record missed call:', (error as Error).message);
    }
  }
}
