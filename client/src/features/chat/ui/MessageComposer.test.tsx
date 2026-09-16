/// <reference types="jest" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import MessageComposer from './MessageComposer';
import type { Conversation } from '../../../entities';

jest.mock('../../../app/providers/ToastProvider', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const telegramConversation = {
  id: 7,
  type: 'direct',
  name: 'John Smith (Telegram)',
  channel: 'telegram',
} as unknown as Conversation;

const internalConversation = {
  id: 8,
  type: 'direct',
  name: 'Maya Chen',
} as unknown as Conversation;

const baseProps = {
  draft: '',
  onDraftChange: jest.fn(),
  onSend: jest.fn(),
  replyTo: null,
  onClearReply: jest.fn(),
  users: [],
  onSendFile: jest.fn(),
  uploading: false,
  uploadProgress: null,
};

describe('MessageComposer — per-channel media capability', () => {
  it('shows attach + mic on a Telegram conversation with media support', () => {
    render(
      <MessageComposer
        {...baseProps}
        active={telegramConversation}
        channelSupportsMedia
      />,
    );
    expect(screen.getByTitle('Attach a file')).toBeTruthy();
    expect(document.querySelector('.mic-toggle')).toBeTruthy();
  });

  it('hides attach + mic when the channel cannot relay media (website widget)', () => {
    const websiteConversation = {
      ...telegramConversation,
      channel: 'website',
    } as unknown as Conversation;
    render(
      <MessageComposer
        {...baseProps}
        active={websiteConversation}
        channelSupportsMedia={false}
      />,
    );
    expect(screen.queryByTitle('Attach a file')).toBeNull();
    expect(document.querySelector('.mic-toggle')).toBeNull();
  });

  it('keeps the controls when the capability is unknown (failed fetch)', () => {
    render(
      <MessageComposer
        {...baseProps}
        active={telegramConversation}
        channelSupportsMedia={undefined}
      />,
    );
    expect(screen.getByTitle('Attach a file')).toBeTruthy();
    expect(document.querySelector('.mic-toggle')).toBeTruthy();
  });

  it('always shows the controls for internal conversations', () => {
    render(
      <MessageComposer
        {...baseProps}
        active={internalConversation}
        channelSupportsMedia={undefined}
      />,
    );
    expect(screen.getByTitle('Attach a file')).toBeTruthy();
    expect(document.querySelector('.mic-toggle')).toBeTruthy();
  });
});
