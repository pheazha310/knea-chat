import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useAuthStore } from '../../store/authStore';
import { useUserStore } from '../../store/userStore';
import type { CallSession } from '../../store/callStore';
import type { ChatMessage } from '../../models';

interface CallChatPanelProps {
  call: CallSession;
}

const senderName = (m: ChatMessage) => {
  const rest = m as any;
  return [rest.first_name || rest.senderFirstName, rest.last_name || rest.senderLastName]
    .filter(Boolean)
    .join(' ')
    .trim() || 'User';
};

/**
 * Compact chat shown while a call is active. Group calls message the channel/
 * team conversation; 1:1 calls message the DM (resolved lazily for incoming
 * calls, which don't carry the conversation id). Reuses the existing message
 * pipeline, so everything is real-time through the same WebSocket events.
 */
const CallChatPanel = ({ call }: CallChatPanelProps) => {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const [conversationId, setConversationId] = useState<number | null>(() => {
    // Outgoing and group calls carry the conversation id. Incoming 1:1 calls
    // don't, so resolve the DM synchronously from the already-loaded list
    // here in the initializer — StrictMode double-invokes effects in dev and
    // a setState queued there can be discarded, leaving the input stuck on
    // "Connecting…" (the panel never resolved).
    if (call.conversationId) return call.conversationId;
    if (call.direction === 'incoming' && call.callerUserId) {
      const known = useChatStore
        .getState()
        .conversations.find(
          (c) =>
            c.type === 'direct' &&
            c.members?.some((m) => Number(m.id) === Number(call.callerUserId)),
        );
      if (known) return known.id;
    }
    return null;
  });
  const [draft, setDraft] = useState('');
  const messages = useChatStore((s) =>
    conversationId !== null ? s.messages[conversationId] : undefined,
  );
  const typingIds = useChatStore((s) =>
    conversationId !== null ? s.typingUsers[conversationId] : undefined,
  );
  const users = useUserStore((s) => s.users);
  const listRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);
  const [amTyping, setAmTyping] = useState(false);

  // The server broadcasts typing events to everyone but the sender, so every
  // id in the set is a peer currently typing in this conversation.
  const typingLabel = useMemo(() => {
    if (!typingIds || typingIds.size === 0) return '';
    const names = Array.from(typingIds).map((id) => {
      const u = users.find((x) => x.id === id);
      return u ? `${u.first_name} ${u.last_name}` : `User ${id}`;
    });
    return `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…`;
  }, [typingIds, users]);

  // Incoming 1:1 calls don't carry the DM id and it wasn't in the local list
  // at mount (e.g. a brand-new DM) — fall back to find-or-create.
  useEffect(() => {
    if (conversationId !== null) return;
    const peerId = call.direction === 'incoming' ? call.callerUserId : call.targetId;
    if (!peerId) return;
    let mounted = true;
    void useChatStore.getState().openDirectWithUser(peerId).then((conv) => {
      if (mounted && conv) setConversationId(conv.id);
    });
    return () => {
      mounted = false;
    };
  }, [conversationId, call.direction, call.callerUserId, call.targetId]);

  // Load history once the conversation is known. Force the fetch so a live
  // message that arrived before resolution can't suppress the full history.
  useEffect(() => {
    if (conversationId === null) return;
    void useChatStore.getState().loadConversation(conversationId, true);
  }, [conversationId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, typingLabel]);

  const stopTyping = () => {
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = null;
    if (amTyping) {
      setAmTyping(false);
      if (conversationId !== null) {
        useChatStore.getState().sendTyping(conversationId, false);
      }
    }
  };

  // Broadcast typing while the panel's input is being used, and always send a
  // stop on unmount so peers don't see a stuck indicator when the call ends.
  useEffect(() => {
    return () => {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (conversationId !== null) {
        useChatStore.getState().sendTyping(conversationId, false);
      }
    };
  }, [conversationId]);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (conversationId === null) return;
    if (value && !amTyping) {
      setAmTyping(true);
      useChatStore.getState().sendTyping(conversationId, true);
    }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      setAmTyping(false);
      if (conversationId !== null) {
        useChatStore.getState().sendTyping(conversationId, false);
      }
    }, 900);
  };

  const send = () => {
    const content = draft.trim();
    if (!content || conversationId === null) return;
    useChatStore.getState().sendMessage(conversationId, content);
    setDraft('');
    stopTyping();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="call-chat">
      <div className="call-chat-header">
        <b>Call chat</b>
        <span>{conversationId !== null ? (call.isGroup ? call.name : 'Direct message') : 'Connecting…'}</span>
      </div>
      <div className="call-chat-list" ref={listRef}>
        {!messages || messages.length === 0 ? (
          <p className="call-chat-empty">No messages yet — say hi!</p>
        ) : (
          messages.map((m) => {
            const mine =
              currentUserId !== null &&
              Number((m as any).sender_id ?? (m as any).senderId) === currentUserId;
            return (
              <div key={m.id} className={`call-chat-msg ${mine ? 'mine' : ''}`}>
                {!mine && <b>{senderName(m)}</b>}
                <span>{m.content}</span>
              </div>
            );
          })
        )}
        {typingLabel && (
          <div className="call-chat-typing">
            <span className="typing">
              <span />
              <span />
              <span />
              {typingLabel}
            </span>
          </div>
        )}
      </div>
      <div className="call-chat-input">
        <input
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          onBlur={stopTyping}
          onKeyDown={onKeyDown}
          placeholder="Message during the call…"
          disabled={conversationId === null}
        />
        <button onClick={send} disabled={!draft.trim() || conversationId === null} aria-label="Send">
          ➤
        </button>
      </div>
    </div>
  );
};

export default CallChatPanel;
