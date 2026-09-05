// Shared emoji catalog — the single source of truth for emoji surfaces.
//
// Both the chat composer's enhanced picker and every quick-reaction bar
// (message rows, notification rows, announcement cards, task details) draw
// from these lists, so the quick set and the full categorized grid stay
// consistent across the app.

/** The quick set offered on hover bars and reaction rows (muscle memory). */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🙏', '🎉', '🔥'];

export interface EmojiCategory {
  name: string;
  /** Emoji shown as the category tab icon. */
  icon: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    name: 'Smileys',
    icon: '😊',
    emojis: [
      '😀', '😄', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅',
      '🙃', '😉', '🥳', '😴', '🤯', '😇', '🥲', '🫠', '😏', '🙄',
      '😬', '🫣', '🤩', '🫡', '🥰', '😜', '🫢', '🤗', '🤭',
    ],
  },
  {
    name: 'Gestures',
    icon: '👋',
    emojis: [
      '👍', '👎', '👏', '🙌', '🤝', '💪', '✌️', '🤞', '👋', '🤙',
      '🫶', '🫰', '🙏', '👊', '✊', '🤛', '🤜', '👆', '👇', '👈',
      '👉', '🫵',
    ],
  },
  {
    name: 'Hearts',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
    ],
  },
  {
    name: 'Objects',
    icon: '✨',
    emojis: [
      '🔥', '✨', '🎉', '🎊', '🎈', '🚀', '⭐', '☀️', '🌙', '🌈',
      '💎', '🏆', '🎯', '📌', '📎', '💡', '🔔', '🔑', '🛠️', '⚙️',
      '🧲', '🪄', '🎵', '🎶',
    ],
  },
  {
    name: 'Symbols',
    icon: '✅',
    emojis: [
      '✅', '❌', '❗', '❓', '💯', '⭕', '🔴', '🟠', '🟡', '🟢',
      '🔵', '🟣', '⬛', '⬜', '🔶', '🔷', '➡️', '⬅️', '⬆️', '⬇️',
    ],
  },
];

/** Every emoji in the catalog (deduplicated), for searching. */
export const ALL_EMOJIS: string[] = (() => {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const category of EMOJI_CATEGORIES) {
    for (const emoji of category.emojis) {
      if (seen.has(emoji)) continue;
      seen.add(emoji);
      all.push(emoji);
    }
  }
  return all;
})();

/** Search the full catalog by a plain-text term. Empty/whitespace → all. */
export const searchEmojis = (term: string): string[] => {
  const q = term.trim().toLowerCase();
  if (!q) return ALL_EMOJIS;
  return ALL_EMOJIS.filter((emoji) =>
    emoji.toLocaleLowerCase().includes(q),
  );
};
