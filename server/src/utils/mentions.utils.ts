/**
 * KneaChat — Mention utilities (SRS FR-15, US-16).
 *
 * Parses "@-mentions" in message content against the members of a
 * conversation and returns the ids of mentioned users so the server can
 * create mention notifications and the client can render them.
 *
 * Matching is intentionally lenient: a token matches a member if it equals
 * (case-insensitively) the member's email, first name, last name, or the
 * combined "First Last" name.
 */

// `@` is included in the token class so email-style mentions
// (@dara.sok@kneachat.com) can match a member's email key.
const MENTION_REGEX = /@([A-Za-zÀ-ÿ0-9_.\-'@]+(?:\s+[A-Za-zÀ-ÿ0-9_.\-'@]+)?)/g;

/** Strip trailing punctuation that may have been typed after a name. */
export const cleanToken = (raw: string): string => raw.replace(/[.,;:!?)]+$/g, '').trim();

interface MentionableMember {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * Extract the ids of mentioned conversation members from message content.
 */
export const extractMentionedUserIds = (
  content: string,
  members: MentionableMember[],
): number[] => {
  if (!content || typeof content !== 'string' || !Array.isArray(members) || members.length === 0) {
    return [];
  }

  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(MENTION_REGEX.source, 'g');
  while ((match = regex.exec(content)) !== null) {
    // Emit every word plus (if present) the "First Last" combination.
    // This stops a common sentence like "@Maya and @Dara" from swallowing
    // the word "and" into a two-word token, and keeps consecutive mentions
    // like "@Maya @Chen" (which the @-in-token-class capture merges) from
    // losing the second person. A leading '@' on a captured part is stripped
    // so email-style tokens keep their form (@dara.sok@kneachat.com).
    const parts = match[1]
      .split(/\s+/)
      .map((part) => cleanToken(part.replace(/^@/, '')))
      .filter(Boolean);
    if (parts.length === 0) continue;
    tokens.push(...parts);
    if (parts.length > 1) tokens.push(parts.join(' '));
  }
  if (tokens.length === 0) return [];

  const mentioned = new Set<number>();

  for (const member of members) {
    const keys = [
      member.email,
      member.first_name,
      member.last_name,
      `${member.first_name} ${member.last_name}`,
    ]
      .map((key) => (key || '').trim().toLowerCase())
      .filter(Boolean);

    for (const token of tokens) {
      if (keys.includes(token.toLowerCase())) {
        mentioned.add(Number(member.id));
        break;
      }
    }
  }

  return Array.from(mentioned);
};
