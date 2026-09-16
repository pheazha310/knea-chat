// Icon — shared SVG icon set (16×16 stroke style, `currentColor`).
//
// Conventions:
//   - 16×16 viewBox, ~1.5 unit padding (content stays inside the box)
//   - stroke style: `stroke="currentColor"`, round caps/joins, 1.3 width
//     (icons that read better thicker — x, plus, check — override locally)
//   - stroke attributes live on the <svg> root and are inherited, so every
//     icon is just geometry and the `strokeWidth` prop actually works
//   - decorative by default (aria-hidden); pass `title` for a real label
//     (renders <title> + role="img" + aria-label, also a native tooltip)
//
// Replaces the scattered emoji/unicode glyphs (▤ 👥 💬 📌 📎 🗑 × ＋ … ☰ ☾ ⌕ ♧)
// with one consistent system.
import React from 'react';

export type IconName =
  | 'hash'
  | 'grid'
  | 'users'
  | 'user'
  | 'message'
  | 'bell'
  | 'paperclip'
  | 'pin'
  | 'trash'
  | 'x'
  | 'plus'
  | 'search'
  | 'gear'
  | 'send'
  | 'edit'
  | 'archive'
  | 'restore'
  | 'home'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'info'
  | 'emoji'
  | 'logout'
  | 'reply'
  | 'bolt'
  | 'megaphone'
  | 'lock'
  | 'arrow-right'
  | 'arrow-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'menu'
  | 'sun'
  | 'moon'
  | 'phone'
  | 'video'
  | 'camera'
  | 'mic'
  | 'at'
  | 'image'
  | 'file'
  | 'download'
  | 'building'
  | 'more'
  | 'clock'
  | 'external'
  | 'copy'
  | 'sparkles'
  | 'shield'
  | 'key'
  | 'calendar'
  | 'play'
  | 'pause'
  | 'bold'
  | 'eye'
  | 'eye-off'
  | 'bookmark'
  | 'screen'
  | 'columns'
  | 'list';

const PATHS: Record<IconName, React.ReactNode> = {
  hash: (
    <>
      <path d="M3 5.5H13" />
      <path d="M3 10.5H13" />
      <path d="M6.5 2.5L5 13.5" />
      <path d="M10.5 2.5L9 13.5" />
    </>
  ),
  grid: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  users: (
    <>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M2 13.5C2 11.2 3.8 9.5 6 9.5C8.2 9.5 10 11.2 10 13.5" />
      <circle cx="11.5" cy="6" r="2" />
      <path d="M11 9.7C12.9 10 14 11.4 14 13.3" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5C3 11 5 9.5 8 9.5C11 9.5 13 11 13 13.5" />
    </>
  ),
  message: (
    <path d="M2.5 4C2.5 3.2 3.2 2.5 4 2.5H12C12.8 2.5 13.5 3.2 13.5 4V9.5C13.5 10.3 12.8 11 12 11H7L4 13.5V11H4C3.2 11 2.5 10.3 2.5 9.5V4Z" />
  ),
  bell: (
    <>
      <path d="M8 2C5.8 2 4 3.8 4 6V9L3.5 11.5H12.5L12 9V6C12 3.8 10.2 2 8 2Z" />
      <path d="M6 13.5C6 14.3 6.9 15 8 15C9.1 15 10 14.3 10 13.5" />
    </>
  ),
  paperclip: (
    <path d="M10.5 9.5L7 13C5.9 14.1 4.4 14.1 3.3 13C2.2 11.9 2.2 10.4 3.3 9.3L6.8 5.8" />
  ),
  pin: (
    <>
      <circle cx="5" cy="5" r="2.3" />
      <path d="M6.8 6.8L12.5 12.5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 4H13" />
      <path d="M5.5 4V2.8C5.5 2.4 5.9 2 6.3 2H9.7C10.1 2 10.5 2.4 10.5 2.8V4" />
      <path d="M4.5 4L5 13.5C5 14.3 5.7 15 6.5 15H9.5C10.3 15 11 14.3 11 13.5L11.5 4" />
      <path d="M7 7V12" />
      <path d="M9.5 7V12" />
    </>
  ),
  x: (
    <>
      <path d="M4 4L12 12" strokeWidth={1.5} />
      <path d="M12 4L4 12" strokeWidth={1.5} />
    </>
  ),
  plus: (
    <>
      <path d="M8 3V13" strokeWidth={1.5} />
      <path d="M3 8H13" strokeWidth={1.5} />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 2.5V4" />
      <path d="M8 12V13.5" />
      <path d="M2.5 8H4" />
      <path d="M12 8H13.5" />
      <path d="M4.2 4.2L5.3 5.3" />
      <path d="M10.7 10.7L11.8 11.8" />
      <path d="M11.8 4.2L10.7 5.3" />
      <path d="M5.3 10.7L4.2 11.8" />
    </>
  ),
  send: (
    <>
      <path d="M13.5 2.5L2.5 7L6.5 9.5L9 13.5L13.5 2.5Z" />
      <path d="M6.5 9.5L13.5 2.5" />
    </>
  ),
  edit: (
    <>
      <path d="M11.5 2.5L13.5 4.5L5 13L2.5 13.5L3 11L11.5 2.5Z" />
      <path d="M10.5 3.5L12.5 5.5" />
    </>
  ),
  archive: (
    <>
      <path d="M2.5 5H13.5V6.5H2.5V5Z" />
      <path d="M3.5 6.5V13C3.5 13.8 4.2 14.5 5 14.5H11C11.8 14.5 12.5 13.8 12.5 13V6.5" />
      <path d="M6.5 10H9.5" />
    </>
  ),
  restore: (
    <>
      <path d="M13.5 8C13 5.6 11 4 8.5 4C5.7 4 3.5 6.2 3.5 9C3.5 11.8 5.7 14 8.5 14C10.5 14 12.1 13 12.9 11.4" />
      <path d="M13.5 4V8H9.5" />
    </>
  ),
  home: (
    <path d="M2.5 6.5L8 2.5L13.5 6.5V14H10.5V10H5.5V14H2.5V6.5Z" />
  ),
  check: (
    <path d="M3 8.5L6.5 12L13 4.5" strokeWidth={1.5} />
  ),
  'check-circle': (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M5 8.5L7.5 11L11.5 6" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.5L14.5 13.5H1.5L8 2.5Z" />
      <path d="M8 6.5V9.5" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5V11.5" />
      <circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  emoji: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 9C6 10.5 6.9 11.5 8 11.5C9.1 11.5 10 10.5 10.5 9" />
      <circle cx="6" cy="6.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.5" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 3H3.5C2.9 3 2.5 3.4 2.5 4V12C2.5 12.6 2.9 13 3.5 13H9.5" />
      <path d="M6.5 8H13.5" />
      <path d="M10.5 5L13.5 8L10.5 11" />
    </>
  ),
  bolt: (
    <path d="M9.5 2L4 9H8L7 14L12.5 7H8.5L10.5 2Z" />
  ),
  megaphone: (
    <>
      <path d="M2 6.5V9.5C2 10.1 2.4 10.5 3 10.5H4L6.5 13V3L4 5.5H3C2.4 5.5 2 5.9 2 6.5Z" />
      <path d="M9 6C10 6.8 10 9.2 9 10" />
      <path d="M11 4.5C12.5 5.8 12.5 10.2 11 11.5" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.3" />
      <path d="M5 7V5C5 3.3 6.3 2 8 2C9.7 2 11 3.3 11 5V7" />
    </>
  ),
  reply: (
    <>
      <path d="M6 8L2.5 11.5L6 15" />
      <path d="M2.5 11.5H9.5C12 11.5 13.5 9.5 13.5 7V4.5" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M3 8H13" />
      <path d="M9 4L13 8L9 12" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M13 8H3" />
      <path d="M7 4L3 8L7 12" />
    </>
  ),
  'chevron-down': (
    <path d="M4 6L8 10L12 6" />
  ),
  'chevron-up': (
    <path d="M4 10L8 6L12 10" />
  ),
  'chevron-left': (
    <path d="M10 4L6 8L10 12" />
  ),
  'chevron-right': (
    <path d="M6 4L10 8L6 12" />
  ),
  menu: (
    <>
      <path d="M2 4H14" />
      <path d="M2 8H14" />
      <path d="M2 12H14" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.5V3" />
      <path d="M8 13V14.5" />
      <path d="M1.5 8H3" />
      <path d="M13 8H14.5" />
      <path d="M3.5 3.5L4.6 4.6" />
      <path d="M11.4 11.4L12.5 12.5" />
      <path d="M12.5 3.5L11.4 4.6" />
      <path d="M4.6 11.4L3.5 12.5" />
    </>
  ),
  moon: (
    <path d="M13.7 9.6C12.3 12 9 12.4 6.9 10.5C4.8 8.6 5 5.2 7.2 3.5C4.3 4.2 2.6 7.2 3.5 10.2C4.4 13.2 7.7 14.8 10.7 13.8C11.8 13.4 12.8 12.4 13.7 9.6Z" />
  ),
  phone: (
    <path d="M4.5 2.5H6.5L7.5 5.5L6 6.6C6.8 8.1 7.9 9.2 9.4 10L10.5 8.5L13.5 9.5V11.5C13.5 12.3 12.8 13 12 13C7.6 12.7 3.3 8.4 3 4C3 3.2 3.7 2.5 4.5 2.5Z" />
  ),
  video: (
    <>
      <rect x="1.5" y="5.5" width="10" height="7" rx="1.5" />
      <path d="M11.5 7.5L14.5 5.5V12.5L11.5 10.5" />
    </>
  ),
  camera: (
    <>
      <rect x="2" y="4.5" width="12" height="9" rx="1.5" />
      <path d="M6 4.5L7 2.5H9L10 4.5" />
      <circle cx="8" cy="9" r="2.5" />
    </>
  ),
  mic: (
    <>
      <rect x="5.5" y="2.5" width="5" height="8" rx="2.5" />
      <path d="M3.5 8C3.5 10.5 5.5 12.5 8 12.5C10.5 12.5 12.5 10.5 12.5 8" />
      <path d="M8 12.5V14" />
    </>
  ),
  at: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M12.5 8C12.5 5.1 11 3.5 8.5 3.5C6 3.5 4.5 5.5 4.5 8C4.5 10.5 6 12.5 8.5 12.5C10.1 12.5 11.1 11.9 11.9 11" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="M3.5 12L7 8.5L9.5 11L12 8.5L13.5 10" />
    </>
  ),
  file: (
    <>
      <path d="M4 2.5H9.5L12.5 5.5V13.5H4V2.5Z" />
      <path d="M9.5 2.5V5.5H12.5" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.5V10" />
      <path d="M5 7L8 10L11 7" />
      <path d="M3 13.5H13" />
    </>
  ),
  building: (
    <>
      <rect x="3" y="2.5" width="10" height="11" rx="1" />
      <path d="M6 5.5V7" />
      <path d="M10 5.5V7" />
      <path d="M6 9V10.5" />
      <path d="M10 9V10.5" />
      <path d="M7 13.5V11H9V13.5" />
    </>
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8L10.5 9.5" />
    </>
  ),
  external: (
    <>
      <path d="M6 3H3.5C2.9 3 2.5 3.4 2.5 4V12.5C2.5 13.1 2.9 13.5 3.5 13.5H12C12.6 13.5 13 13.1 13 12.5V10" />
      <path d="M8 3H13V8" />
      <path d="M13 3L7.5 8.5" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5V4C10.5 3.2 9.8 2.5 9 2.5H4C3.2 2.5 2.5 3.2 2.5 4V9C2.5 9.8 3.2 10.5 4 10.5H5.5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M8 3L9.2 6.8L13 8L9.2 9.2L8 13L6.8 9.2L3 8L6.8 6.8L8 3Z" />
      <path d="M12.5 11.5L13 12.5L14 13L13 13.5L12.5 14.5L12 13.5L11 13L12 12.5L12.5 11.5Z" />
    </>
  ),
  shield: (
    <>
      <path d="M8 2L13.5 4V8C13.5 11.5 11 14 8 15C5 14 2.5 11.5 2.5 8V4L8 2Z" />
      <path d="M6 8L7.5 9.5L10.5 6.5" />
    </>
  ),
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="M8 8L13 3" />
      <path d="M10.5 5.5L12 7" />
      <path d="M9.5 6.5L11 8" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5H13.5" />
      <path d="M5.5 2.5V4.5" />
      <path d="M10.5 2.5V4.5" />
    </>
  ),
  play: (
    <path d="M4.5 2.5L13 8L4.5 13.5V2.5Z" />
  ),
  pause: (
    <>
      <rect x="4" y="3" width="2.5" height="10" rx="0.5" />
      <rect x="9.5" y="3" width="2.5" height="10" rx="0.5" />
    </>
  ),
  bold: (
    <>
      <path d="M5.5 3V13" />
      <path d="M5.5 3.5H10C11.1 3.5 11.8 4.2 11.8 5.5C11.8 6.8 11.1 7.5 10 7.5H5.5" />
      <path d="M5.5 7.5H10C11.1 7.5 11.8 8.2 11.8 9.5C11.8 10.8 11.1 11.5 10 11.5H5.5" />
    </>
  ),
  eye: (
    <>
      <path d="M1.6 8C3 5.3 5.4 3.6 8 3.6S13 5.3 14.4 8C13 10.7 10.6 12.4 8 12.4S3 10.7 1.6 8Z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3L13 13" />
      <path d="M10.9 11.2C10 11.8 9 12.1 8 12.1C5.4 12.1 3 10.4 1.6 7.7C2.1 6.7 2.7 5.9 3.5 5.2" />
      <path d="M6.8 3.7C7.2 3.6 7.6 3.6 8 3.6C10.6 3.6 13 5.3 14.4 8C14 8.8 13.5 9.5 12.9 10.1" />
      <path d="M9.8 9.8A2.5 2.5 0 0 1 6.2 6.2" />
    </>
  ),
  bookmark: (
    <>
      <path d="M4.5 3.5V13.5L8 11L11.5 13.5V3.5C11.5 2.5 10.5 1.5 9.5 1.5H6.5C5.5 1.5 4.5 2.5 4.5 3.5Z" />
    </>
  ),
  screen: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M5.5 14H10.5" />
      <path d="M8 11V14" />
    </>
  ),
  columns: (
    <>
      <rect x="2.5" y="3" width="3.2" height="10" rx="1" />
      <rect x="6.4" y="3" width="3.2" height="10" rx="1" />
      <rect x="10.3" y="3" width="3.2" height="10" rx="1" />
    </>
  ),
  list: (
    <>
      <rect x="2.5" y="3.5" width="2.4" height="2.4" rx="0.6" />
      <path d="M7.5 4.7H13.5" />
      <rect x="2.5" y="6.8" width="2.4" height="2.4" rx="0.6" />
      <path d="M7.5 8H13.5" />
      <rect x="2.5" y="10.1" width="2.4" height="2.4" rx="0.6" />
      <path d="M7.5 11.3H13.5" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  /** Override the stroke weight (default 1.3). */
  strokeWidth?: number;
  /** Accessible label + native tooltip. Without it the icon is decorative. */
  title?: string;
  className?: string;
}

/** Renders a 16×16 stroke icon that inherits the current text color. */
const Icon = ({ name, size = 16, strokeWidth = 1.3, title, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
    aria-label={title}
    focusable="false"
  >
    {title && <title>{title}</title>}
    {PATHS[name]}
  </svg>
);

export default Icon;
