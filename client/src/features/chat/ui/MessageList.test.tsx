/// <reference types="jest" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import MessageList from './MessageList';
import type { ChatMessage } from '../../../entities/message/model/Message';

// jsdom has no layout engine; MessageList scrolls the pane on render.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const baseProps = {
  currentUserId: 7,
  onReact: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onReply: jest.fn(),
  onTogglePin: jest.fn(),
  onSetReminder: jest.fn(),
  reminders: {},
  onForward: jest.fn(),
  onBookmark: jest.fn(),
  bookmarkedIds: new Set<number>(),
};

const emailReply = (id: number, status: 'pending' | 'sent' | 'failed' | null, minute: number): ChatMessage => ({
  id,
  conversation_id: 148,
  sender_id: 7,
  content: `Reply ${id}`,
  type: 'text',
  is_pinned: 0,
  created_at: `2026-10-02T10:${String(minute).padStart(2, '0')}:00.000Z`,
  updated_at: `2026-10-02T10:${String(minute).padStart(2, '0')}:00.000Z`,
  first_name: 'Agent',
  last_name: 'One',
  delivery_status: status,
});

describe('MessageList — email delivery status', () => {
  it('marks failed and pending emails, and leaves sent ones unmarked', () => {
    render(
      <MessageList
        {...baseProps}
        messages={[emailReply(1, 'sent', 0), emailReply(2, 'failed', 1), emailReply(3, 'pending', 2)]}
      />,
    );

    expect(screen.getAllByText(/Not delivered/)).toHaveLength(1);
    expect(screen.getAllByText(/Sending…/)).toHaveLength(1);
  });

  it('reads the camelCase WebSocket shape too', () => {
    const wsFailed = {
      id: 9,
      conversationId: 148,
      senderId: 7,
      content: 'From the socket',
      messageType: 'text',
      createdAt: '2026-10-02T10:05:00.000Z',
      updatedAt: '2026-10-02T10:05:00.000Z',
      deliveryStatus: 'failed',
    } as ChatMessage;
    render(<MessageList {...baseProps} messages={[wsFailed]} />);
    expect(screen.getByText(/Not delivered/)).toBeInTheDocument();
  });
});
