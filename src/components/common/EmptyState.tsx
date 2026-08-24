import React from 'react';
import Icon, { type IconName } from './Icon';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Friendly empty state with icon, copy, and optional CTA button. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}) => (
  <div className="empty-state" role="status">
    <div className="empty-state-icon">
      <Icon name={icon} size={32} />
    </div>
    <h3>{title}</h3>
    <p>{description}</p>
    {actionLabel && onAction && (
      <button className="empty-action" onClick={onAction}>
        {actionLabel}
      </button>
    )}
  </div>
);
