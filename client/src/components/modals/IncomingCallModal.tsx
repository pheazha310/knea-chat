import React, { useEffect } from 'react';
import Icon from '../common/Icon';
import { useCallStore } from '../../store/callStore';
import type { CallSession } from '../../store/callStore';

/** How long the incoming ring plays before the call is treated as missed. */
const RING_TIMEOUT_MS = 30000;

interface IncomingCallModalProps {
  call: CallSession;
}

const IncomingCallModal = ({ call }: IncomingCallModalProps) => {
  const accept = useCallStore((s) => s.accept);
  const decline = useCallStore((s) => s.decline);
  const missed = useCallStore((s) => s.missed);

  // Nobody answered before the ring timed out — end the call so the server
  // records a missed-call notification (vs. a deliberate decline).
  useEffect(() => {
    const t = window.setTimeout(missed, RING_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [missed]);

  const isVideo = call.type === 'video';
  // Group calls are named "#general" — show the channel letter, not the '#',
  // as the avatar initial (avoiding a "##general" look).
  const avatarInitial = call.name.replace(/^#/, '').charAt(0).toUpperCase() || '#';

  return (
    <div className="call-overlay incoming anim-overlay-in" onClick={decline}>
      <div className="incoming-call-card anim-pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="incoming-ring">
          <span className="incoming-avatar">{avatarInitial}</span>
        </div>
        <h2>{call.name}</h2>
        <p className="incoming-subtitle">
          {call.isGroup ? (
            <>
              Incoming {isVideo ? 'video' : 'voice'} call ·{' '}
              {call.memberCount ?? call.members?.length ?? 0} members
            </>
          ) : (
            <>Incoming {isVideo ? 'video' : 'voice'} call…</>
          )}
        </p>
        <div className="incoming-actions">
          <button
            className="incoming-btn incoming-decline"
            onClick={decline}
            title="Decline"
            aria-label="Decline call"
          >
            <Icon name="phone" size={20} />
          </button>
          <button
            className="incoming-btn incoming-accept"
            onClick={accept}
            title="Accept"
            aria-label="Accept call"
          >
            <Icon name={isVideo ? 'video' : 'phone'} size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallModal;
