// ReactionBar — the shared emoji-reaction widget.
//
// Renders the current reaction chips (emoji + count, reactor names on hover)
// and a React affordance that opens the same 6-emoji quick set as the chat
// hover bar, plus an "all emoji" grid with search + category tabs for the
// wider catalog. Picking an emoji toggles the caller's reaction (add when the
// current user hasn't placed it, remove when they have) through `onToggle`,
// which must resolve with the fresh reaction list from the server.
//
// Used by message notification rows, announcement cards and task details so
// reactions behave identically everywhere.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import type { Reaction } from '../../models';
import {
  QUICK_REACTIONS,
  EMOJI_CATEGORIES,
  searchEmojis,
} from '../../utils/emoji';
import {
  groupReactions,
  reactionSummary,
} from '../../utils/reactions';

export type ReactionToggleHandler = (
  emoji: string,
  mine: boolean,
) => Promise<Reaction[] | null>;

interface ReactionBarProps {
  /** Current reaction rows for the target (message/announcement/task). */
  reactions?: Reaction[];
  /** Signed-in user id — drives the `mine` state on chips. */
  meId?: number | null;
  /** Toggle a reaction; resolves with the fresh list (null = failed). */
  onToggle: ReactionToggleHandler;
  /** Extra a11y context for the trigger, e.g. "React to the announcement". */
  label?: string;
  /** Called with the fresh list after every successful toggle. */
  onChanged?: (reactions: Reaction[]) => void;
}

const ReactionBar = ({
  reactions = [],
  meId = null,
  onToggle,
  label = 'React',
  onChanged,
}: ReactionBarProps) => {
  const [quickOpen, setQuickOpen] = useState(false);
  const [wideOpen, setWideOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const groups = useMemo(
    () => groupReactions(reactions, meId),
    [reactions, meId],
  );

  const isMine = (emoji: string): boolean =>
    groups.some((g) => g.emoji === emoji && g.mine);

  const toggle = async (emoji: string) => {
    if (busy) return;
    const mine = isMine(emoji);
    setBusy(true);
    setError(null);
    const fresh = await onToggle(emoji, mine);
    setBusy(false);
    if (fresh === null) {
      setError('Could not react — try again.');
      return;
    }
    if (!mine) {
      setFlash(emoji);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 2500);
    }
    onChanged?.(fresh);
    setQuickOpen(false);
    setWideOpen(false);
  };

  const toggleQuick = () => {
    setQuickOpen((v) => !v);
    setWideOpen(false);
    setError(null);
  };

  /** Open the full catalog — it replaces the quick row (no label overlap). */
  const toggleWide = () => {
    setWideOpen((v) => !v);
    setQuickOpen(false);
    setError(null);
  };

  const closeWide = () => {
    setWideOpen(false);
    setError(null);
  };

  return (
    <div className="reactbar" aria-label={label}>
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          className={`reactbar-chip ${group.mine ? 'mine' : ''}`}
          disabled={busy}
          onClick={() => void toggle(group.emoji)}
          title={reactionSummary(group)}
          aria-label={
            group.mine
              ? `Remove your ${group.emoji} reaction`
              : `React ${group.emoji}`
          }
        >
          <span className="reactbar-chip-emoji">{group.emoji}</span>
          {group.count > 1 && (
            <span className="reactbar-chip-count">{group.count}</span>
          )}
        </button>
      ))}

      {!quickOpen && !wideOpen && (
        <button
          type="button"
          className="reactbar-toggle"
          onClick={toggleQuick}
          aria-expanded={quickOpen}
          aria-label={label}
        >
          <Icon name="emoji" size={12} />
          React
        </button>
      )}

      {quickOpen && !wideOpen && (
        <div className="reactbar-quick" aria-label="Emoji reactions">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={isMine(emoji) ? 'mine' : ''}
              disabled={busy}
              onClick={() => void toggle(emoji)}
              aria-label={isMine(emoji) ? `Remove ${emoji}` : `React ${emoji}`}
              title={isMine(emoji) ? `Remove ${emoji}` : `React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            className="reactbar-wide-trigger"
            onClick={toggleWide}
            aria-expanded={wideOpen}
            aria-label="More reactions"
            title="More reactions"
          >
            <Icon name="grid" size={12} />
          </button>
          <button
            type="button"
            className="reactbar-close"
            onClick={toggleQuick}
            aria-label="Close reaction picker"
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      {wideOpen && (
        <WideEmojiGrid onSelect={(emoji) => void toggle(emoji)} onClose={closeWide} />
      )}

      {flash && (
        <span className="reactbar-sent">
          <Icon name="check" size={12} /> {flash} Reacted
        </span>
      )}
      {error && <span className="reactbar-error">{error}</span>}
    </div>
  );
};

/** Full catalog picker (search + category tabs) used by the "more" button. */
const WideEmojiGrid = ({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const emojis = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term) {
      // Match the emoji itself (literal search), like the composer picker.
      const seen = new Set<string>();
      return searchEmojis(term).filter((e) => !seen.has(e) && seen.add(e));
    }
    return EMOJI_CATEGORIES[activeCategory]?.emojis || [];
  }, [search, activeCategory]);

  return (
    <div className="reactbar-wide" role="dialog" aria-label="All emoji">
      <div className="reactbar-wide-search">
        <Icon name="search" size={13} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search emoji…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search emoji"
        />
        <button type="button" onClick={onClose} aria-label="Close emoji picker">
          <Icon name="x" size={13} />
        </button>
      </div>
      {!search.trim() && (
        <div className="reactbar-wide-tabs" role="tablist">
          {EMOJI_CATEGORIES.map((category, index) => (
            <button
              key={category.name}
              type="button"
              role="tab"
              aria-selected={index === activeCategory}
              aria-label={category.name}
              className={index === activeCategory ? 'active' : ''}
              onClick={() => setActiveCategory(index)}
              title={category.name}
            >
              {category.icon}
            </button>
          ))}
        </div>
      )}
      <div className="reactbar-wide-grid" role="grid">
        {emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="reactbar-wide-item"
            onClick={() => onSelect(emoji)}
            aria-label={`React ${emoji}`}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
        {emojis.length === 0 && (
          <div className="reactbar-wide-empty">No emoji found</div>
        )}
      </div>
    </div>
  );
};

export default ReactionBar;
