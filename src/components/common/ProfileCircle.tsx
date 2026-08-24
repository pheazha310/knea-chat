import React from 'react';
import Avatar from './Avatar';
import type { AvatarPerson } from './Avatar';

interface ProfileCircleProps {
  person?: AvatarPerson | null;
  photo?: string | null;
  size?: number;
  showStatus?: boolean;
  alt?: string;
  className?: string;
}

const ProfileCircle = ({
  person,
  photo,
  size = 56,
  showStatus = false,
  alt,
  className = '',
}: ProfileCircleProps) => {
  return (
    <div
      className={`profile-circle ${className}`}
      style={{ width: size, height: size, '--avatar-size': `${size}px` } as React.CSSProperties}
    >
      <Avatar
        person={person}
        photo={photo}
        className="profile-circle-avatar"
        showStatus={showStatus}
        alt={alt}
      />
    </div>
  );
};

export default ProfileCircle;
