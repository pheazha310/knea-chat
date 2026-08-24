import React, { useEffect, useRef, useState } from "react";
import Icon from "../common/Icon";
import { useCallStore } from "../../store/callStore";
import type { CallSession } from "../../store/callStore";
import CallChatPanel from "./CallChatPanel";

/** How long an unanswered outgoing call rings before giving up. */
const RING_TIMEOUT_MS = 30000;

interface CallModalProps {
  call: CallSession;
}

const initialsOf = (p: { first_name?: string; last_name?: string }) =>
  `${p.first_name?.[0] || ""}${p.last_name?.[0] || ""}`.trim().toUpperCase() ||
  "?";

/** Attach a MediaStream to a media element (the JSX types lack `srcObject`). */
const setSrcObject = (
  el: HTMLMediaElement | null,
  stream: MediaStream | null,
) => {
  if (el) el.srcObject = stream;
};

const CallModal = ({ call }: CallModalProps) => {
  const endCall = useCallStore((s) => s.endCall);
  const noAnswer = useCallStore((s) => s.noAnswer);
  const rtc = useCallStore((s) => s.rtc);
  // Re-render whenever WebRTC state changes (remote streams arrive, etc.).
  useCallStore((s) => s.rtcTick);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const isScreenSharing = rtc?.screenStream !== null;

  const timerRef = useRef<number | null>(null);

  const isVideo = call.type === "video";
  const isRinging = call.state === "ringing";
  const isConnected = call.state === "connected";

  // Local camera/mic (acquired by the WebRTC manager) and the remote streams
  // that have actually connected.
  const localStream = rtc?.localStream ?? null;
  const remoteStreams = (rtc?.remotePeers() ?? [])
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      stream: rtc.getRemoteStream(p.userId),
    }))
    .filter(
      (r): r is { userId: number; name: string; stream: MediaStream } =>
        r.stream !== null,
    );

  // Group calls show up to 6 participants (the rest collapse into a +N chip).
  const participants =
    call.isGroup && call.members ? call.members.slice(0, 6) : [];
  const extraParticipants =
    call.isGroup && call.members && call.members.length > 6
      ? call.members.length - 6
      : 0;

  // Outgoing ring: give up after RING_TIMEOUT_MS with no answer.
  useEffect(() => {
    if (!(call.direction === "outgoing" && isRinging)) return;
    const t = window.setTimeout(noAnswer, RING_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [call.direction, isRinging, noAnswer]);

  // Connected: run the duration clock.
  useEffect(() => {
    if (!isConnected) return;
    timerRef.current = window.setInterval(() => {
      setCallDuration((s) => s + 1);
    }, 1000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [isConnected]);

  const toggleMute = () => {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  const toggleCamera = () => {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      await useCallStore.getState().stopScreenShare();
    } else {
      await useCallStore.getState().startScreenShare();
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const statusText = () => {
    if (isConnected) return formatDuration(callDuration);
    switch (call.state) {
      case "declined":
        return "Call declined";
      case "unavailable":
        return "Unavailable";
      case "no_answer":
        return "No answer";
      case "ended":
        return "Call ended";
      default:
        return call.isGroup ? "Calling everyone…" : "Calling…";
    }
  };

  const participantStack = (
    <div className="call-avatar-stack">
      {participants.map((p) => (
        <span
          key={p.id}
          className="call-avatar-mini"
          title={`${p.first_name || ""} ${p.last_name || ""}`.trim()}
        >
          {initialsOf(p)}
          <i className={p.status || "offline"} />
        </span>
      ))}
      {extraParticipants > 0 && (
        <span className="call-avatar-mini call-avatar-more">
          +{extraParticipants}
        </span>
      )}
    </div>
  );

  return (
    <div className="call-overlay anim-overlay-in" onClick={endCall}>
      <div
        className={`call-modal anim-modal-in${chatOpen ? " call-chat-open" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Main view */}
        <div className={`call-stage ${isVideo ? "video" : "audio"}`}>
          {isVideo ? (
            call.isGroup ? (
              <div className="call-stage-group">
                {participantStack}
                <h3>{call.name}</h3>
                <p className="call-status-text">{statusText()}</p>
                <div className="call-video-grid">
                  {remoteStreams.map((r) => (
                    <video
                      key={r.userId}
                      className="call-grid-video"
                      autoPlay
                      playsInline
                      ref={(el) => setSrcObject(el, r.stream)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              // 1:1 video — the remote camera fills the stage; the local
              // preview is the picture-in-picture below.
              <>
                <video
                  className="call-remote-video"
                  autoPlay
                  playsInline
                  ref={(el) =>
                    setSrcObject(el, remoteStreams[0]?.stream ?? null)
                  }
                />
                <span className="call-video-chip">{statusText()}</span>
              </>
            )
          ) : (
            <div className="call-audio-stage">
              {call.isGroup && participants.length > 0 ? (
                participantStack
              ) : (
                <div className="call-avatar-large">
                  <span>{call.name.charAt(0).toUpperCase()}</span>
                  <i className={call.status || "offline"} />
                </div>
              )}
              <h3>{call.name}</h3>
              <p className="call-status-text">{statusText()}</p>
              {remoteStreams.map((r) => (
                <audio
                  key={r.userId}
                  autoPlay
                  ref={(el) => setSrcObject(el, r.stream)}
                />
              ))}
            </div>
          )}

          {/* Local picture-in-picture (video calls) */}
          {isVideo && localStream && isConnected && (
            <div className="call-pip">
              <video
                className="call-local-video"
                autoPlay
                playsInline
                muted
                ref={(el) => setSrcObject(el, localStream)}
              />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="call-controls">
          <button
            className={`call-btn ${isMuted ? "active" : ""}`}
            onClick={toggleMute}
            disabled={!isConnected}
            title={isMuted ? "Unmute" : "Mute"}
          >
            <Icon name="mic" size={18} />
            {isMuted && <span className="call-btn-badge">off</span>}
          </button>

          {isVideo && (
            <button
              className={`call-btn ${isCameraOff ? "active" : ""}`}
              onClick={toggleCamera}
              disabled={!isConnected}
              title={isCameraOff ? "Turn camera on" : "Turn camera off"}
            >
              <Icon name="video" size={18} />
              {isCameraOff && <span className="call-btn-badge">off</span>}
            </button>
          )}

          {isVideo && (
            <button
              className={`call-btn ${isScreenSharing ? "active" : ""}`}
              onClick={toggleScreenShare}
              disabled={!isConnected}
              title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
            >
              <Icon name="screen" size={18} />
              {isScreenSharing && <span className="call-btn-badge">on</span>}
            </button>
          )}

          <button
            className={`call-btn ${chatOpen ? "active" : ""}`}
            onClick={() => setChatOpen((v) => !v)}
            title={chatOpen ? "Hide chat" : "Chat"}
          >
            <Icon name="message" size={18} />
          </button>

          <button
            className="call-btn call-btn-end"
            onClick={endCall}
            title="End call"
          >
            <Icon name="phone" size={18} />
          </button>
        </div>

        {chatOpen && <CallChatPanel call={call} />}
      </div>
    </div>
  );
};

export default CallModal;
