// chatStore — Zustand store for messaging.
//
// Owns channels, conversations, the active conversation, the per-conversation
// message cache, typing indicators and connection status, plus every command
// that mutates them (send/edit/delete, pin, reactions, uploads, opening
// conversations). Real-time events from the WebSocket client are dispatched
// here by wsListeners.ts, so the UI updates automatically.
import { create } from "zustand";
import { ChannelModel, ConversationModel, MessageModel, OmniModel } from "../models";
import type {
  Channel,
  ChatMessage,
  Conversation,
  Message,
  Reaction,
  Team,
} from "../models";
import { wsService } from "../services/websocket";
import type { ConnectionStatus } from "../services/websocket";
import { useAuthStore } from "./authStore";
import { useNotificationStore } from "./notificationStore";
import { getErrorMessage, toNumber } from "./utils";

interface ChatState {
  channels: Channel[];
  conversations: Conversation[];
  activeId: number | null;
  messages: Record<number, ChatMessage[]>;
  typingUsers: Record<number, Set<number>>;
  connectionStatus: ConnectionStatus;
  connectionAttempt: number;
  connectionMaxAttempts: number;
  isLoading: boolean;
  error: string | null;
  /** True while the chat pane (Home view) is on screen. Real-time listeners
   *  use this to auto-mark the open conversation read only when it is visible. */
  viewingChat: boolean;
  /** Message reminders keyed by `messageId` for the current user. */
  reminders: Record<number, { id: number; remind_at: string } | null>;
  /** Bookmarked message ids for the current user. */
  bookmarkedMessageIds: Set<number>;

  // --- setters (used by loads and WebSocket listeners) ---
  setChannels: (channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  setConversations: (conversations: Conversation[]) => void;
  upsertConversation: (conversation: Conversation) => void;
  setMessages: (conversationId: number, messages: ChatMessage[]) => void;
  addMessage: (conversationId: number, message: ChatMessage) => void;
  applyMessageUpdate: (
    conversationId: number,
    messageId: number,
    content: string,
  ) => void;
  applyMessageDelete: (conversationId: number, messageId: number) => void;
  applyPin: (
    conversationId: number,
    messageId: number,
    pinned: boolean,
  ) => void;
  applyReactions: (
    conversationId: number,
    messageId: number,
    reactions: Reaction[],
  ) => void;
  setTyping: (
    conversationId: number,
    userId: number,
    isTyping: boolean,
  ) => void;
  setViewingChat: (viewing: boolean) => void;
  setConnectionStatus: (payload: {
    status: ConnectionStatus;
    attempt?: number;
    maxAttempts?: number;
  }) => void;
  /** Refresh sender photos in cached messages + conversation members. */
  updateMessageSenderProfile: (
    userId: number,
    profilePicture: string | null,
  ) => void;

  // --- loads ---
  load: () => Promise<void>;
  /** Refetch only the channels list (server applies per-user filtering). */
  refreshChannels: () => Promise<void>;
  /** Refetch only the conversation list (used after assignment changes). */
  refreshConversations: () => Promise<void>;
  /** Claim (assign to self/another agent) a Telegram inbox conversation. */
  assignConversation: (conversationId: number, agentId?: number) => Promise<void>;
  /** Unassign the agent from a Telegram inbox conversation. */
  unassignConversation: (conversationId: number) => Promise<void>;
  /** Apply an external conversation's inbox status from a WebSocket event. */
  applyOmniStatus: (conversationId: number, status: 'open' | 'closed') => void;
  loadConversation: (
    conversationId: number,
    force?: boolean,
  ) => Promise<ChatMessage[]>;
  clearMessages: (conversationId?: number) => void;
  /** Reset all chat state (called on logout). */
  clear: () => void;

  // --- navigation ---
  selectConversation: (conversationId: number | null) => void;
  /** Self-join a conversation as the current user (used when opening). */
  ensureMember: (conversation: Conversation) => Promise<Conversation>;
  openDirectWithUser: (userId: number) => Promise<Conversation | null>;
  openChannelConversation: (channel: Channel) => Promise<Conversation | null>;
  /** Open (find-or-create) the conversation backing a team. */
  openTeamConversation: (team: Team) => Promise<Conversation | null>;
  openConversationById: (
    conversationId: number,
  ) => Promise<Conversation | null>;

  // --- sending (WebSocket + REST) ---
  sendMessage: (
    conversationId: number,
    content: string,
    replyTo?: number,
  ) => void;
  /** Resolve the DM with `userId` and send a message — without changing the view. */
  sendDirectMessage: (userId: number, content: string) => Promise<boolean>;
  sendTyping: (conversationId: number, isTyping: boolean) => void;
  sendMessageEdit: (messageId: number, content: string) => void;
  sendMessageDelete: (messageId: number) => void;
  sendMessageForward: (messageId: number, targetConversationId: number) => void;
  uploadAttachment: (
    conversationId: number,
    file: File,
    onProgress?: (pct: number) => void,
  ) => Promise<Message | null>;
  pinMessage: (
    messageId: number,
    conversationId: number,
    pinned: boolean,
  ) => Promise<void>;
  toggleReaction: (
    conversationId: number,
    messageId: number,
    reaction: string,
    knownMine?: boolean,
  ) => Promise<Reaction[] | null>;
  setReminder: (messageId: number) => Promise<void>;
  cancelReminder: (messageId: number) => Promise<void>;
  loadReminder: (messageId: number) => Promise<void>;
  toggleBookmark: (messageId: number) => Promise<void>;
  loadBookmarks: () => Promise<void>;

  // --- workplace ---
  createChannel: (data: {
    name: string;
    description: string;
    type: "public" | "private";
    team_id?: number | null;
    member_ids?: number[];
  }) => Promise<Channel | undefined>;
  createGroupConversation: (
    name: string,
    participantIds: number[],
  ) => Promise<Conversation | undefined>;
}

/** Current signed-in user id from the auth store. */
const currentUserId = (): number | null =>
  useAuthStore.getState().user?.id ?? null;

const ACTIVE_CONVERSATION_KEY = "kneachat_active_conversation";

const readActiveConversation = (userId: number | null): number | null => {
  if (userId === null) return null;
  try {
    const stored = JSON.parse(
      localStorage.getItem(ACTIVE_CONVERSATION_KEY) || "null",
    );
    return stored?.userId === userId &&
      Number.isFinite(Number(stored?.conversationId))
      ? Number(stored.conversationId)
      : null;
  } catch {
    return null;
  }
};

const persistActiveConversation = (conversationId: number | null) => {
  const userId = currentUserId();
  if (userId === null || conversationId === null) return;
  localStorage.setItem(
    ACTIVE_CONVERSATION_KEY,
    JSON.stringify({ userId, conversationId }),
  );
};

/** Message reactions with an in-flight toggle request (guards double-clicks). */
const reactionInFlight = new Set<string>();

/** Fetch the channels list without touching conversations/messages. */
const fetchChannels = async (): Promise<void> => {
  try {
    const res = await ChannelModel.getAll();
    useChatStore.getState().setChannels(res.data.data?.channels || []);
  } catch {
    /* keep the current list on failure */
  }
};

export const useChatStore = create<ChatState>()((set, get) => ({
  channels: [],
  conversations: [],
  activeId: null,
  messages: {},
  typingUsers: {},
  connectionStatus: "disconnected",
  connectionAttempt: 0,
  connectionMaxAttempts: 8,
  isLoading: true,
  error: null,
  viewingChat: false,
  reminders: {},
  bookmarkedMessageIds: new Set<number>(),

  setChannels: (channels) => set({ channels }),
  addChannel: (channel) =>
    set((state) =>
      state.channels.some((c) => c.id === channel.id)
        ? state
        : { channels: [channel, ...state.channels] },
    ),
  setConversations: (conversations) => set({ conversations }),
  upsertConversation: (conversation) =>
    set((state) => ({
      conversations: state.conversations.some((c) => c.id === conversation.id)
        ? state.conversations.map((c) =>
            c.id === conversation.id ? conversation : c,
          )
        : [conversation, ...state.conversations],
    })),
  setMessages: (conversationId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: messages },
    })),
  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messages[conversationId] || [];
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        messages: {
          ...state.messages,
          [conversationId]: [...existing, message],
        },
      };
    }),
  applyMessageUpdate: (conversationId, messageId, content) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) =>
          m.id === messageId ? { ...m, content } : m,
        ),
      },
    })),
  applyMessageDelete: (conversationId, messageId) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).filter(
          (m) => m.id !== messageId,
        ),
      },
    })),
  applyPin: (conversationId, messageId, pinned) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) =>
          m.id === messageId ? { ...m, isPinned: pinned } : m,
        ),
      },
    })),
  /** Replace the reaction list on a message (from WS reaction broadcasts). */
  applyReactions: (conversationId, messageId, reactions) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) =>
          m.id === messageId ? { ...m, reactions } : m,
        ),
      },
    })),
  setTyping: (conversationId, userId, isTyping) =>
    set((state) => {
      const next = new Set(state.typingUsers[conversationId] || []);
      if (isTyping) next.add(userId);
      else next.delete(userId);
      return { typingUsers: { ...state.typingUsers, [conversationId]: next } };
    }),
  setViewingChat: (viewing) => set({ viewingChat: viewing }),
  setConnectionStatus: (payload) =>
    set((state) => ({
      connectionStatus: payload.status,
      connectionAttempt:
        typeof payload.attempt === "number"
          ? payload.attempt
          : state.connectionAttempt,
      connectionMaxAttempts:
        typeof payload.maxAttempts === "number"
          ? payload.maxAttempts
          : state.connectionMaxAttempts,
    })),

  updateMessageSenderProfile: (userId, profilePicture) =>
    set((state) => {
      // Conversation members carry their own photo snapshot — refresh it too,
      // or the members panel / Messages view rows would stay stale until reload.
      const conversations = state.conversations.map((c) => ({
        ...c,
        members: c.members?.map((m) =>
          m.id === userId ? { ...m, profile_picture: profilePicture } : m,
        ),
      }));
      let changed = false;
      const messages: Record<number, ChatMessage[]> = {};
      for (const [key, list] of Object.entries(state.messages)) {
        const updated = list.map((m) => {
          const sender = toNumber(
            (m as Message).sender_id ?? (m as { senderId?: number }).senderId,
          );
          if (sender !== userId) return m;
          return {
            ...m,
            profile_picture: profilePicture,
            senderProfilePicture: profilePicture,
          };
        });
        // map() returns the same object reference for untouched messages, so a
        // reference mismatch means at least one row changed.
        if (!changed) changed = updated.some((m, i) => m !== list[i]);
        messages[key] = updated;
      }
      return { conversations, messages: changed ? messages : state.messages };
    }),

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const [channelsRes, convRes] = await Promise.allSettled([
        ChannelModel.getAll(),
        ConversationModel.getAll(),
      ]);
      if (channelsRes.status === "fulfilled") {
        get().setChannels(channelsRes.value.data.data?.channels || []);
      }
      if (convRes.status === "fulfilled") {
        get().setConversations(convRes.value.data.data?.conversations || []);
      }

      const restoredId = readActiveConversation(currentUserId());
      const restoredConversation = get().conversations.find(
        (c) => c.id === restoredId,
      );
      if (restoredConversation) {
        get().selectConversation(restoredConversation.id);
        await get().loadConversation(restoredConversation.id);
        void useNotificationStore.getState().markConversationRead(restoredConversation.id);
      }
      set({ isLoading: false });
    } catch (err) {
      set({
        error: getErrorMessage(err, "Could not load conversations"),
        isLoading: false,
      });
    }
  },

  refreshChannels: async () => {
    await fetchChannels();
  },

  refreshConversations: async () => {
    try {
      const res = await ConversationModel.getAll();
      get().setConversations(res.data.data?.conversations || []);
    } catch {
      /* keep the current list on failure */
    }
  },

  assignConversation: async (conversationId, agentId) => {
    try {
      await OmniModel.assign(conversationId, agentId);
      await get().refreshConversations();
    } catch (err) {
      set({ error: getErrorMessage(err, "Could not assign conversation") });
    }
  },

  unassignConversation: async (conversationId) => {
    try {
      await OmniModel.unassign(conversationId);
      await get().refreshConversations();
    } catch (err) {
      set({ error: getErrorMessage(err, "Could not unassign conversation") });
    }
  },

  applyOmniStatus: (conversationId, status) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, external_status: status } : c,
      ),
    })),

  loadConversation: async (conversationId, force) => {
    // Only fetch when we have nothing cached yet (prevents stale partial state),
    // unless the caller explicitly asks for a fresh fetch (`force`).
    const cached = get().messages[conversationId];
    if (!force && cached && cached.length > 0) return cached;
    try {
      const res = await ConversationModel.getMessages(conversationId);
      if (res.data?.data) {
        const messages = res.data.data.messages || [];
        get().setMessages(conversationId, messages);
        return messages;
      }
    } catch (err) {
      set({ error: getErrorMessage(err, "Could not load messages") });
    }
    return [];
  },

  clearMessages: (conversationId) =>
    set((state) => {
      if (conversationId === undefined) return { messages: {} };
      const { [conversationId]: _removed, ...rest } = state.messages;
      return { messages: rest };
    }),

  clear: () =>
    set({
      channels: [],
      conversations: [],
      activeId: null,
      messages: {},
      typingUsers: {},
      connectionStatus: "disconnected",
      connectionAttempt: 0,
      connectionMaxAttempts: 8,
      isLoading: true,
      error: null,
      viewingChat: false,
      reminders: {},
      bookmarkedMessageIds: new Set<number>(),
    }),

  selectConversation: (conversationId) => {
    set({ activeId: conversationId });
    persistActiveConversation(conversationId);
    if (conversationId !== null) {
      void useNotificationStore.getState().markConversationRead(conversationId);
    }
  },

  /** Open (find-or-create) a direct conversation with another user. */
  openDirectWithUser: async (userId) => {
    try {
      const res = await ConversationModel.createDirect(userId);
      const conv = res.data?.data?.conversation;
      if (!conv) return null;
      get().upsertConversation(conv);
      get().selectConversation(conv.id);
      void get().loadConversation(conv.id);
      return conv;
    } catch (err) {
      set({
        error: getErrorMessage(err, "Could not open direct conversation"),
      });
      return null;
    }
  },

  /** Ensure the current user is a member of the conversation (self-join, US-14). */
  ensureMember: async (conv: Conversation): Promise<Conversation> => {
    const me = currentUserId();
    if (me === null) return conv;
    const isMember = conv.members?.some((m) => m.id === me);
    if (isMember) return conv;
    try {
      await ConversationModel.addMember(conv.id, me);
      const res = await ConversationModel.get(conv.id);
      const updated = res.data?.data?.conversation;
      if (updated) {
        get().upsertConversation(updated);
        return updated;
      }
    } catch (err) {
      set({ error: getErrorMessage(err, "Failed to join conversation") });
    }
    return conv;
  },

  /** Open (find-or-create) the conversation backing a channel. */
  openChannelConversation: async (channel) => {
    try {
      let existing = get().conversations.find(
        (c) => c.type === "channel" && c.name === channel.name,
      );
      if (!existing) {
        const res = await ConversationModel.create({
          type: "channel",
          name: channel.name,
          description: channel.description || undefined,
        });
        existing = res.data?.data?.conversation;
        if (existing) get().upsertConversation(existing);
      }
      if (existing) existing = await get().ensureMember(existing);
      if (existing) {
        get().selectConversation(existing.id);
        void get().loadConversation(existing.id);
      }
      return existing || null;
    } catch (err) {
      set({
        error: getErrorMessage(err, "Could not open channel conversation"),
      });
      return null;
    }
  },

  /** Open (find-or-create) the conversation backing a team. */
  openTeamConversation: async (team) => {
    try {
      let existing = get().conversations.find(
        (c) => c.type === "team" && c.name === team.name,
      );
      if (!existing) {
        const res = await ConversationModel.create({
          type: "team",
          name: team.name,
          description: team.description || undefined,
        });
        existing = res.data?.data?.conversation;
        if (existing) get().upsertConversation(existing);
      }
      if (existing) existing = await get().ensureMember(existing);
      if (existing) {
        get().selectConversation(existing.id);
        void get().loadConversation(existing.id);
      }
      return existing || null;
    } catch (err) {
      set({ error: getErrorMessage(err, "Could not open team conversation") });
      return null;
    }
  },

  /** Open any conversation by id (used by search results). */
  openConversationById: async (conversationId) => {
    try {
      let existing = get().conversations.find((c) => c.id === conversationId);
      if (!existing) {
        const res = await ConversationModel.get(conversationId);
        existing = res.data?.data?.conversation;
        if (existing) get().upsertConversation(existing);
      }
      if (existing) existing = await get().ensureMember(existing);
      if (existing) {
        get().selectConversation(existing.id);
        void get().loadConversation(existing.id);
      }
      return existing || null;
    } catch (err) {
      set({ error: getErrorMessage(err, "Could not open conversation") });
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------
  sendMessage: (conversationId, content, replyTo) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    // Omni-channel conversations are replied to through the
    // channel endpoint: the server delivers to the customer, persists the
    // outbound message and broadcasts it to the inbox agents.
    const conv = get().conversations.find((c) => c.id === conversationId);
    if (conv?.channel) {
      void OmniModel.reply(conversationId, trimmed, replyTo)
        .then((res) => {
          const message = res.data?.data?.message;
          if (message) get().addMessage(conversationId, message as ChatMessage);
        })
        .catch((err) => {
          set({ error: getErrorMessage(err, `Could not send ${conv.channel} reply`) });
        });
      return;
    }

    // Sent over WebSocket; the server persists it and the ack/broadcast
    // handlers in wsListeners.ts append the stored message to the cache.
    wsService.send("send_message", {
      conversationId,
      content: trimmed,
      ...(replyTo ? { replyTo } : {}),
    });
  },

  sendDirectMessage: async (userId, content) => {
    const trimmed = content.trim();
    if (!trimmed) return false;
    // Resolve the DM from the already-loaded list first (instant), falling
    // back to find-or-create when it isn't known locally yet.
    let conv = get().conversations.find(
      (c) =>
        c.type === "direct" &&
        c.members?.some((m) => Number(m.id) === Number(userId)),
    );
    if (!conv) {
      try {
        const res = await ConversationModel.createDirect(userId);
        conv = res.data?.data?.conversation;
        if (conv) get().upsertConversation(conv);
      } catch (err) {
        set({
          error: getErrorMessage(err, "Could not open direct conversation"),
        });
        return false;
      }
    }
    if (!conv) return false;
    get().sendMessage(conv.id, trimmed);
    return true;
  },

  sendTyping: (conversationId, isTyping) => {
    wsService.send(isTyping ? "typing_start" : "typing_stop", {
      conversationId,
    });
  },

  sendMessageEdit: (messageId, content) => {
    wsService.send("message_edited", { messageId, content });
  },

  sendMessageDelete: (messageId) => {
    wsService.send("message_deleted", { messageId });
  },

  sendMessageForward: (messageId, targetConversationId) => {
    wsService.send("forward_message", { messageId, targetConversationId });
  },

  uploadAttachment: async (conversationId, file, onProgress) => {
    try {
      const res = await MessageModel.upload(conversationId, file, onProgress);
      const message = res.data?.data?.message;
      if (message) get().addMessage(conversationId, message);
      return message || null;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Upload failed"));
    }
  },

  /** Pin/unpin via REST; remote clients sync through the WS broadcast. */
  pinMessage: async (messageId, conversationId, pinned) => {
    try {
      const res = pinned
        ? await MessageModel.unpin(messageId)
        : await MessageModel.pin(messageId);
      const message = res.data?.data?.message;
      if (message) {
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: (state.messages[conversationId] || []).map((m) =>
              m.id === messageId ? { ...m, is_pinned: message.is_pinned } : m,
            ),
          },
        }));
      }
    } catch (err) {
      set({ error: getErrorMessage(err, "Failed to update pin state") });
    }
  },

  /**
   * Toggle a reaction on a message via REST, then sync local state.
   *
   * `knownMine` lets callers that act on a message they may not have cached
   * (e.g. quick reactions from a notification) state whether the current user
   * already placed this reaction: the cached message list wins when the
   * message is loaded, otherwise the hint decides add vs remove. Resolves
   * with the updated reaction list (null on failure).
   */
  toggleReaction: async (conversationId, messageId, reaction, knownMine) => {
    // Guard against rapid double-clicks: only one request per message+reaction
    // at a time, so a fast click can't fire POST then DELETE (or two POSTs)
    // against the same reaction and end up in the wrong state.
    const key = `${messageId}:${reaction}`;
    if (reactionInFlight.has(key)) return null;
    reactionInFlight.add(key);

    const list = get().messages[conversationId] || [];
    const msg = list.find((m) => m.id === messageId);
    const userId = currentUserId();
    const cachedMine =
      msg?.reactions?.some(
        (r) => r.user_id === userId && r.reaction === reaction,
      ) ?? false;
    const mine = msg ? cachedMine : (knownMine ?? false);

    try {
      const res = mine
        ? await MessageModel.removeReaction(messageId, reaction)
        : await MessageModel.addReaction(messageId, reaction);
      const reactions: Reaction[] = res.data?.data?.reactions || [];
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] || []).map((m) =>
            m.id === messageId ? { ...m, reactions } : m,
          ),
        },
      }));
      return reactions;
    } catch (err) {
      set({ error: getErrorMessage(err, "Failed to toggle reaction") });
      return null;
    } finally {
      reactionInFlight.delete(key);
    }
  },

  setReminder: async (messageId) => {
    try {
      const res = await MessageModel.setReminder(messageId);
      const raw = res.data?.data as
        | { reminderId?: number; id?: number; remind_at: string }
        | undefined;
      const data = raw
        ? { id: raw.reminderId ?? raw.id, remind_at: raw.remind_at }
        : null;
      set((state) => ({
        reminders: { ...state.reminders, [messageId]: data },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, "Failed to set reminder") });
    }
  },

  cancelReminder: async (messageId) => {
    try {
      await MessageModel.cancelReminder(messageId);
      set((state) => ({
        reminders: { ...state.reminders, [messageId]: null },
      }));
    } catch (err) {
      set({ error: getErrorMessage(err, "Failed to cancel reminder") });
    }
  },

  loadReminder: async (messageId) => {
    try {
      const res = await MessageModel.getReminder(messageId);
      const data = res.data?.data;
      set((state) => ({
        reminders: { ...state.reminders, [messageId]: data || null },
      }));
    } catch (err) {
      set((state) => ({
        reminders: { ...state.reminders, [messageId]: null },
      }));
    }
  },

  toggleBookmark: async (messageId) => {
    const bookmarks = get().bookmarkedMessageIds;
    try {
      if (bookmarks.has(messageId)) {
        await MessageModel.unbookmark(messageId);
        set((state) => {
          const next = new Set(state.bookmarkedMessageIds);
          next.delete(messageId);
          return { bookmarkedMessageIds: next };
        });
      } else {
        await MessageModel.bookmark(messageId);
        set((state) => {
          const next = new Set(state.bookmarkedMessageIds);
          next.add(messageId);
          return { bookmarkedMessageIds: next };
        });
      }
    } catch {
      // no-op
    }
  },

  loadBookmarks: async () => {
    try {
      const res = await MessageModel.getBookmarks();
      const items = res.data?.data?.bookmarks || [];
      const ids = new Set(items.map((b: any) => Number(b.message_id)));
      set({ bookmarkedMessageIds: ids });
    } catch {
      // keep current set on failure
    }
  },

  // -------------------------------------------------------------------------
  // Workplace management (SRS FR-05..FR-07)
  // -------------------------------------------------------------------------
  createChannel: async (data) => {
    const res = await ChannelModel.create(data);
    const channel = res.data?.data?.channel;
    if (channel) {
      get().addChannel(channel);
      // Company-wide channels auto-join every user on the server seed; also
      // open the conversation immediately for the creator.
      await get().openChannelConversation(channel);
    }
    return channel;
  },

  createGroupConversation: async (name, participantIds) => {
    const res = await ConversationModel.create({
      type: "group",
      name,
      participant_ids: participantIds,
    });
    const conv = res.data?.data?.conversation;
    if (conv) {
      get().upsertConversation(conv);
      get().selectConversation(conv.id);
      void get().loadConversation(conv.id);
    }
    return conv;
  },
}));
