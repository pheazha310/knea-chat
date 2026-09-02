import React from 'react';
import type { ConnectionStatus } from '../../services/websocket';

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
  /** Current retry attempt (1-based while reconnecting). */
  attempt?: number;
  maxAttempts?: number;
}

const ConnectionIndicator = ({
  status,
  attempt = 0,
  maxAttempts = 8,
}: ConnectionIndicatorProps) => {
  const retrying = status === 'reconnecting' || (status === 'connecting' && attempt > 0);

  const title =
    status === 'connected'
      ? 'Live connection'
      : retrying
        ? `Reconnecting… (attempt ${attempt}/${maxAttempts})`
        : status === 'connecting'
          ? 'Connecting…'
          : 'Offline — connection failed';

  const showBadge =
    status === 'reconnecting' || status === 'connecting' || status === 'disconnected';

  const badgeLabel = retrying
    ? `Reconnecting… ${attempt}/${maxAttempts}`
    : status === 'connecting'
      ? 'Connecting…'
      : 'Offline';

  if (status === 'connected') {
    return (
      <span className="connection-pill" title={title} aria-live="polite">
        <span className="connection-pill-dot anim-scale-in" />
        <span className="connection-pill-label">Online</span>
      </span>
    );
  }

  return (
    <span className="connection-wrap" title={title} aria-live="polite">
      <span className={`connection ${status} anim-pop-in`} />
      {showBadge && (
        <span className={`reconnect-badge ${status}`}>
          {retrying && <span className="spinner" />}
          {badgeLabel}
        </span>
      )}
    </span>
  );
};

export default ConnectionIndicator;
