import React, { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "../common/Avatar";
import Icon, { type IconName } from "../common/Icon";
import { resolveFileUrl } from "../../models";
import VoiceMessage from "./VoiceMessage";
import { EditIndicator, TypingIndicator } from "./ChatEnhancements";
import type {
  Attachment,
  ChatMessage,
  Message,
  Reaction,
  WsMessage,
} from "../../models";
import { useChatStore } from "../../store/chatStore";
import { QUICK_REACTIONS } from "../../utils/emoji";

// REST messages are snake_case, WebSocket messages are camelCase — read both.
const asMessage = (m: ChatMessage) => m as Message;
const asWs = (m: ChatMessage) => m as WsMessage;

const senderName = (m: ChatMessage) =>
  `${asMessage(m).first_name || asWs(m).senderFirstName || "Unknown"} ${
    asMessage(m).last_name || asWs(m).senderLastName || ""
  }`.trim();

const senderId = (m: ChatMessage) => asMessage(m).sender_id ?? asWs(m).senderId;

const createdAtOf = (m: ChatMessage) =>
  asMessage(m).created_at ?? asWs(m).createdAt;

/** Updated timestamp (REST snake_case or WS camelCase). */
const updatedAtOf = (m: ChatMessage) =>
  asMessage(m).updated_at ?? asWs(m).updatedAt;

/** A message is "edited" when its updated_at is newer than created_at. */
const isEdited = (m: ChatMessage) => {
  const created = createdAtOf(m);
  const updated = updatedAtOf(m);
  if (!created || !updated) return false;
  return created !== updated;
};

const isPinned = (m: ChatMessage) =>
  !!asMessage(m).is_pinned || !!asWs(m).isPinned;

const attachmentsOf = (m: ChatMessage) =>
  asMessage(m).attachments ?? asWs(m).attachments ?? [];

const replyToOf = (m: ChatMessage) =>
  asMessage(m).reply_to ?? asWs(m).replyTo ?? null;

/** Compact relative timestamp for the heading: now / 2m / 3h / 2d / Jul 4. */
const formatTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Full absolute timestamp — shown as the tooltip on the relative one. */
const fullTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const dayKey = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toDateString();
};

/** "Today" / "Yesterday" / weekday / full date for the date dividers. */
const dayLabel = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();
  const key = date.toDateString();
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
};

/** Group reactions by emoji: { emoji, count, mine } */
const groupReactions = (
  reactions: Reaction[] = [],
  currentUserId: number | null,
) => {
  const grouped = new Map<string, { count: number; mine: boolean }>();
  reactions.forEach((r) => {
    const entry = grouped.get(r.reaction) || { count: 0, mine: false };
    entry.count += 1;
    if (currentUserId !== null && r.user_id === currentUserId)
      entry.mine = true;
    grouped.set(r.reaction, entry);
  });
  return Array.from(grouped.entries()).map(([emoji, meta]) => ({
    emoji,
    ...meta,
  }));
};

const MENTION_REGEX = /(@[A-Za-zÀ-ÿ0-9_.\-']+(?:\s+[A-Za-zÀ-ÿ0-9_.\-']+)?)/g;
const URL_REGEX = /(https?:\/\/[^\s<>"')]+)/g;
const EMOJI_ONLY_REGEX =
  // @ts-ignore – CRA targets es5; Unicode regex works at runtime
  /^[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u;

/** Render message content: highlight @mentions and make links clickable. */
const ContentText = ({ content }: { content: string }) => {
  const parts = useMemo(() => content.split(MENTION_REGEX), [content]);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          return (
            <span className="mention" key={i}>
              {part}
            </span>
          );
        }
        const linkParts = part.split(URL_REGEX);
        return (
          <React.Fragment key={i}>
            {linkParts.map((segment, j) =>
              j % 2 === 1 ? (
                <a
                  key={j}
                  className="message-link"
                  href={segment}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {segment}
                </a>
              ) : (
                <React.Fragment key={j}>{segment}</React.Fragment>
              ),
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};



const fileIcon = (name: string): IconName => {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["pdf", "doc", "docx", "xls", "xlsx", "csv", "zip"].includes(ext))
    return "file";
  return "paperclip";
};

/** Image attachments render inline as a preview; everything else stays a chip. */
const isImageAttachment = (att: Attachment) => {
  const mime = (att.file_type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  const ext = att.file_name.split(".").pop()?.toLowerCase() || "";
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(
    ext,
  );
};

/** Voice recordings render as an inline <audio> player. */
const isAudioAttachment = (att: Attachment) => {
  const mime = (att.file_type || "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  const ext = att.file_name.split(".").pop()?.toLowerCase() || "";
  return ["mp3", "m4a", "wav", "ogg", "oga", "opus", "webm", "aac"].includes(
    ext,
  );
};

const formatBytes = (bytes?: number | null) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: number | null;
  typingNames?: string[];
  /** When set, scrolls to the message and flashes it. `ts` allows re-jumping
   *  to the same message repeatedly (e.g. clicking the same pinned item). */
  jump?: { id: number; ts: number } | null;
  onReact: (messageId: number, emoji: string) => void;
  onEdit: (messageId: number, content: string) => void;
  onDelete: (messageId: number) => void;
  onReply: (message: ChatMessage) => void;
  onTogglePin: (message: ChatMessage) => void;
  onSetReminder: (message: ChatMessage) => void;
  reminders: Record<number, { id: number; remind_at: string } | null>;
  onForward: (message: ChatMessage) => void;
  onBookmark: (messageId: number) => void;
  bookmarkedIds: Set<number>;
}

const MessageList = ({
  messages = [],
  currentUserId,
  typingNames = [],
  jump = null,
  onReact,
  onEdit,
  onDelete,
  onReply,
  onTogglePin,
  onSetReminder,
  reminders,
  onForward,
  onBookmark,
  bookmarkedIds = new Set<number>(),
}: MessageListProps) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: ChatMessage;
  } | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(
    null,
  );
  const [showScrollDown, setShowScrollDown] = useState(false);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottom = useRef(true);

  /** Lazy-load a single message's reminder status on hover. */
  const prefetchReminder = (messageId: number) => {
    const existing = useChatStore.getState().reminders[messageId];
    if (existing === undefined) {
      void useChatStore.getState().loadReminder(messageId);
    }
  };

  const startEdit = (message: ChatMessage) => {
    setEditingId(message.id);
    setEditDraft(message.content);
  };

  const saveEdit = (message: ChatMessage) => {
    const trimmed = editDraft.trim();
    if (trimmed && trimmed !== message.content) {
      onEdit(message.id, trimmed);
    }
    setEditingId(null);
    setEditDraft("");
  };

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, []);

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      // Clipboard access may be unavailable outside a secure browser context.
    }
    setContextMenu(null);
  };

  const openContextMenu = (event: React.MouseEvent, message: ChatMessage) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = Math.min(300, window.innerWidth - 24);
    const menuHeight = Math.min(430, window.innerHeight - 24);
    const x = Math.max(
      12,
      Math.min(event.clientX, window.innerWidth - menuWidth - 12),
    );
    const y =
      event.clientY + menuHeight + 12 > window.innerHeight
        ? Math.max(12, window.innerHeight - menuHeight - 12)
        : Math.max(12, event.clientY);
    setContextMenu({ x, y, message });
  };

  // Track whether the user is near the bottom (for auto-scroll + the button).
  const handlePaneScroll = () => {
    const el = paneRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottom.current = distance < 120;
    setShowScrollDown(distance > 160);
  };

  // Auto-scroll to the bottom when a new message arrives (only if already near
  // the bottom so we never yank the user out of history).
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    if (wasNearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Jump to a message (pinned rail / search) and flash-highlight it.
  useEffect(() => {
    if (jump === null) return;
    const el = document.getElementById(`msg-${jump.id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("anim-msg-flash");
      const timer = setTimeout(
        () => el.classList.remove("anim-msg-flash"),
        2200,
      );
      return () => clearTimeout(timer);
    }
  }, [jump]);

  const scrollToBottom = () => {
    const el = paneRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    wasNearBottom.current = true;
    setShowScrollDown(false);
  };

  // Slack-style grouping: header only when the sender (or a time gap) changes.
  const isFirstInGroup = (index: number) => {
    if (index === 0) return true;
    const prev = messages[index - 1];
    const curr = messages[index];
    if (senderId(prev) !== senderId(curr)) return true;
    const prevTime = createdAtOf(prev);
    const currTime = createdAtOf(curr);
    if (prevTime && currTime) {
      const gap = new Date(currTime).getTime() - new Date(prevTime).getTime();
      if (!Number.isNaN(gap) && gap > 10 * 60 * 1000) return true;
    }
    return false;
  };

  // Date divider labels per message.
  const dividerLabels = useMemo(() => {
    const labels: Array<string | null> = messages.map(() => null);
    let lastDay = "";
    messages.forEach((message, index) => {
      const key = dayKey(createdAtOf(message));
      if (key && key !== lastDay) {
        labels[index] = dayLabel(createdAtOf(message));
        lastDay = key;
      }
    });
    return labels;
  }, [messages]);

  return (
    <div className="messages-pane" ref={paneRef} onScroll={handlePaneScroll}>
      {messages.length === 0 && (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="message" size={22} />
          </div>
          <b>No messages yet</b>
          <p className="center">
            Start the conversation — say hello and get things moving.
          </p>
        </div>
      )}
      {messages.map((message, index) => {
        const own =
          currentUserId !== null && senderId(message) === currentUserId;
        const header = isFirstInGroup(index);
        const grouped = !header && index > 0;
        const divider = dividerLabels[index];
        const reactions = groupReactions(message.reactions, currentUserId);
        const isEditing = editingId === message.id;
        const pinned = isPinned(message);
        const edited = isEdited(message);
        const attachments = attachmentsOf(message);
        const replyId = replyToOf(message);
        const replyTarget = replyId
          ? messages.find((m) => m.id === replyId) || null
          : null;
        const isFile =
          ["file", "voice"].includes(asWs(message).messageType) ||
          ["file", "voice"].includes(asMessage(message).type);
        const trimmedContent = (message.content || "").trim();
        const isEmojiOnly =
          Boolean(trimmedContent) &&
          EMOJI_ONLY_REGEX.test(trimmedContent) &&
          !MENTION_REGEX.test(trimmedContent) &&
          !URL_REGEX.test(trimmedContent);

        return (
          <React.Fragment key={message.id}>
            {divider && <div className="date-divider">{divider}</div>}
            <article
              id={`msg-${message.id}`}
              className={`message-row ${own ? "own" : ""} ${pinned ? "pinned" : ""} ${grouped ? "grouped" : ""} ${selectedMessageId === message.id ? "selected" : ""}`}
              onContextMenu={(event) => {
                openContextMenu(event, message);
              }}
            >
              <Avatar
                person={{
                  id: senderId(message),
                  first_name:
                    asMessage(message).first_name ||
                    asWs(message).senderFirstName,
                  last_name:
                    asMessage(message).last_name ||
                    asWs(message).senderLastName,
                  status: asMessage(message).status || "offline",
                }}
                photo={
                  asMessage(message).profile_picture ||
                  asWs(message).senderProfilePicture
                }
                showStatus
                className={!header ? "msg-list" : ""}
              />
              <div className="message-content">
                {header && !isEmojiOnly && (
                  <div className="message-heading">
                    <b>{senderName(message)}</b>
                    {own && <span className="you">You</span>}
                    {pinned && (
                      <span className="pin-badge" title="Pinned message">
                        <Icon name="pin" size={11} /> Pinned
                      </span>
                    )}
                    {reminders[message.id] && (
                      <span className="reminder-badge" title="Reminder set">
                        <Icon name="clock" size={11} /> Reminder
                      </span>
                    )}
                    <time title={fullTime(createdAtOf(message))}>
                      {formatTime(createdAtOf(message))}
                    </time>
                  </div>
                )}
                {header && isEmojiOnly && (
                  <div className="emoji-time">
                    <Icon name="check" size={10} />
                    <time title={fullTime(createdAtOf(message))}>
                      {formatTime(createdAtOf(message))}
                    </time>
                  </div>
                )}
                {replyTarget && (
                  <div className="reply-context">
                    <span>↩︎</span>
                    <div>
                      <b>{senderName(replyTarget)}</b> {replyTarget.content}
                    </div>
                  </div>
                )}
                {isEditing ? (
                  <textarea
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        saveEdit(message);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => saveEdit(message)}
                    className="message-edit-input"
                  />
                ) : !isFile || attachments.length === 0 ? (
                  <p
                    className={`message-bubble${isEmojiOnly ? " emoji-only" : ""}`}
                  >
                    <ContentText content={message.content} />
                    {edited && (
                      <EditIndicator
                        timestamp={fullTime(updatedAtOf(message))}
                      />
                    )}
                  </p>
                ) : null}
                {!isEditing && edited && (isFile || attachments.length > 0) && (
                  <EditIndicator timestamp={fullTime(updatedAtOf(message))} />
                )}
                {attachments.length > 0 && (
                  <div className="attachment-list">
                    {attachments.map((att) =>
                      isAudioAttachment(att) ? (
                        <div key={att.id} className="attachment-audio">
                          <VoiceMessage
                            src={resolveFileUrl(att.file_url)}
                            fileSize={att.file_size}
                            fileName={att.file_name.replace(
                              /\.(webm|m4a|mp3|ogg|oga|opus|wav|aac)$/i,
                              "",
                            )}
                          />
                        </div>
                      ) : isImageAttachment(att) ? (
                        <a
                          key={att.id}
                          className="attachment-image"
                          href={resolveFileUrl(att.file_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Open ${att.file_name}`}
                        >
                          <img
                            className="attachment-preview"
                            src={resolveFileUrl(att.file_url)}
                            alt={att.file_name}
                            loading="lazy"
                          />
                          <span className="attachment-image-caption">
                            <Icon name="image" size={12} />
                            <b>{att.file_name}</b>
                            {formatBytes(att.file_size) && (
                              <small>{formatBytes(att.file_size)}</small>
                            )}
                          </span>
                        </a>
                      ) : (
                        <a
                          key={att.id}
                          className="attachment-chip"
                          href={resolveFileUrl(att.file_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span className="attachment-icon">
                            <Icon name={fileIcon(att.file_name)} size={14} />
                          </span>
                          <span>
                            <b>{att.file_name}</b>
                            <small>
                              {formatBytes(att.file_size)} · click to open
                            </small>
                          </span>
                        </a>
                      ),
                    )}
                  </div>
                )}
                {isFile && attachments.length === 0 && (
                  <div className="attachment-chip">
                    <span className="attachment-icon">
                      <Icon name="paperclip" size={14} />
                    </span>
                    <span>
                      <b>File attachment</b>
                    </span>
                  </div>
                )}
                {reactions.length > 0 && (
                  <div className="reactions">
                    {reactions.map(({ emoji, count, mine }) => (
                      <button
                        key={emoji}
                        onClick={() => onReact(message.id, emoji)}
                        className={`anim-reaction-pop ${mine ? "mine" : ""}`}
                        title={mine ? "Remove reaction" : "Add reaction"}
                      >
                        <span className="reaction-emoji">{emoji}</span>
                        {count > 1 && (
                          <span className="reaction-count">{count}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div className="message-actions">
                  <button
                    className="message-menu-trigger"
                    title="More message actions"
                    aria-label="More message actions"
                    onClick={(event) => openContextMenu(event, message)}
                  >
                    <Icon name="more" size={16} />
                  </button>
                  <div className="message-quick-reactions">
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        title={`React ${emoji}`}
                        aria-label={`React ${emoji}`}
                        onClick={() => onReact(message.id, emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <span className="message-actions-divider" aria-hidden="true" />
                  <div className="message-inline-actions">
                    <button title="Reply" aria-label="Reply" onClick={() => onReply(message)}>
                      <Icon name="reply" size={15} />
                    </button>
                    {replyToOf(message) && (
                      <button
                        title="View thread"
                        aria-label="View thread"
                        onClick={() => onReply(message)}
                        className="thread-btn"
                      >
                        <Icon name="message" size={15} />
                      </button>
                    )}
                    <button
                      title="Forward message"
                      aria-label="Forward message"
                      onClick={() => onForward(message)}
                      className="forward-btn"
                    >
                      <Icon name="send" size={15} />
                    </button>
                    <button
                      title={pinned ? "Unpin message" : "Pin message"}
                      aria-label={pinned ? "Unpin message" : "Pin message"}
                      onClick={() => onTogglePin(message)}
                      className={`pin-btn${pinned ? " pinned" : ""}`}
                    >
                      <Icon name="pin" size={15} />
                    </button>
                    <button
                      title={
                        reminders[message.id]
                          ? "Cancel reminder"
                          : "Remind me in 1 hour"
                      }
                      aria-label={
                        reminders[message.id]
                          ? "Cancel reminder"
                          : "Remind me in 1 hour"
                      }
                      onClick={() => onSetReminder(message)}
                      onMouseEnter={() => prefetchReminder(message.id)}
                      className={`reminder-btn${reminders[message.id] ? " active" : ""}`}
                    >
                      <Icon name="clock" size={15} />
                    </button>
                    <button
                      title={bookmarkedIds.has(message.id) ? "Remove bookmark" : "Bookmark message"}
                      aria-label={bookmarkedIds.has(message.id) ? "Remove bookmark" : "Bookmark message"}
                      onClick={() => onBookmark(message.id)}
                      className={`bookmark-btn${bookmarkedIds.has(message.id) ? " active" : ""}`}
                    >
                      <Icon name="bookmark" size={15} />
                    </button>
                    {own && (
                      <button
                        title="Edit message"
                        aria-label="Edit message"
                        onClick={() => startEdit(message)}
                        className="own-action"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                    {own && (
                      <button
                        title="Delete message"
                        aria-label="Delete message"
                        onClick={() => onDelete(message.id)}
                        className="own-action"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          </React.Fragment>
        );
      })}
      {contextMenu && (
        <div
          className="message-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="context-reactions">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                title={`React ${emoji}`}
                onClick={() => {
                  onReact(contextMenu.message.id, emoji);
                  setContextMenu(null);
                }}
              >
                {emoji}
              </button>
            ))}
            <button className="context-more" aria-label="More reactions">
              ⌄
            </button>
          </div>
          <div className="context-actions">
            <button
              onClick={() => {
                onReply(contextMenu.message);
                setContextMenu(null);
              }}
            >
              <Icon name="reply" size={22} /> <span>Reply</span>
            </button>
            {replyToOf(contextMenu.message) && (
              <button
                onClick={() => {
                  onReply(contextMenu.message);
                  setContextMenu(null);
                }}
              >
                <Icon name="message" size={22} /> <span>View thread</span>
              </button>
            )}
            <button
              onClick={() => {
                onTogglePin(contextMenu.message);
                setContextMenu(null);
              }}
            >
              <Icon name="pin" size={22} />{" "}
              <span>{isPinned(contextMenu.message) ? "Unpin" : "Pin"}</span>
            </button>
            <button
              onClick={() => {
                onBookmark(contextMenu.message.id);
                setContextMenu(null);
              }}
            >
              <Icon name="bookmark" size={22} />{" "}
              <span>{bookmarkedIds.has(contextMenu.message.id) ? "Remove bookmark" : "Bookmark"}</span>
            </button>
            <button onClick={() => void copyMessage(contextMenu.message)}>
              <Icon name="copy" size={22} /> <span>Copy text</span>
            </button>
            <button
              onClick={() => {
                onForward(contextMenu.message);
                setContextMenu(null);
              }}
            >
              <Icon name="send" size={22} /> <span>Forward</span>
            </button>
            <button
              onClick={() => {
                setSelectedMessageId((id) =>
                  id === contextMenu.message.id ? null : contextMenu.message.id,
                );
                setContextMenu(null);
              }}
            >
              <Icon name="check" size={22} /> <span>Select</span>
            </button>
            {currentUserId !== null &&
              senderId(contextMenu.message) === currentUserId && (
                <button
                  className="context-danger"
                  onClick={() => {
                    onDelete(contextMenu.message.id);
                    setContextMenu(null);
                  }}
                >
                  <Icon name="trash" size={22} /> <span>Delete</span>
                </button>
              )}
          </div>
        </div>
      )}
      <TypingIndicator names={typingNames} />
      {showScrollDown && (
        <button
          className="scroll-down"
          onClick={scrollToBottom}
          aria-label="Scroll to latest messages"
        >
          <Icon name="chevron-down" size={16} />
        </button>
      )}
    </div>
  );
};

export default MessageList;
