/// <reference types="jest" />
import { wsService } from '../../shared/lib/websocket';
import { useChatStore } from '../../entities/conversation/model/chatStore';
import { registerWsListeners } from './wsListeners';

const wsMessage = (id: number) => ({
  id,
  conversationId: 148,
  senderId: 101,
  content: 'Where is my order?',
  messageType: 'text',
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
});

describe('wsListeners — email.message.received', () => {
  let unregister: () => void;
  let addMessage: jest.SpyInstance;

  beforeEach(() => {
    const chat = useChatStore.getState();
    addMessage = jest.spyOn(chat, 'addMessage').mockImplementation(() => undefined as never);
    jest.spyOn(chat, 'refreshConversations').mockResolvedValue(undefined as never);
    unregister = registerWsListeners();
  });

  afterEach(() => {
    unregister();
    jest.restoreAllMocks();
  });

  it('adds an incoming customer email to its conversation', () => {
    wsService.emit('email.message.received', {
      type: 'email.message.received',
      channel: 'email',
      conversationId: 148,
      message: wsMessage(1),
      email: { subject: 'Order #42', from: 'customer@example.com' },
    });

    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(148, expect.objectContaining({ id: 1 }));
  });

  it('still handles the generic receive_message the same way', () => {
    wsService.emit('receive_message', { type: 'receive_message', message: wsMessage(2) });
    expect(addMessage).toHaveBeenCalledWith(148, expect.objectContaining({ id: 2 }));
  });
});
