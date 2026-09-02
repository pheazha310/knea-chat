// WebSocket → Zustand bridge.
//
// Subscribes once to the native WebSocket client (services/websocket.ts) and
// dispatches each real-time event to the store that owns that slice of state.
// Registered once from App.tsx; returns an unsubscribe function.
//
//   WebSocket Server → WebSocket Client → Zustand Stores → React Components → UI
import { wsService } from '../services/websocket';
import type { PresenceStatus } from '../models';
import { useAuthStore } from './authStore';
import { useChatStore } from './chatStore';
import { useCompanyStore } from './companyStore';
import { useUserStore } from './userStore';
import { useNotificationStore } from './notificationStore';
import { useAnnouncementStore } from './announcementStore';
import { useCallStore } from './callStore';
import { useMeetingStore } from './meetingStore';
import { useSharedFileStore } from './sharedFileStore';
import { toNumber } from './utils';

export function registerWsListeners(): () => void {
  const unsubs: Array<() => void> = [];

  // Connection lifecycle → chat store (badge/status indicator).
  unsubs.push(
    wsService.on('connection', (payload) => {
      useChatStore.getState().setConnectionStatus(payload);
    }),
  );

  // --- Messages -------------------------------------------------------------
  // Server shape: { type: 'receive_message', message: <serialized message> }
  unsubs.push(
    wsService.on('receive_message', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useChatStore.getState().addMessage(convId, payload.message);
      // Auto-mark the conversation the user is actively viewing as read, so
      // its unread badge doesn't light up while the chat pane is on screen.
      const chat = useChatStore.getState();
      if (chat.viewingChat && convId === chat.activeId) {
        void useNotificationStore.getState().markConversationRead(convId);
      }
    }),
  );

  // Server shape: { type: 'message_sent_ack', data: <serialized message> }
  unsubs.push(
    wsService.on('message_sent_ack', (payload) => {
      const data = payload.data;
      if (!data) return;
      const convId = toNumber(data.conversationId);
      if (convId === null) return;
      useChatStore.getState().addMessage(convId, data);
    }),
  );

  unsubs.push(
    wsService.on('message_updated', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useChatStore
        .getState()
        .applyMessageUpdate(convId, payload.message.id, payload.message.content);
    }),
  );

  unsubs.push(
    wsService.on('message_deleted', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useChatStore.getState().applyMessageDelete(convId, payload.message.id);
    }),
  );

  unsubs.push(
    wsService.on('message_forwarded', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useChatStore.getState().addMessage(convId, payload.message);
    }),
  );

  // Pin state changes broadcast by other clients (SRS FR-11).
  unsubs.push(
    wsService.on('message_pinned', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useChatStore.getState().applyPin(convId, payload.message.id, true);
    }),
  );
  unsubs.push(
    wsService.on('message_unpinned', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useChatStore.getState().applyPin(convId, payload.message.id, false);
    }),
  );

  // Reaction changes broadcast by other clients (SRS FR-16) — keeps every
  // member's reaction list in sync so local `mine` state never goes stale.
  unsubs.push(
    wsService.on('message_reacted', (payload) => {
      const convId = toNumber(payload.data.conversationId);
      if (convId === null) return;
      useChatStore.getState().applyReactions(
        convId,
        payload.data.messageId,
        payload.data.reactions,
      );
    }),
  );
  unsubs.push(
    wsService.on('message_unreacted', (payload) => {
      const convId = toNumber(payload.data.conversationId);
      if (convId === null) return;
      useChatStore.getState().applyReactions(
        convId,
        payload.data.messageId,
        payload.data.reactions,
      );
    }),
  );

  // Bookmark changes
  unsubs.push(
    wsService.on('bookmark_added', (payload) => {
      const messageId = toNumber(payload?.data?.messageId);
      if (messageId === null) return;
      const next = new Set(useChatStore.getState().bookmarkedMessageIds);
      next.add(messageId);
      useChatStore.setState({ bookmarkedMessageIds: next });
    }),
  );
  unsubs.push(
    wsService.on('bookmark_removed', (payload) => {
      const messageId = toNumber(payload?.data?.messageId);
      if (messageId === null) return;
      const set = new Set(useChatStore.getState().bookmarkedMessageIds);
      set.delete(messageId);
      useChatStore.setState({ bookmarkedMessageIds: set });
    }),
  );

  // --- Typing indicators ----------------------------------------------------
  unsubs.push(
    wsService.on('typing_start', (payload) => {
      const { conversationId, userId } = payload.data;
      if (conversationId === undefined || userId === undefined) return;
      useChatStore.getState().setTyping(conversationId, userId, true);
    }),
  );
  unsubs.push(
    wsService.on('typing_stop', (payload) => {
      const { conversationId, userId } = payload.data;
      if (conversationId === undefined || userId === undefined) return;
      useChatStore.getState().setTyping(conversationId, userId, false);
    }),
  );

  // --- Presence -------------------------------------------------------------
  unsubs.push(
    wsService.on('user_online', (payload) => {
      useUserStore.getState().setOnline(payload.data.userId, true);
    }),
  );
  // The server sends a presence snapshot on connect, so a fresh login (or
  // reconnect) immediately shows who was already online instead of showing
  // everyone offline until they act.
  unsubs.push(
    wsService.on('presence_snapshot', (payload) => {
      const ids = payload?.data?.userIds || [];
      for (const id of ids) {
        const userId = toNumber(id);
        if (userId !== null) useUserStore.getState().setOnline(userId, true);
      }
    }),
  );
  unsubs.push(
    wsService.on('user_offline', (payload) => {
      useUserStore.getState().setOnline(payload.data.userId, false);
    }),
  );
  unsubs.push(
    wsService.on('user_status_changed', (payload) => {
      useUserStore
        .getState()
        .setUserStatus(payload.data.userId, payload.data.status as PresenceStatus);
    }),
  );

  // --- Profile / avatar -----------------------------------------------------
  // Live photo updates (avatar changed on /profile) — refresh the people
  // list, cached messages/conversation members, and the auth user when it's
  // their own profile (SRS FR-17).
  unsubs.push(
    wsService.on('user_profile_updated', (payload) => {
      const { userId, profilePicture } = payload.data;
      useUserStore.getState().setUserProfile(userId, profilePicture);
      useChatStore.getState().updateMessageSenderProfile(userId, profilePicture);
      const auth = useAuthStore.getState();
      if (auth.user && Number(auth.user.id) === userId) {
        auth.setUser({ ...auth.user, profile_picture: profilePicture });
      }
    }),
  );

  // --- Workspace (teams / channels) -----------------------------------------
  // The server broadcasts a lightweight `workspace_changed` notice whenever a
  // team or channel changes (create / update / delete / member ops). Clients
  // refetch the affected collection — the server's list endpoints apply
  // per-user filtering (private channel membership, requester team role), so
  // every user sees exactly what they're allowed to, live.
  unsubs.push(
    wsService.on('workspace_changed', (payload) => {
      const kind = payload?.data?.kind;
      if (kind === 'teams') {
        void useCompanyStore.getState().refreshTeams();
      } else if (kind === 'channels') {
        void useChatStore.getState().refreshChannels();
      }
    }),
  );

  // --- Calls (signaling) -----------------------------------------------------
  // A peer is calling this user (or a conversation they are in) — show the
  // incoming-call ring. Accept/decline flow back through the same events.
  unsubs.push(
    wsService.on('incoming_call', (payload) => {
      useCallStore.getState().handleIncoming(payload.data);
    }),
  );
  unsubs.push(
    wsService.on('call_accepted', (payload) => {
      useCallStore.getState().handleAccepted(payload.data);
    }),
  );
  unsubs.push(
    wsService.on('call_declined', (payload) => {
      useCallStore.getState().handleDeclined(payload.data);
    }),
  );
  unsubs.push(
    wsService.on('call_unavailable', (payload) => {
      useCallStore.getState().handleUnavailable(payload.data);
    }),
  );
  unsubs.push(
    wsService.on('call_ended', (payload) => {
      useCallStore.getState().handleEnded(payload.data);
    }),
  );
  unsubs.push(
    wsService.on('call_participants', (payload) => {
      useCallStore.getState().handleParticipants(payload.data);
    }),
  );
  unsubs.push(
    wsService.on('webrtc_offer', (payload) => {
      useCallStore.getState().handleRtcOffer(payload.data);
    }),
  );
  unsubs.push(
    wsService.on('webrtc_answer', (payload) => {
      useCallStore.getState().handleRtcAnswer(payload.data);
    }),
  );
  unsubs.push(
    wsService.on('webrtc_ice', (payload) => {
      useCallStore.getState().handleRtcIce(payload.data);
    }),
  );

  // --- Notifications --------------------------------------------------------
  // Server pushes a `notification` event for mentions/new messages; refresh
  // the list so the bell (and unread badges) stay live. If the notification
  // belongs to the conversation the user is actively viewing, mark it read
  // right away so the badge clears without leaving the chat.
  unsubs.push(
    wsService.on('notification', (payload) => {
      void useNotificationStore.getState().refresh().then(() => {
        const convId = toNumber(payload?.data?.conversationId);
        const chat = useChatStore.getState();
        if (convId !== null && chat.viewingChat && convId === chat.activeId) {
          void useNotificationStore.getState().markConversationRead(convId);
        }
      });
    }),
  );

  // --- Announcements (SRS FR-24) --------------------------------------------
  // Server pushes `announcement_created/updated/deleted`; apply them to the
  // announcements store and refresh notifications (the bell also picks up
  // the per-user `announcement` rows via the `notification` event above).
  unsubs.push(
    wsService.on('announcement_created', (payload) => {
      const announcement = payload?.data?.announcement;
      if (!announcement) return;
      useAnnouncementStore.getState().addAnnouncement(announcement);
      void useNotificationStore.getState().refresh();
    }),
  );
  unsubs.push(
    wsService.on('announcement_updated', (payload) => {
      const announcement = payload?.data?.announcement;
      if (!announcement) return;
      useAnnouncementStore.getState().addAnnouncement(announcement);
    }),
  );
  unsubs.push(
    wsService.on('announcement_deleted', (payload) => {
      const id = toNumber(payload?.data?.id);
      if (id === null) return;
      useAnnouncementStore.getState().removeAnnouncement(id);
    }),
  );

  // --- Shared files (SRS §2) -------------------------------------------------
  unsubs.push(
    wsService.on('shared_file_created', (payload) => {
      const file = payload?.data?.file;
      if (!file) return;
      useSharedFileStore.getState().setFiles([file, ...useSharedFileStore.getState().files], useSharedFileStore.getState().total + 1);
    }),
  );
  unsubs.push(
    wsService.on('shared_file_updated', (payload) => {
      const file = payload?.data?.file;
      if (!file) return;
      useSharedFileStore.getState().setFiles(
        useSharedFileStore.getState().files.map((f) => (f.id === file.id ? file : f)),
        useSharedFileStore.getState().total,
      );
    }),
  );
  unsubs.push(
    wsService.on('shared_file_deleted', (payload) => {
      const fileId = toNumber(payload?.data?.fileId);
      if (fileId === null) return;
      useSharedFileStore.getState().setFiles(
        useSharedFileStore.getState().files.filter((f) => f.id !== fileId),
        useSharedFileStore.getState().total - 1,
      );
    }),
  );
  unsubs.push(
    wsService.on('shared_file_version_uploaded', (payload) => {
      const fileId = toNumber(payload?.data?.fileId);
      if (fileId === null) return;
      const version = payload?.data?.version;
      if (version && useSharedFileStore.getState().versions[0]?.file_id === fileId) {
        useSharedFileStore.getState().setVersions([version, ...useSharedFileStore.getState().versions]);
      }
    }),
  );
  unsubs.push(
    wsService.on('shared_file_permission_granted', (payload) => {
      const permission = payload?.data?.permission;
      if (!permission) return;
      useSharedFileStore.getState().setPermissions([...useSharedFileStore.getState().permissions, permission]);
    }),
  );
  unsubs.push(
    wsService.on('shared_file_permission_revoked', (payload) => {
      const fileId = toNumber(payload?.data?.fileId);
      const userId = toNumber(payload?.data?.userId);
      if (fileId === null || userId === null) return;
      useSharedFileStore.getState().setPermissions(
        useSharedFileStore.getState().permissions.filter(
          (p) => !(p.file_id === fileId && p.user_id === userId),
        ),
      );
    }),
  );

  // --- Meetings ---------------------------------------------------------------
  unsubs.push(
    wsService.on('meeting_created', (payload) => {
      const meeting = payload?.data?.meeting;
      if (!meeting) return;
      const parsed = {
        ...meeting,
        participants: typeof meeting.participants === 'string'
          ? JSON.parse(meeting.participants)
          : meeting.participants || [],
      };
      useMeetingStore.getState().addMeeting(parsed);
      void useNotificationStore.getState().refresh();
    }),
  );
  unsubs.push(
    wsService.on('meeting_updated', (payload) => {
      const meeting = payload?.data?.meeting;
      if (!meeting) return;
      const parsed = {
        ...meeting,
        participants: typeof meeting.participants === 'string'
          ? JSON.parse(meeting.participants)
          : meeting.participants || [],
      };
      useMeetingStore.getState().updateMeetingInList(parsed);
    }),
  );
  unsubs.push(
    wsService.on('meeting_cancelled', (payload) => {
      const meeting = payload?.data?.meeting;
      if (meeting) useMeetingStore.getState().removeMeeting(meeting.id);
    }),
  );
  unsubs.push(
    wsService.on('meeting_note_added', (payload) => {
      const note = payload?.data?.note;
      const meetingId = payload?.data?.meetingId;
      if (!note || meetingId === undefined) return;
      useMeetingStore.getState().loadNotes(meetingId);
    }),
  );
  unsubs.push(
    wsService.on('meeting_note_updated', (payload) => {
      const meetingId = payload?.data?.meetingId;
      if (meetingId === undefined) return;
      useMeetingStore.getState().loadNotes(meetingId);
    }),
  );
  unsubs.push(
    wsService.on('meeting_note_deleted', (payload) => {
      const meetingId = payload?.data?.meetingId;
      if (meetingId === undefined) return;
      useMeetingStore.getState().loadNotes(meetingId);
    }),
  );
  unsubs.push(
    wsService.on('meeting_reminder_set', (payload) => {
      const meetingId = payload?.data?.meetingId;
      if (meetingId === undefined) return;
      useMeetingStore.getState().loadReminders(meetingId);
    }),
  );
  unsubs.push(
    wsService.on('meeting_reminder_deleted', (payload) => {
      const meetingId = payload?.data?.meetingId;
      if (meetingId === undefined) return;
      useMeetingStore.getState().loadReminders(meetingId);
    }),
  );
  unsubs.push(
    wsService.on('meeting_recording_updated', (payload) => {
      const meeting = payload?.data?.meeting;
      if (!meeting) return;
      const parsed = {
        ...meeting,
        participants: typeof meeting.participants === 'string'
          ? JSON.parse(meeting.participants)
          : meeting.participants || [],
      };
      useMeetingStore.getState().updateMeetingInList(parsed);
    }),
  );
  unsubs.push(
    wsService.on('meeting_reminder', (payload) => {
      void useNotificationStore.getState().refresh();
    }),
  );
  unsubs.push(
    wsService.on('meeting_attendee_updated', (payload) => {
      const meetingId = payload?.data?.meetingId;
      if (meetingId === undefined) return;
      useMeetingStore.getState().loadAttendees(meetingId);
    }),
  );
  unsubs.push(
    wsService.on('meeting_attendee_added', (payload) => {
      const meetingId = payload?.data?.meetingId;
      if (meetingId === undefined) return;
      useMeetingStore.getState().loadAttendees(meetingId);
    }),
  );
  unsubs.push(
    wsService.on('meeting_attachment_added', (payload) => {
      const meetingId = payload?.data?.meetingId;
      if (meetingId === undefined) return;
      useMeetingStore.getState().loadAttachments(meetingId);
    }),
  );
  unsubs.push(
    wsService.on('meeting_attachment_deleted', (payload) => {
      const meetingId = payload?.data?.meetingId;
      if (meetingId === undefined) return;
      useMeetingStore.getState().loadAttachments(meetingId);
    }),
  );

  return () => unsubs.forEach((unsub) => unsub());
}