// webrtc.ts — WebRTC media for calls.
//
// One WebRTCManager lives per active call session (owned by callStore). It
// acquires the local media stream, then builds a full mesh of peer connections
// — one RTCPeerConnection per other participant. SDP offers/answers and ICE
// candidates are exchanged over the existing WebSocket signaling (relayed by
// the server's call handler), so no media ever touches the server.
//
// Mesh coordination: whenever the server announces the participant list
// (call_participants), each participant ensures a peer connection exists to
// every other participant. For each unordered pair, the participant with the
// LOWER user id creates the offer; the other answers — deterministic, so a
// pair never ends up with two connections.
import type { CallType } from '../store/callStore';

export interface RtcParticipant {
  userId: number;
  name: string;
  isCaller: boolean;
}

/** Sends a signaling event over the existing WebSocket. */
type RtcSend = (
  type: 'webrtc_offer' | 'webrtc_answer' | 'webrtc_ice',
  data: Record<string, unknown>,
) => void;

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

const getMediaStream = (type: CallType): Promise<MediaStream | null> =>
  navigator.mediaDevices
    .getUserMedia({ audio: true, video: type === 'video' })
    .catch(() => null);

export class WebRTCManager {
  localStream: MediaStream | null = null;
  screenStream: MediaStream | null = null;

  private readonly callId: string;
  private readonly myId: number;
  private readonly send: RtcSend;
  private readonly localStreamPromise: Promise<MediaStream | null>;
  private peers = new Map<number, RTCPeerConnection>();
  private remoteStreams = new Map<number, MediaStream>();
  private participantNames = new Map<number, string>();
  private pendingCandidates = new Map<number, RTCIceCandidateInit[]>();
  private otherParticipants: RtcParticipant[] = [];
  private changeListener: (() => void) | null = null;
  private destroyed = false;
  private originalVideoTrack: MediaStreamTrack | null = null;

  constructor(callId: string, myId: number, type: CallType, send: RtcSend) {
    this.callId = callId;
    this.myId = myId;
    this.send = send;
    this.localStreamPromise = getMediaStream(type);
    this.localStreamPromise.then((stream) => {
      if (this.destroyed) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      this.localStream = stream;
      if (stream) {
        this.peers.forEach((pc) => this.addLocalTracks(pc));
      }
      this.emitChange();
    });
  }

  /** React re-render hook — called whenever local/remote streams change. */
  setChangeListener(cb: () => void): void {
    this.changeListener = cb;
  }

  /** Other participants of the call, in announcement order. */
  remotePeers(): RtcParticipant[] {
    return this.otherParticipants;
  }

  getRemoteStream(userId: number): MediaStream | null {
    return this.remoteStreams.get(userId) || null;
  }

  /**
   * Announce the current participant list. Creates peer connections to anyone
   * new and tears down peers who left. The lower user id of each pair sends
   * the offer.
   */
  setParticipants(list: RtcParticipant[]): void {
    if (this.destroyed) return;
    const others = list.filter((p) => p.userId !== this.myId);
    for (const p of others) this.participantNames.set(p.userId, p.name);

    const current = new Set(others.map((p) => p.userId));
    Array.from(this.peers.keys()).forEach((userId) => {
      if (!current.has(userId)) this.removePeer(userId);
    });

    this.otherParticipants = others;
    for (const p of others) {
      void this.ensurePeer(p, this.myId < p.userId);
    }
    this.emitChange();
  }

  /** An SDP offer arrived from `userId` — answer it (creating the PC lazily). */
  async handleOffer(userId: number, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (this.destroyed) return;
    this.participantNames.set(userId, this.participantNames.get(userId) || `User ${userId}`);
    await this.ensurePeer(
      { userId, name: this.participantNames.get(userId) || `User ${userId}`, isCaller: false },
      false,
    );
    const pc = this.peers.get(userId);
    if (!pc) return;
    // The PC may have been created by setParticipants before the camera was
    // ready — wait for local media and add our tracks BEFORE answering, or
    // the answer carries no media and the connection is one-way (the remote
    // hears/sees us but we never receive their stream).
    await this.localStreamPromise;
    if (this.destroyed) return;
    this.addLocalTracks(pc);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.flushPendingCandidates(userId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send('webrtc_answer', {
      callId: this.callId,
      targetUserId: userId,
      sdp: answer,
    });
    this.emitChange();
  }

  async handleAnswer(userId: number, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (this.destroyed) return;
    const pc = this.peers.get(userId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.flushPendingCandidates(userId);
    this.emitChange();
  }

  handleIce(userId: number, candidate: RTCIceCandidateInit): void {
    if (this.destroyed) return;
    // The PC may not exist yet (candidate raced ahead of the offer) — create
    // it on demand. Never offer here; the pair's offerer is fixed by id.
    const pc = this.peers.get(userId);
    if (!pc) {
      const name = this.participantNames.get(userId) || `User ${userId}`;
      void this.ensurePeer({ userId, name, isCaller: false }, false);
    }
    const peer = this.peers.get(userId);
    if (!peer || !peer.remoteDescription) {
      const pending = this.pendingCandidates.get(userId) || [];
      pending.push(candidate);
      this.pendingCandidates.set(userId, pending);
      return;
    }
    void peer.addIceCandidate(candidate).catch(() => {});
  }

  removePeer(userId: number): void {
    const pc = this.peers.get(userId);
    if (pc) pc.close();
    this.peers.delete(userId);
    this.remoteStreams.delete(userId);
    this.pendingCandidates.delete(userId);
    this.otherParticipants = this.otherParticipants.filter((p) => p.userId !== userId);
    this.emitChange();
  }

  /** Close every connection and stop the local media. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.remoteStreams.clear();
    this.pendingCandidates.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    this.originalVideoTrack = null;
    this.emitChange();
  }

  async startScreenShare(): Promise<void> {
    if (this.destroyed || this.screenStream) return;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      this.screenStream = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        screenStream.getTracks().forEach((t) => t.stop());
        this.screenStream = null;
        return;
      }

      if (this.localStream) {
        this.originalVideoTrack = this.localStream.getVideoTracks()[0] || null;
      }

      await Promise.all(
        Array.from(this.peers.values()).map((pc) => {
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (!videoSender) return Promise.resolve();
          return videoSender.replaceTrack(screenTrack).catch((error) => {
            console.error('[webrtc] replaceTrack failed:', (error as Error).message);
          });
        }),
      );

      screenTrack.addEventListener('ended', () => {
        void this.stopScreenShare();
      });

      this.emitChange();
    } catch (error) {
      console.error('[webrtc] startScreenShare failed:', (error as Error).message);
      this.screenStream = null;
    }
  }

  async stopScreenShare(): Promise<void> {
    if (this.destroyed || !this.screenStream) return;

    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    if (this.originalVideoTrack) {
      await Promise.all(
        Array.from(this.peers.values()).map((pc) => {
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (!videoSender) return Promise.resolve();
          return videoSender.replaceTrack(this.originalVideoTrack).catch((error) => {
            console.error('[webrtc] replaceTrack restore failed:', (error as Error).message);
          });
        }),
      );
      this.originalVideoTrack = null;
    }

    this.emitChange();
  }

  private async ensurePeer(
    participant: RtcParticipant,
    shouldOffer: boolean,
  ): Promise<void> {
    if (this.peers.has(participant.userId)) return;
    const pc = this.createPeer(participant.userId, participant.name);
    // Wait for media so the offer/answer carries our tracks. If it never
    // arrives (permission denied), proceed without local media.
    await this.localStreamPromise;
    if (this.destroyed) {
      pc.close();
      this.peers.delete(participant.userId);
      return;
    }
    this.addLocalTracks(pc);
    if (shouldOffer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.send('webrtc_offer', {
          callId: this.callId,
          targetUserId: participant.userId,
          sdp: offer,
        });
      } catch (error) {
        console.error('[webrtc] createOffer failed:', (error as Error).message);
      }
    }
  }

  private createPeer(userId: number, name: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(userId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send('webrtc_ice', {
          callId: this.callId,
          targetUserId: userId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      this.remoteStreams.set(userId, stream);
      this.emitChange();
    };

    pc.onconnectionstatechange = () => this.emitChange();
    return pc;
  }

  private addLocalTracks(pc: RTCPeerConnection): void {
    if (!this.localStream) return;
    const existing = new Set(pc.getSenders().map((s) => s.track?.id));

    for (const track of this.localStream.getTracks()) {
      if (track.kind === 'video' && this.screenStream) {
        const screenTrack = this.screenStream.getVideoTracks()[0];
        if (screenTrack && !existing.has(screenTrack.id)) {
          pc.addTrack(screenTrack, this.screenStream);
        }
      } else if (!existing.has(track.id)) {
        pc.addTrack(track, this.localStream);
      }
    }
  }

  private flushPendingCandidates(userId: number): void {
    const pending = this.pendingCandidates.get(userId) || [];
    this.pendingCandidates.delete(userId);
    const pc = this.peers.get(userId);
    if (!pc) return;
    for (const candidate of pending) {
      void pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  private emitChange(): void {
    this.changeListener?.();
  }
}
