/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NotificationMessageModal from './NotificationMessageModal';
import { MessageModel } from '../../models/Message';
import type { Message, Notification } from '../../models';

const LONG_CONTENT =
  'This is the complete, untruncated message body that was far longer than ' +
  'the 120-character preview the server stores on the notification row. It ' +
  'keeps going with several more sentences of real content so the modal ' +
  'proves it renders the full original message and nothing is cut off.';

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 42,
  conversation_id: 7,
  sender_id: 3,
  content: LONG_CONTENT,
  type: 'text',
  reply_to: null,
  forwarded_from: null,
  is_pinned: 0,
  created_at: '2026-09-05T10:00:00Z',
  updated_at: '2026-09-05T10:00:00Z',
  deleted_at: null,
  first_name: 'Maya',
  last_name: 'Kim',
  email: 'maya@kneachat.com',
  profile_picture: null,
  reactions: [],
  attachments: [],
  ...overrides,
});

const baseNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 10,
  user_id: 2,
  actor_id: 3,
  type: 'mention',
  title: 'Maya mentioned you',
  message: 'This is the 120-char preview…',
  data: { conversationId: 7, messageId: 42 },
  is_read: 0,
  created_at: '2026-09-05T10:00:00Z',
  ...overrides,
});

/** Wrap in the axios envelope consumers read as `res.data.data…`. */
const okResponse = (message: Message) => ({
  data: {
    success: true,
    data: { message, conversation: { id: 7, type: 'channel', name: 'general' } },
  },
});

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('NotificationMessageModal', () => {
  it('fetches and shows the full untruncated message with sender and conversation', async () => {
    jest
      .spyOn(MessageModel, 'getById')
      .mockResolvedValue(okResponse(baseMessage()) as any);

    render(
      <NotificationMessageModal
        notification={baseNotification()}
        onClose={jest.fn()}
        onOpenInChat={jest.fn()}
      />,
    );

    // Full body is rendered — nothing clipped to the notification preview.
    expect(
      await screen.findByText(LONG_CONTENT, { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText('#general')).toBeTruthy();
    expect(screen.getByText('Maya Kim')).toBeTruthy();
    expect(MessageModel.getById).toHaveBeenCalledWith(42);
  });

  it('offers Reply and React affordances plus Open in conversation', async () => {
    jest
      .spyOn(MessageModel, 'getById')
      .mockResolvedValue(okResponse(baseMessage()) as any);

    const onOpenInChat = jest.fn();
    render(
      <NotificationMessageModal
        notification={baseNotification()}
        onClose={jest.fn()}
        onOpenInChat={onOpenInChat}
        onReplyMessage={jest.fn().mockResolvedValue(true)}
      />,
    );

    await screen.findByText(LONG_CONTENT, { exact: false });
    expect(
      screen.getByRole('button', { name: 'React to the message' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reply to the message' }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Open in conversation' }),
    );
    expect(onOpenInChat).toHaveBeenCalledWith(7, 42);
  });

  it('lists attachments with working links', async () => {
    jest
      .spyOn(MessageModel, 'getById')
      .mockResolvedValue(
        okResponse(
          baseMessage({
            content: '',
            type: 'file',
            attachments: [
              {
                id: 1,
                message_id: 42,
                file_name: 'quarterly-plan.pdf',
                file_url: '/uploads/quarterly-plan.pdf',
                file_size: 204800,
                uploaded_at: '2026-09-05T10:00:00Z',
              },
            ],
          }),
        ) as any,
      );

    render(
      <NotificationMessageModal
        notification={baseNotification()}
        onClose={jest.fn()}
        onOpenInChat={jest.fn()}
      />,
    );

    const link = await screen.findByRole('link', {
      name: /quarterly-plan\.pdf/,
    });
    expect(link.textContent).toContain('200 KB');
  });

  it('fetches the message exactly once — re-renders must not trigger refetch loops', async () => {
    const getById = jest
      .spyOn(MessageModel, 'getById')
      .mockResolvedValue(okResponse(baseMessage()) as any);

    const { rerender } = render(
      <NotificationMessageModal
        notification={baseNotification()}
        onClose={jest.fn()}
        onOpenInChat={jest.fn()}
      />,
    );

    await screen.findByText(LONG_CONTENT, { exact: false });
    expect(getById).toHaveBeenCalledTimes(1);

    // Simulate unrelated parent updates (mark-read, WS traffic, etc.) that
    // re-render the modal. The fetch effect must not fire again.
    rerender(
      <NotificationMessageModal
        notification={baseNotification()}
        onClose={jest.fn()}
        onOpenInChat={jest.fn()}
      />,
    );
    rerender(
      <NotificationMessageModal
        notification={baseNotification()}
        onClose={jest.fn()}
        onOpenInChat={jest.fn()}
      />,
    );

    // Content is still there (never dropped back to the loading state).
    expect(screen.getByText(LONG_CONTENT, { exact: false })).toBeTruthy();
    expect(screen.queryByText(/loading message/i)).toBeNull();
    expect(getById).toHaveBeenCalledTimes(1);
  });

  it('shows a graceful error state when the message can no longer be fetched', async () => {
    jest.spyOn(MessageModel, 'getById').mockRejectedValue(new Error('gone'));

    const onOpenInChat = jest.fn();
    render(
      <NotificationMessageModal
        notification={baseNotification()}
        onClose={jest.fn()}
        onOpenInChat={onOpenInChat}
      />,
    );

    expect(
      await screen.findByText(/no longer available/i),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Open in conversation' }),
    );
    expect(onOpenInChat).toHaveBeenCalledWith(7, 42);
  });
});
