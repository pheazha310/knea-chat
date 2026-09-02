// callStore — Zustand store for voice/video call signaling.
//
// Owns the two call sessions a client can be in: the call it started
// (`active`, outgoing) and a call being offered to it (`incoming`, ringing).
// All state changes are driven by WebSocket events dispatched here from
// wsListeners.ts; outgoing commands are sent over the same socket.
//
// Media is NOT part of this store — the modals capture the local camera/mic
// directly (matching the app's simulated-call design). The signaling events
// make calls real between users: B now sees A's ring and can accept/decline.
import { create } from 'zustand';
import { wsService } from '../services/websocket';
import type { WsEventMap } from '../services/websocket';
import { WebRTCManager } from '../services/webrtc';
import type { RtcParticipant } from '../services/webrtc';
import { useAuthStore } from './authStore';

export interface CallParticipant {
  id: number;
  first_name?: string;
  last_name?: string;
  status?: string;
}

export type CallType = 'voice' | 'video';
export type CallDirection = 'outgoing' | 'incoming';
export type CallState = 'ringing' | 'connected' | 'declined' | 'unavailable' | 'no_answer' | 'ended';

export interface CallSession {
  callId: string;
  direction: CallDirection;
  type: CallType;
  /** Display name — the other user, or #channel / team name for group calls. */
  name: string;
  /** Other user's presence status (1:1 calls). */
  status?: string;
  isGroup: boolean;
  /** Conversation members shown as participants on group calls. */
  members?: CallParticipant[];
  /** Total conversation member count (sent with the incoming ring). */
  memberCount?: number;
  state: CallState;
  /** User id (1:1) or conversation id (group) the call targets. */
  targetId: number;
  targetType: 'user' | 'conversation';
  /** Caller's user id — set on incoming calls. */
  callerUserId?: number;
  /** Conversation to message during the call (DM id for 1:1, conv id for group). */
  conversationId?: number;
}

export interface StartCallTarget {
  type: CallType;
  targetId: number;
  targetType: 'user' | 'conversation';
  name: string;
  status?: string;
  isGroup?: boolean;
  members?: CallParticipant[];
  /** Conversation to message during the call (defaults to targetId). */
  conversationId?: number;
}

interface CallStateShape {
  /** The call this client is participating in (outgoing, or accepted incoming). */
  active: CallSession | null;
  /** A call being offered to this client (ringing). */
  incoming: CallSession | null;
  /** WebRTC mesh for the active call (created when media starts). */
  rtc: WebRTCManager | null;
  /** Bumped whenever RTC state changes so the modals re-render remote media. */
  rtcTick: number;

  startCall: (target: StartCallTarget) => void;
  handleIncoming: (payload: WsEventMap['incoming_call']['data']) => void;
  /** Accept the ringing incoming call. */
  accept: () => void;
  /** Decline the ringing incoming call. */
  decline: () => void;
  /** Incoming ring timed out unanswered — report the call as missed. */
  missed: () => void;
  handleAccepted: (payload: WsEventMap['call_accepted']['data']) => void;
  handleDeclined: (payload: WsEventMap['call_declined']['data']) => void;
  handleUnavailable: (payload: WsEventMap['call_unavailable']['data']) => void;
  handleEnded: (payload: WsEventMap['call_ended']['data']) => void;
  /** Start the local media + WebRTC mesh for the active call. */
  startRtc: () => void;
  handleParticipants: (payload: WsEventMap['call_participants']['data']) => void;
  handleRtcOffer: (payload: WsEventMap['webrtc_offer']['data']) => void;
  handleRtcAnswer: (payload: WsEventMap['webrtc_answer']['data']) => void;
  handleRtcIce: (payload: WsEventMap['webrtc_ice']['data']) => void;
  /** Hang up the active call. */
  endCall: () => void;
  /** Outgoing ring timed out with no answer. */
  noAnswer: () => void;
  /** Start sharing the screen in the active call. */
  startScreenShare: () => Promise<void>;
  /** Stop sharing the screen. */
  stopScreenShare: () => Promise<void>;
  clear: () => void;
}

const newCallId = (): string =>
  `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Clear a session after a delay, only if it is still the same call. */
const clearAfter = (
  get: () => CallStateShape,
  set: (partial: Partial<CallStateShape>) => void,
  key: 'active' | 'incoming',
  callId: string,
  ms: number,
): void => {
  setTimeout(() => {
    if (get()[key]?.callId === callId) set({ [key]: null });
  }, ms);
};

export const useCallStore = create<CallStateShape>()((set, get) => {
  /** Stop media + close the WebRTC mesh, if one is running. */
  const teardownRtc = () => {
    const { rtc } = get();
    if (!rtc) return;
    rtc.destroy();
    set((state) => ({ rtc: null, rtcTick: state.rtcTick + 1 }));
  };

  /** Create the WebRTC mesh for the active call (idempotent). */
  const startRtc = () => {
    if (get().rtc) return;
    const active = get().active;
    const me = useAuthStore.getState().user?.id;
    if (!active || me === undefined || me === null) return;
    const rtc = new WebRTCManager(
      active.callId,
      me,
      active.type,
      (type, data) => wsService.send(type, data),
    );
    rtc.setChangeListener(() => {
      set((state) => ({ rtcTick: state.rtcTick + 1 }));
    });
    set({ rtc, rtcTick: Date.now() });
  };

  return {
  active: null,
  incoming: null,
  rtc: null,
  rtcTick: 0,

  startCall: (target) => {
    const callId = newCallId();
    // NOTE: the media type is sent as `mediaType`, never `type` — the WS
    // envelope uses `type` for the event name (call_start) and wsService.send
    // spreads data over it, so a `type` key here would clobber the event.
    wsService.send('call_start', {
      callId,
      targetId: target.targetId,
      targetType: target.targetType,
      mediaType: target.type,
    });
    set({
      active: {
        callId,
        direction: 'outgoing',
        type: target.type,
        name: target.name,
        status: target.status,
        isGroup: !!target.isGroup,
        members: target.members,
        state: 'ringing',
        targetId: target.targetId,
        targetType: target.targetType,
        conversationId: target.conversationId ?? target.targetId,
      },
    });
    // Acquire local media up front so the preview shows while ringing and the
    // stream is ready when the callee accepts.
    startRtc();
  },

  handleIncoming: (payload) => {
    const isGroup = !!payload.isGroup;
    set({
      incoming: {
        callId: payload.callId,
        direction: 'incoming',
        type: payload.type,
        name: isGroup ? payload.conversationName || 'Conversation' : payload.callerName,
        status: payload.callerStatus,
        isGroup,
        memberCount: payload.memberCount,
        state: 'ringing',
        targetId: payload.conversationId || payload.callerUserId,
        targetType: isGroup ? 'conversation' : 'user',
        callerUserId: payload.callerUserId,
        // Group calls carry the conversation; 1:1 incoming calls resolve the
        // DM lazily in the chat panel.
        conversationId: payload.conversationId || undefined,
      },
    });
  },

  accept: () => {
    const incoming = get().incoming;
    if (!incoming) return;
    wsService.send('call_accept', {
      callId: incoming.callId,
      callerUserId: incoming.callerUserId,
    });
    set({
      active: { ...incoming, direction: 'incoming', state: 'connected' },
      incoming: null,
    });
    // The callee's camera/mic only turns on once they accept the call.
    startRtc();
  },

  decline: () => {
    const incoming = get().incoming;
    if (!incoming) return;
    wsService.send('call_decline', {
      callId: incoming.callId,
      callerUserId: incoming.callerUserId,
    });
    set({ incoming: null });
  },

  missed: () => {
    const incoming = get().incoming;
    if (!incoming) return;
    // Ending (not declining) the call tells the server nobody answered, so it
    // records a missed-call notification for us.
    wsService.send('call_end', {
      callId: incoming.callId,
      targetId: incoming.targetId,
      targetType: incoming.targetType,
    });
    set({ incoming: null });
  },

  handleAccepted: (payload) => {
    const active = get().active;
    if (!active || active.callId !== payload.callId) return;
    set({ active: { ...active, state: 'connected' } });
  },

  handleDeclined: (payload) => {
    const active = get().active;
    if (!active || active.callId !== payload.callId) return;
    // Group calls: one member declining must not end the call for everyone —
    // only the decliner leaves (their own UI closes in `decline`).
    if (active.isGroup) return;
    teardownRtc();
    set({ active: { ...active, state: 'declined' } });
    clearAfter(get, set, 'active', payload.callId, 2000);
  },

  handleUnavailable: (payload) => {
    const active = get().active;
    if (!active || active.callId !== payload.callId) return;
    teardownRtc();
    set({ active: { ...active, state: 'unavailable' } });
    clearAfter(get, set, 'active', payload.callId, 2000);
  },

  handleEnded: (payload) => {
    const active = get().active;
    if (active && active.callId === payload.callId) {
      teardownRtc();
      set({ active: { ...active, state: 'ended' } });
      clearAfter(get, set, 'active', payload.callId, 400);
      return;
    }
    const incoming = get().incoming;
    if (incoming && incoming.callId === payload.callId) {
      // The caller hung up while we were still ringing.
      set({ incoming: null });
    }
  },

  startRtc,

  handleParticipants: (payload) => {
    const active = get().active;
    if (!active || active.callId !== payload.callId) return;
    startRtc();
    get().rtc?.setParticipants(payload.participants);
  },

  handleRtcOffer: (payload) => {
    const active = get().active;
    if (!active || active.callId !== payload.callId) return;
    startRtc();
    void get().rtc?.handleOffer(payload.targetUserId, payload.sdp);
  },

  handleRtcAnswer: (payload) => {
    const active = get().active;
    if (!active || active.callId !== payload.callId) return;
    startRtc();
    void get().rtc?.handleAnswer(payload.targetUserId, payload.sdp);
  },

  handleRtcIce: (payload) => {
    const active = get().active;
    if (!active || active.callId !== payload.callId) return;
    startRtc();
    get().rtc?.handleIce(payload.targetUserId, payload.candidate);
  },

  endCall: () => {
    const active = get().active;
    if (active) {
      teardownRtc();
      wsService.send('call_end', {
        callId: active.callId,
        targetId: active.targetId,
        targetType: active.targetType,
      });
      set({ active: { ...active, state: 'ended' } });
      clearAfter(get, set, 'active', active.callId, 400);
      return;
    }
    // No active call — decline any ringing call instead.
    get().decline();
  },

  noAnswer: () => {
    const active = get().active;
    if (!active) return;
    teardownRtc();
    wsService.send('call_end', {
      callId: active.callId,
      targetId: active.targetId,
      targetType: active.targetType,
    });
    set({ active: { ...active, state: 'no_answer' } });
    clearAfter(get, set, 'active', active.callId, 2000);
  },

  startScreenShare: async () => {
    const rtc = get().rtc;
    if (!rtc) return;
    await rtc.startScreenShare();
  },
  stopScreenShare: async () => {
    const rtc = get().rtc;
    if (!rtc) return ; 
    await rtc.stopScreenShare();
  },

  clear: () => {
    teardownRtc();
    set({ active: null, incoming: null });
  },
  };
});
