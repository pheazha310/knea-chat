import React, { useEffect, useState } from 'react';
import { resolveFileUrl } from '../../models';
import { avatarClass, initialsOf } from '../../utils/avatar';

/** Minimal person shape the avatar needs to render (photo / initials / dot). */
export interface AvatarPerson {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  profile_picture?: string | null;
  status?: string | null;
}

interface AvatarProps {
  /** The person this avatar belongs to (name, photo, presence). */
  person?: AvatarPerson | null;
  /** Extra classes appended to the base `avatar` class (e.g. "small"). */
  className?: string;
  /** Explicit photo URL override (e.g. WS messages carry senderProfilePicture). */
  photo?: string | null;
  /** Render the presence dot (online / away / dnd / offline). */
  showStatus?: boolean;
  /** Alt text; defaults to the person's name. */
  alt?: string;
}

/**
 * Renders a real profile photo when one is stored, otherwise falls back to the
 * deterministic gradient + initials avatar. The photo URL is resolved against
 * the API origin so /uploads paths work from the dev client.
 */
const Avatar = ({
  person,
  className = '',
  photo,
  showStatus = false,
  alt,
}: AvatarProps) => {
  const pic = photo ?? person?.profile_picture;
  const name =
    [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim() || '';
  const status = person?.status;
  // A stored photo can 404 (reseeded DB, moved uploads dir) — fall back to the
  // initials avatar instead of showing the browser's broken-image icon.
  const [picFailed, setPicFailed] = useState(false);
  useEffect(() => setPicFailed(false), [pic]);

  if (pic && !picFailed) {
    return (
      <span className={`avatar ${className}`}>
        <img
          className="avatar-img"
          src={resolveFileUrl(pic)}
          alt={alt ?? name}
          loading="lazy"
          onError={() => setPicFailed(true)}
        />
        {showStatus && status && <i className={status} />}
      </span>
    );
  }

  return (
    <span className={`${avatarClass(person?.id)} ${className}`}>
      {initialsOf(name) || '?'}
      {showStatus && status && <i className={status} />}
    </span>
  );
};

export default Avatar;
