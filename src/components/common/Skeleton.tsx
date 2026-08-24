import React from 'react';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  variant?: 'line' | 'circle' | 'rect';
  style?: React.CSSProperties;
}

/** Lightweight skeleton loader — drop-in replacement for loading placeholders. */
export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  width,
  height,
  variant = 'line',
  style,
}) => {
  const baseClass = `skeleton skeleton-line ${className}`;
  const borderRadius = variant === 'circle' ? '50%' : variant === 'rect' ? '8px' : undefined;
  return (
    <div
      className={baseClass}
      style={{ width, height, borderRadius, ...style }}
      aria-hidden="true"
    />
  );
};

/** Pre-built skeleton layout for a message row. */
export const MessageSkeleton: React.FC = () => (
  <div className="skeleton-message" aria-label="Loading messages…" role="status">
    <div className="skeleton skeleton-avatar" />
    <div className="skeleton-body">
      <div className="skeleton skeleton-line w-1/3 h-3" />
      <div className="skeleton skeleton-line w-3/4" />
      <div className="skeleton skeleton-line w-1/2" />
    </div>
  </div>
);

/** Pre-built skeleton layout for a conversation list item. */
export const ConversationSkeleton: React.FC = () => (
  <div className="skeleton-conversation" aria-label="Loading conversations…" role="status">
    <div className="skeleton skeleton-avatar sm" />
    <div className="skeleton-text">
      <div className="skeleton skeleton-line w-2/3 h-3" />
      <div className="skeleton skeleton-line w-1/2 h-3" />
    </div>
  </div>
);

/** Pre-built skeleton for sidebar navigation. */
export const SidebarSkeleton: React.FC = () => (
  <div aria-label="Loading sidebar…" role="status" style={{ padding: '12px 0' }}>
    {[1, 2, 3, 4].map((i) => (
      <div key={i} className="skeleton-conversation">
        <div className="skeleton skeleton-avatar sm" />
        <div className="skeleton-text">
          <div className="skeleton skeleton-line w-2/3 h-3" />
        </div>
      </div>
    ))}
  </div>
);

/** Pre-built skeleton for data tables. */
export const SkeletonTable: React.FC<{ rows?: number; cells?: number }> = ({
  rows = 5,
  cells = 4,
}) => (
  <div className="skeleton-table anim-stagger" role="status" aria-label="Loading table…">
    {Array.from({ length: rows }).map((_, rowIdx) => (
      <div key={rowIdx} className="skeleton-table-row">
        {Array.from({ length: cells }).map((_, cellIdx) => (
          <div
            key={cellIdx}
            className="skeleton skeleton-line"
            style={{
              width: cellIdx === 0 ? '60%' : cellIdx === cells - 1 ? '30%' : '80%',
              height: 14,
            }}
          />
        ))}
      </div>
    ))}
  </div>
);
