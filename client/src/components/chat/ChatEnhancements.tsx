import React, { useMemo, useState, useRef, useEffect } from 'react';
import Icon from '../common/Icon';
import { EMOJI_CATEGORIES } from '../../utils/emoji';

// ---------------------------------------------------------------------------
// Improved Emoji Picker with search and categories
// ---------------------------------------------------------------------------

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

   const filteredEmojis = useMemo(() => {
    const all = search
      ? EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter((e) =>
          e.toLocaleLowerCase().includes(search.toLowerCase()),
        )
      : EMOJI_CATEGORIES[activeCategory].emojis;
    const seen = new Set<string>();
    return all.filter((e) => !seen.has(e) && seen.add(e));
  }, [search, activeCategory]);

  return (
    <div className="emoji-picker-enhanced" role="dialog" aria-label="Emoji picker">
      <div className="emoji-picker-search">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search emoji…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search emoji"
        />
        <button onClick={onClose} aria-label="Close emoji picker">
          <Icon name="x" size={14} />
        </button>
      </div>
      {!search && (
        <div className="emoji-category-tabs" role="tablist">
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={cat.name}
              role="tab"
              aria-selected={i === activeCategory}
              className={i === activeCategory ? 'active' : ''}
              onClick={() => setActiveCategory(i)}
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-grid-enhanced" role="grid">
        {filteredEmojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            className="emoji-item"
            onClick={() => onSelect(emoji)}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
        {filteredEmojis.length === 0 && (
          <div className="emoji-empty">No emoji found</div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Improved Typing Indicator
// ---------------------------------------------------------------------------

interface TypingIndicatorProps {
  names: string[];
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ names }) => {
  if (names.length === 0) return null;

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names[0]} and ${names.length - 1} others are typing`;

  return (
    <div className="typing-indicator" role="status" aria-live="polite">
      <div className="typing-avatar-stack">
        {names.slice(0, 3).map((name, i) => (
          <span
            key={name}
            className="typing-avatar"
            style={{ animationDelay: `${i * 0.12}s` }}
            title={name}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        ))}
      </div>
      <span className="typing-text">{label}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Message Edit Indicator
// ---------------------------------------------------------------------------

interface EditIndicatorProps {
  timestamp?: string;
}

export const EditIndicator: React.FC<EditIndicatorProps> = ({ timestamp }) => (
  <span className="edit-indicator" title={timestamp ? `Edited ${timestamp}` : 'Edited'}>
    (edited)
  </span>
);
