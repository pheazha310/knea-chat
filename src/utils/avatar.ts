/**
 * Deterministic avatar helpers — every person gets a stable, distinct
 * gradient based on their id/email, instead of cycling flat colors.
 */

const GRADIENT_COUNT = 8;

/** Pick a stable gradient class (`grad-0` … `grad-7`) for a person. */
export const avatarClass = (
  seed: number | string | null | undefined,
): string => {
  const s = seed === null || seed === undefined ? '' : String(seed);
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `avatar grad-${hash % GRADIENT_COUNT}`;
};

/** Up to two initials from a full name (e.g. "Maya Chen" → "MC"). */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
