/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import NotifsView from './NotifsView';
import type { Notification } from '../../models';

const msgNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 10,
  user_id: 2,
  actor_id: 3,
  type: 'mention',
  title: 'Maya mentioned you',
  message: 'Can you review the full plan I pasted below?',
  data: { conversationId: 7, messageId: 42 },
  is_read: 0,
  created_at: '2026-09-05T10:00:00Z',
  reactions: [],
  ...overrides,
});

const announcementNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 11,
  user_id: 2,
  actor_id: 3,
  type: 'announcement',
  title: 'New announcement',
  message: 'Office closed Friday.',
  data: { announcementId: 99 },
  is_read: 0,
  created_at: '2026-09-05T09:00:00Z',
  reactions: [],
  ...overrides,
});

describe('NotifsView row click', () => {
  it('opens the full message when a message notification row is clicked', () => {
    const open = jest.fn();
    render(
      <NotifsView
        notifications={[msgNotification()]}
        unreadCount={1}
        onMarkRead={jest.fn()}
        onMarkAllRead={jest.fn()}
        onReplyMessage={jest.fn().mockResolvedValue(true)}
        onOpenMessageNotification={open}
      />,
    );

    fireEvent.click(screen.getByText(/Can you review/));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10, type: 'mention' }),
    );
  });

  it('does not open the message when clicking the row actions (Reply)', () => {
    const open = jest.fn();
    const onReply = jest.fn().mockResolvedValue(true);
    render(
      <NotifsView
        notifications={[msgNotification()]}
        unreadCount={1}
        onMarkRead={jest.fn()}
        onMarkAllRead={jest.fn()}
        onReplyMessage={onReply}
        onOpenMessageNotification={open}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Reply to the message' }),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps non-message rows non-clickable (no full-message modal)', () => {
    const open = jest.fn();
    const { container } = render(
      <NotifsView
        notifications={[
          announcementNotification(),
          msgNotification({ is_read: 1 }),
        ]}
        unreadCount={0}
        onMarkRead={jest.fn()}
        onMarkAllRead={jest.fn()}
        onOpenMessageNotification={open}
      />,
    );

    const announcementRow = screen
      .getByText(/Office closed Friday/)
      .closest('li') as HTMLElement;
    fireEvent.click(announcementRow);
    expect(open).not.toHaveBeenCalled();

    // The read message row is still openable (content preview clickable).
    const messageRow = container.querySelector('li.clickable') as HTMLElement;
    expect(messageRow).toBeTruthy();
    fireEvent.click(messageRow);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
