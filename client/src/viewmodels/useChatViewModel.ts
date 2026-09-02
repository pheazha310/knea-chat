// useChatViewModel — MVVM ViewModel layer (Zustand-backed).
//
// Selects the slices the chat screen needs from the Zustand stores and
// exposes the same API the Dashboard has always consumed, so the view stays
// unchanged. All state now lives in `src/store/*`:
//
//   chatStore        → channels, conversations, messages, typing, connection
//   userStore        → people, online users, presence
//   notificationStore→ notifications + unread state
//   companyStore     → teams (+ workspace/settings data)
//
// The single initial load fans out to each store; WebSocket events update the
// stores directly (see store/wsListeners.ts). The load re-runs whenever the
// Dashboard mounts (e.g. after sign-in) so the stores always reflect the
// current session.
import { useEffect } from 'react';
import {
  useChatStore,
  useUserStore,
  useNotificationStore,
  useCompanyStore,
  useAnnouncementStore,
  useMeetingStore,
} from '../store';

export function useChatViewModel() {
  const chat = useChatStore();
  const userState = useUserStore();
  const notif = useNotificationStore();
  const company = useCompanyStore();
  const announcementState = useAnnouncementStore();
  const meetingState = useMeetingStore();

  useEffect(() => {
    void useChatStore.getState().load();
    void useUserStore.getState().fetchUsers();
    void useNotificationStore.getState().load();
    void useCompanyStore.getState().load();
    void useAnnouncementStore.getState().load();
    void useMeetingStore.getState().load();
  }, []);

  return {
    // Workspace data
    channels: chat.channels,
    teams: company.teams,
    users: userState.users,
    conversations: chat.conversations,
    meetings: meetingState.meetings,
    createMeeting: meetingState.createMeeting,
    updateMeeting: meetingState.updateMeeting,
    cancelMeeting: meetingState.cancelMeeting,
    loadMeetings: meetingState.load,
    loadMeetingNotes: meetingState.loadNotes,
    loadMeetingReminders: meetingState.loadReminders,
    createMeetingNote: meetingState.createNote,
    updateMeetingNote: meetingState.updateNote,
    deleteMeetingNote: meetingState.deleteNote,
    setMeetingReminder: meetingState.setReminder,
    deleteMeetingReminder: meetingState.deleteReminder,
    updateMeetingRecording: meetingState.updateRecording,
    updateMeetingCalendar: meetingState.updateCalendar,

    // Notifications
    notifications: notif.notifications,
    unreadCount: notif.unreadCount,
    unreadConversationIds: notif.unreadConversationIds,

    // Announcements (SRS FR-24)
    announcements: announcementState.announcements,

    // Chat session
    activeId: chat.activeId,
    messages: chat.messages,
    typingUsers: chat.typingUsers,
    connectionStatus: chat.connectionStatus,
    connectionAttempt: chat.connectionAttempt,
    connectionMaxAttempts: chat.connectionMaxAttempts,
    onlineUsers: userState.onlineUsers,
    isLoading: chat.isLoading,

    // Commands
    setActiveConversation: chat.selectConversation,
    openDirectWithUser: chat.openDirectWithUser,
    openChannelConversation: chat.openChannelConversation,
    openTeamConversation: chat.openTeamConversation,
    openConversationById: chat.openConversationById,
    sendMessage: chat.sendMessage,
    sendDirectMessage: chat.sendDirectMessage,
    sendTyping: chat.sendTyping,
    updateMessage: chat.sendMessageEdit,
    deleteMessage: chat.sendMessageDelete,
    forwardMessage: chat.sendMessageForward,
    uploadAttachment: chat.uploadAttachment,
    pinMessage: chat.pinMessage,
    toggleReaction: chat.toggleReaction,
    setReminder: chat.setReminder,
    cancelReminder: chat.cancelReminder,
    loadReminder: chat.loadReminder,
    reminders: chat.reminders,
    toggleBookmark: chat.toggleBookmark,
    loadBookmarks: chat.loadBookmarks,
    bookmarkedMessageIds: chat.bookmarkedMessageIds,
    markNotificationRead: notif.markRead,
    markAllNotificationsRead: notif.markAllRead,
    createChannel: chat.createChannel,
    createGroupConversation: chat.createGroupConversation,
    createTeam: company.createTeam,
    refreshTeams: company.refreshTeams,
    refreshNotifications: notif.refresh,
    createAnnouncement: announcementState.createAnnouncement,
    updateAnnouncement: announcementState.updateAnnouncement,
    deleteAnnouncement: announcementState.deleteAnnouncement,
  };
}
