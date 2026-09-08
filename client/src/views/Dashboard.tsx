import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import Sidebar, { type AppView } from "../components/layout/Sidebar";
import ConversationList from "../components/chat/ConversationList";
import MessagesView from "../components/views/MessagesView";
import ChannelsView from "../components/views/ChannelsView";
import TeamsView from "../components/views/TeamsView";
import AnnouncementsView from "../components/views/AnnouncementsView";
import NotifsView from "../components/views/NotifsView";
import NotificationReplyAction from "../components/common/NotificationReplyAction";
import NotificationReactionAction from "../components/common/NotificationReactionAction";
import SettingsView from "../components/views/SettingsView";
import BookmarksView from "../components/views/BookmarksView";
import SharedFilesView from "../components/views/SharedFilesView";
import ThreadPanel from "../components/chat/ThreadPanel";
import MessageList from "../components/chat/MessageList";
import MessageComposer from "../components/chat/MessageComposer";
import WelcomeView from "../components/chat/WelcomeView";
import { MessageSkeleton } from "../components/common/Skeleton";
import { EmptyState } from "../components/common/EmptyState";
import CreateChannelModal from "../components/modals/CreateChannelModal";
import CreateGroupModal from "../components/modals/CreateGroupModal";
import CreateTeamModal from "../components/modals/CreateTeamModal";
import TeamModal from "../components/modals/TeamModal";
import SearchModal from "../components/search/SearchModal";
import SearchView from "../components/views/SearchView";
import Modal from "../components/modals/Modal";
import NotificationMessageModal from "../components/modals/NotificationMessageModal";
import CallModal from "../components/modals/CallModal";
import IncomingCallModal from "../components/modals/IncomingCallModal";
import CreateMeetingModal from "../components/modals/CreateMeetingModal";
import Avatar from "../components/common/Avatar";
import Icon from "../components/common/Icon";
import ConnectionIndicator from "../components/common/ConnectionIndicator";
import {
  useAuthStore,
  useChatStore,
  useCallStore,
  useCompanyStore,
  useAnnouncementStore,
} from "../store";
import { useTheme } from "../contexts/ThemeContext";
import { useToast } from "../contexts/ToastContext";
import { wsService } from "../services/websocket";
import { SystemSettingModel } from "../models";
import { useChatViewModel } from "../viewmodels/useChatViewModel";
import type {
  Channel,
  ChatMessage,
  Conversation,
  MessageSearchResult,
  Notification,
  Team,
  User,
} from "../models";
import { avatarClass } from "../utils/avatar";
import { conversationIdOf } from "../utils/notifications";
import { reactableTargetOf } from "../utils/reactions";
import { roleLabel } from "../utils/roles";
import MeetingsView from "../components/views/MeetingsView";
import AttendanceView from "../components/views/AttendanceView";
import ManagerAttendanceView from "../components/views/ManagerAttendanceView";
import TasksView from "../components/views/TasksView";

/** Shape used by the members panel (conversation members or user fallback). */
type PanelMember = {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: string;
  job_title?: string | null;
  profile_picture?: string | null;
  status?: string;
};

/** Payload shown by the call modal — a 1:1 direct call or a group call. */
type CallTarget = {
  name: string;
  status?: string;
  isGroup?: boolean;
  members?: PanelMember[];
  targetId: number;
  targetType: "user" | "conversation";
  /** Conversation to message during the call. */
  conversationId?: number;
};

/** Pinned-state helper for messages of either shape (REST snake / WS camel). */
const isPinnedMsg = (m: ChatMessage) =>
  "is_pinned" in m ? !!m.is_pinned : !!(m as any).isPinned;

const senderOfMsg = (m: ChatMessage) => {
  const rest = m as any;
  const ws = m as any;
  return [
    rest.first_name || ws.senderFirstName,
    rest.last_name || ws.senderLastName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
};

const statusLabel = (s?: string) =>
  s === "online"
    ? "Online"
    : s === "away"
      ? "Away"
      : s === "dnd"
        ? "Do not disturb"
        : "Offline";

const relativeTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const Dashboard = () => {
  const { user, isAuthenticated, logout } = useAuthStore();
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();
  const activeCall = useCallStore((s) => s.active);
  const incomingCall = useCallStore((s) => s.incoming);
  const startCall = useCallStore((s) => s.startCall);
  const {
    channels,
    teams,
    users,
    conversations,
    notifications,
    announcements,
    unreadCount,
    activeId,
    messages,
    typingUsers,
    connectionStatus,
    connectionAttempt,
    connectionMaxAttempts,
    isLoading,
    openDirectWithUser,
    openChannelConversation,
    openTeamConversation,
    openConversationById,
    sendMessage,
    assignConversation,
    unassignConversation,
    sendTyping,
    updateMessage,
    deleteMessage,
    forwardMessage,
    uploadAttachment,
    pinMessage,
    toggleReaction,
    markNotificationRead,
    markAllNotificationsRead,
    createChannel,
    createGroupConversation,
    createTeam,
    refreshTeams,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    markAnnouncementRead,
    loadAnnouncementReaders,
    setReminder,
    cancelReminder,
    reminders,
    toggleBookmark,
    bookmarkedMessageIds,
    meetings,
    createMeeting,
    updateMeeting,
    cancelMeeting,
  } = useChatViewModel();

  const { departments } = useCompanyStore();

  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [showMembers, setShowMembers] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  // Feature modals
  const [showChatModal, setShowChatModal] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  // The notification whose full message is currently shown in a modal.
  const [viewingMessageNotification, setViewingMessageNotification] =
    useState<Notification | null>(null);
  const [showMeetingFromChat, setShowMeetingFromChat] = useState(false);
  const [viewingTeam, setViewingTeam] = useState<Team | null>(null);
  const [jumpTarget, setJumpTarget] = useState<{
    id: number;
    ts: number;
  } | null>(null);
  const [showPinnedRail, setShowPinnedRail] = useState(true);
  const [threadParent, setThreadParent] = useState<ChatMessage | null>(null);
  const [view, setView] = useState<AppView>("home");
  // Latest view the user asked for — guards the async open handlers from
  // force-switching views after the user has navigated elsewhere.
  const viewRef = useRef<AppView>("home");

  // Keep the chat store in sync with whether the chat pane is actually on
  // screen. Real-time listeners use `viewingChat` to auto-mark the open
  // conversation read ONLY while it is visible — messages arriving while the
  // user is on another view must still light up the unread badges.
  useEffect(() => {
    useChatStore.getState().setViewingChat(view === "home");
  }, [view]);

  // Reply + upload state
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] =
    useState<ChatMessage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const currentUserId = user?.id ?? null;
  const role = user?.role || "employee";
  const canManage =
    role === "super_admin" || role === "admin" || role === "manager";
  // Employees may create channels too — inside teams they belong to
  // (role matrix: "Create channels — according to permission").
  const canCreateChannel = canManage || teams.some((t) => t.user_role);

  // Platform maintenance banner (read-only) — non-super-admins see it while
  // the platform is in maintenance mode. Re-checked periodically so it
  // appears/disappears without a reload.
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  useEffect(() => {
    let mounted = true;
    const check = () =>
      SystemSettingModel.getPublic()
        .then((res) => {
          if (mounted)
            setMaintenanceMode(!!res.data.data.settings?.maintenance_mode);
        })
        .catch(() => {});
    check();
    const timer = window.setInterval(check, 30 * 1000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const activeConversation =
    conversations.find((c) => c.id === activeId) || null;
  const activeChannel =
    activeConversation?.type === "channel"
      ? channels.find((c) => c.name === activeConversation.name) || null
      : null;
  const activeTeam =
    activeConversation?.type === "team"
      ? teams.find((t) => t.name === activeConversation.name) || null
      : null;
  const activeMessages = activeId ? messages[activeId] || [] : [];
  const people = users.filter((u) => u.id !== currentUserId);

  // Who is typing in the active conversation right now?
  const pinnedMessages = activeMessages.filter(isPinnedMsg);

  // Live toasts for mention / new-message notifications.
  useEffect(() => {
    return wsService.on("notification", (payload: any) => {
      const data = payload?.data;
      if (!data) return;
      const type = data.type === "mention" ? "mention" : "message";
      showToast(data.message || data.title, { type, title: data.title });
    });
  }, [showToast]);

  // Unread badge counts keyed `channel:<id>` / `team:<id>` / `user:<id>` for the sidebar.
  const unreadMap = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const n of notifications) {
      if (n.is_read) continue;
      try {
        const raw = typeof n.data === "string" ? JSON.parse(n.data) : n.data;
        const id = Number(raw?.conversationId);
        if (Number.isFinite(id) && id > 0) counts[id] = (counts[id] || 0) + 1;
      } catch {
        // non-JSON data — skip
      }
    }
    const map: Record<string, number> = {};
    for (const conv of conversations) {
      const count = counts[conv.id];
      if (!count) continue;
      if (conv.type === "channel") {
        const ch = channels.find((c) => c.name === conv.name);
        if (ch) map[`channel:${ch.id}`] = count;
      } else if (conv.type === "team") {
        const team = teams.find((t) => t.name === conv.name);
        if (team) map[`team:${team.id}`] = count;
      } else if (conv.type === "direct") {
        const other = conv.members?.find((m) => m.id !== currentUserId);
        if (other) map[`user:${other.id}`] = count;
      }
    }
    return map;
  }, [notifications, conversations, channels, teams, currentUserId]);

  // Unread notifications keyed by conversation id — one parse, shared by the
  // nav badges and the Messages view badges.
  const unreadByConversation = useMemo(() => {
    const perConv: Record<number, number> = {};
    for (const n of notifications) {
      if (n.is_read) continue;
      const id = conversationIdOf(n);
      if (id !== null) perConv[id] = (perConv[id] || 0) + 1;
    }
    return perConv;
  }, [notifications]);

  // Unread badge counts for the sidebar nav rail (one badge per view).
  const navUnread = useMemo(() => {
    let messages = 0;
    let channels = 0;
    for (const conv of conversations) {
      const count = unreadByConversation[conv.id] || 0;
      if (!count) continue;
      if (conv.type === "channel") channels += count;
      else messages += count;
    }
    return { messages, channels, notifs: unreadCount };
  }, [unreadByConversation, conversations, unreadCount]);

  const typingNames = useMemo(() => {
    if (activeId === null) return [];
    const ids = typingUsers[activeId];
    if (!ids || ids.size === 0) return [];
    return Array.from(ids).map((id) => {
      const u = users.find((x) => x.id === id);
      return u ? `${u.first_name} ${u.last_name}` : `User ${id}`;
    });
  }, [typingUsers, activeId, users]);

  // Members panel data: conversation members, with live presence merged in.
  const conversationMembers: PanelMember[] = useMemo(() => {
    const members = activeConversation?.members || [];
    if (members.length > 0) {
      return members.map((m) => ({
        id: m.id,
        first_name: m.first_name,
        last_name: m.last_name,
        email: m.email,
        role: m.role,
        job_title: m.job_title,
        profile_picture: m.profile_picture,
        status: m.status,
      }));
    }
    return people.map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
      role: p.role,
      job_title: p.job_title,
      profile_picture: p.profile_picture,
      status: p.status,
    }));
  }, [activeConversation, people]);

  // Members panel: filter the member list by name / job title / email.
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return conversationMembers;
    return conversationMembers.filter((m) =>
      `${m.first_name} ${m.last_name} ${m.job_title || ""} ${m.email || ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [conversationMembers, memberSearch]);

  const memberStatus = useMemo(() => {
    const map = new Map<number, string>();
    users.forEach((u) => map.set(u.id, u.status));
    return map;
  }, [users]);

  const onlineCount = conversationMembers.filter(
    (m) => memberStatus.get(m.id) === "online",
  ).length;

  // ⌘K / Ctrl+K opens message search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSearchModal(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close popovers when clicking elsewhere.
  useEffect(() => {
    if (!showNotifications && !showProfile) return;
    const close = () => {
      setShowNotifications(false);
      setShowProfile(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showNotifications, showProfile]);

  // Which sidebar item (channel or person) is currently open.
  const selectedKey = useMemo(() => {
    if (!activeConversation) return null;
    if (activeConversation.type === "channel") {
      return activeChannel ? `channel:${activeChannel.id}` : null;
    }
    if (activeConversation.type === "team") {
      return activeTeam ? `team:${activeTeam.id}` : null;
    }
    const other =
      activeConversation.members?.find((m) => m.id !== currentUserId) || null;
    return other ? `user:${other.id}` : null;
  }, [activeConversation, activeChannel, activeTeam, currentUserId]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const handleSelectView = (next: AppView) => {
    viewRef.current = next;
    setView(next);
    setSidebarOpen(false);
    setMembersOpen(false);
  };

  /** Open something, then land on Home — unless the user navigated away. */
  const openThenGoHome = (promise: Promise<unknown>) => {
    const requestedAt = viewRef.current;
    promise.then(() => {
      if (viewRef.current === requestedAt) setView("home");
    });
  };

  const handleSelectChannel = (channel: Channel) => {
    openThenGoHome(openChannelConversation(channel));
  };

  const handleSelectPerson = (person: User) => {
    openThenGoHome(openDirectWithUser(person.id));
  };

  /** Missed-call notifications reply to the caller's DM and open it. */
  const handleReplyMissedCall = async (userId: number, content: string) => {
    setViewingMessageNotification(null);
    const conv = await openDirectWithUser(userId);
    if (!conv) return false;
    openThenGoHome(Promise.resolve());
    sendMessage(conv.id, content);
    return true;
  };

  /** Mention / new-message notifications reply inside the conversation the
   *  user was notified in — threaded to the message when the notification
   *  carries one — and open it. */
  const handleReplyMessage = async (
    conversationId: number,
    content: string,
    messageId?: number,
  ) => {
    setViewingMessageNotification(null);
    const conv = await openConversationById(conversationId);
    if (!conv) return false;
    openThenGoHome(Promise.resolve());
    sendMessage(conversationId, content, messageId);
    return true;
  };

  /** Announcement cards react straight onto the announcement (no navigation). */
  const handleReactAnnouncement = async (
    id: number,
    emoji: string,
    mine: boolean,
  ) => useAnnouncementStore.getState().toggleReaction(id, emoji, mine);

  const handleOpenConversation = (id: number) => {
    openThenGoHome(openConversationById(id));
  };

  /** Clicking a message notification opens its full message and marks it read. */
  const handleOpenMessageNotification = (notification: Notification) => {
    if (!notification.is_read) markNotificationRead(notification.id);
    setShowNotifications(false);
    setViewingMessageNotification(notification);
  };

  /** "Open in conversation" from the full-message modal: jump into the chat
   *  and flash-highlight the message when it is within the loaded window. */
  const handleOpenMessageInChat = async (
    conversationId: number,
    messageId: number,
  ) => {
    setViewingMessageNotification(null);
    const conv = await openConversationById(conversationId);
    if (conv) openThenGoHome(Promise.resolve());
    setJumpTarget({ id: messageId, ts: Date.now() });
  };

  /** Team conversations are restricted to team members + managers/admins. */
  const canAccessTeam = (team: Team) =>
    !!team.user_role ||
    role === "super_admin" ||
    role === "admin" ||
    role === "manager";

  /** Clicking a team in the sidebar opens its shared conversation. */
  const handleSelectTeam = (team: Team) => {
    if (!canAccessTeam(team)) {
      showToast(`You must be a member of ${team.name} to message it`, {
        type: "info",
        title: "Team conversation restricted",
      });
      return;
    }
    openThenGoHome(openTeamConversation(team));
  };

  /** Team management (members/channels) stays in the Teams view + modal. */
  const handleManageTeam = (team: Team) => {
    setViewingTeam(team);
    setShowTeamModal(true);
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (activeId === null) return;
    if (value && !isTyping) {
      setIsTyping(true);
      sendTyping(activeId, true);
    }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      setIsTyping(false);
      if (activeId !== null) sendTyping(activeId, false);
    }, 900);
  };

  const handleSend = () => {
    const content = draft.trim();
    if (!content || activeId === null) return;
    sendMessage(activeId, content, replyTo?.id);
    setDraft("");
    setReplyTo(null);
    setIsTyping(false);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
  };

  const handleSendFile = async (file: File) => {
    if (activeId === null) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      await uploadAttachment(activeId, file, setUploadProgress);
    } catch (err: any) {
      alert(err.message || "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleReact = (
    conversationId: number,
    messageId: number,
    emoji: string,
  ) => {
    toggleReaction(conversationId, messageId, emoji);
  };

  const handleEdit = (messageId: number, content: string) => {
    updateMessage(messageId, content);
  };

  const handleDelete = (messageId: number) => {
    deleteMessage(messageId);
  };

  const handleReply = (message: ChatMessage) => {
    setReplyTo(message);
    setThreadParent(message);
  };

  const handleTogglePin = (message: ChatMessage) => {
    if (activeId === null) return;
    const pinned =
      "is_pinned" in message
        ? !!message.is_pinned
        : !!(message as any).isPinned;
    pinMessage(message.id, activeId, pinned);
  };

  const handleSetReminder = async (message: ChatMessage) => {
    if (activeId === null) return;
    const reminder = reminders[message.id];
    if (reminder) {
      await cancelReminder(message.id);
    } else {
      await setReminder(message.id);
    }
  };

  const handleToggleBookmark = async (messageId: number) => {
    await toggleBookmark(messageId);
  };

  const handleForward = (message: ChatMessage) => {
    setForwardingMessage(message);
  };

  const handleForwardConfirm = async (targetConversationId: number) => {
    if (!forwardingMessage) return;
    try {
      await forwardMessage(forwardingMessage.id, targetConversationId);
      showToast("Message forwarded");
    } catch (err: any) {
      showToast(err.message || "Failed to forward message");
    } finally {
      setForwardingMessage(null);
    }
  };

  const handleJumpToMessage = (result: MessageSearchResult) => {
    setShowSearchModal(false);
    openThenGoHome(openConversationById(result.conversation_id));
  };

  const handleJumpToUser = (target: User) => {
    setShowSearchModal(false);
    openThenGoHome(openDirectWithUser(target.id));
  };

  /**
   * Call/video-call target for the active conversation. Direct conversations
   * ring the other user; channel/team/group conversations become group calls
   * named after the conversation (with all members as participants).
   */
  const callTarget = (conv: Conversation): CallTarget => {
    if (conv.type === "direct") {
      const other = conv.members?.find((m) => m.id !== currentUserId);
      return {
        name: other ? `${other.first_name} ${other.last_name}` : "User",
        status: other?.status || "offline",
        targetId: other?.id ?? conv.id,
        targetType: "user",
        conversationId: conv.id,
      };
    }
    return {
      name:
        conv.type === "channel" ? `#${conv.name}` : conv.name || "Conversation",
      isGroup: true,
      members: conversationMembers,
      targetId: conv.id,
      targetType: "conversation",
      conversationId: conv.id,
    };
  };

  const handleCall = () => {
    if (!activeConversation) return;
    const target = callTarget(activeConversation);
    startCall({ type: "voice", ...target });
  };

  const handleVideoCall = () => {
    if (!activeConversation) return;
    const target = callTarget(activeConversation);
    startCall({ type: "video", ...target });
  };

  const handleInfo = () => {
    if (!activeConversation) return;
    setShowInfoPanel((v) => !v);
  };

  const filterText = search.toLowerCase();

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <button
          className="mobile-menu"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Toggle navigation"
        >
          <Icon name="menu" size={18} />
        </button>
        <div className="brand">
          <span className="brand-mark">k</span>
          <span>KneaChat</span>
        </div>
        <label className="search">
          <Icon name="search" size={14} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (view !== "home") handleSelectView("home");
            }}
            placeholder="Search channels and people"
          />
          <kbd>⌘K</kbd>
        </label>
        <div className="top-actions">
          <ConnectionIndicator
            status={connectionStatus}
            attempt={connectionAttempt}
            maxAttempts={connectionMaxAttempts}
          />
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            aria-label="Toggle dark mode"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
          {(role === "manager" ||
            role === "admin" ||
            role === "super_admin") && (
            <Link to="/manage" className="admin-link">
              Manage
            </Link>
          )}
          {role === "admin" && (
            <Link to="/admin" className="admin-link">
              Admin
            </Link>
          )}
          {role === "super_admin" && (
            <Link to="/platform" className="admin-link">
              Platform
            </Link>
          )}
          <button
            className="icon-button notification-button"
            aria-label="Notifications"
            onClick={(e) => {
              e.stopPropagation();
              setShowNotifications((v) => !v);
              setShowProfile(false);
            }}
          >
            <Icon name="bell" size={15} />
            {unreadCount > 0 && <b>{unreadCount > 9 ? "9+" : unreadCount}</b>}
          </button>
          {showNotifications && (
            <div
              className="notification-popover"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="notif-popover-header">
                <div>
                  <b>Notifications</b>
                  {unreadCount > 0 && (
                    <span className="notif-popover-badge">{unreadCount} unread</span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    className="notif-popover-mark-read"
                    onClick={markAllNotificationsRead}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="popover-empty">You're all caught up 🎉</div>
              ) : (
                <ul className="popover-list">
                  {notifications.slice(0, 8).map((n) => {
                    const unread = !n.is_read;
                    return (
                      <li key={n.id} className={unread ? 'unread' : ''}>
                        <div className="popover-row">
                          <span className={`popover-icon ${unread ? 'unread' : ''}`}>
                            <Icon name={n.type === 'mention' ? 'at' : n.type === 'announcement' ? 'bell' : n.type === 'task_assigned' || n.type === 'task_deadline' ? 'check-circle' : n.type === 'meeting_invite' || n.type === 'meeting_reminder' ? 'calendar' : n.type === 'missed_call' ? 'phone' : 'message'} size={14} />
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const target = reactableTargetOf(n);
                              if (target && target.kind === 'message') {
                                handleOpenMessageNotification(n);
                              } else if (!n.is_read) {
                                markNotificationRead(n.id);
                              }
                            }}
                            className={`popover-main ${unread ? '' : 'popover-read'}`}
                            title={
                              reactableTargetOf(n)?.kind === 'message'
                                ? 'View full message'
                                : undefined
                            }
                          >
                            <span className="popover-title">{n.title}</span>
                            {n.message && <span className="popover-message">{n.message}</span>}
                            <time>{relativeTime(n.created_at)}</time>
                          </button>
                          <div className="popover-actions">
                            <NotificationReactionAction
                              notification={n}
                              onAcknowledged={() => markNotificationRead(n.id)}
                            />
                            <NotificationReplyAction
                              notification={n}
                              onReplyMissedCall={handleReplyMissedCall}
                              onReplyMessage={handleReplyMessage}
                              onSent={() => {
                                markNotificationRead(n.id);
                                setShowNotifications(false);
                              }}
                            />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          <button
            className={`profile-button${showProfile ? ' open' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowProfile((v) => !v);
              setShowNotifications(false);
            }}
            aria-label="Open profile menu"
            aria-expanded={showProfile}
          >
            <Avatar person={user} className="small" showStatus />
            <Icon name="chevron-down" size={12} className="profile-chevron" />
          </button>
          {showProfile && (
            <div
              className="notification-popover profile-popover"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="profile-popover-identity">
                <Avatar
                  person={user}
                  className="profile-popover-avatar"
                  showStatus
                />
              </div>
              <p>
                <b>
                  {user?.first_name} {user?.last_name}
                </b>
                <small>
                  {user?.email} · {roleLabel(user?.role)}
                </small>
              </p>
              <Link to="/profile" className="popover-link">
                Edit profile
              </Link>
              <button onClick={logout} className="popover-danger">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {maintenanceMode && role !== "super_admin" && (
        <div className="maintenance-banner" role="status">
          <span className="maintenance-banner-icon" aria-hidden="true">
            🛠
          </span>
          <span>
            <b>KneaChat is under maintenance</b> — some features may be
            temporarily unavailable while the platform team works on things.
            Thank you for your patience.
          </span>
        </div>
      )}

      <div
        className={`sidebar-backdrop ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <div
        className={`members-backdrop ${membersOpen ? "open" : ""}`}
        onClick={() => setMembersOpen(false)}
      />
      <div
        className={`app-grid ${view === "home" && activeConversation ? "has-members" : ""}`}
      >
        <Sidebar
          view={view}
          onSelectView={handleSelectView}
          unreadCounts={navUnread}
          user={user}
        />

        <section className="conversation">
          {view === "home" ? (
            <div
              className={`home-view ${activeConversation ? "" : "home-dashboard"}`}
            >
              <ConversationList
                channels={channels}
                teams={teams}
                people={people}
                selectedKey={selectedKey}
                unreadMap={unreadMap}
                canManage={canManage}
                filterText={filterText}
                onSelectChannel={handleSelectChannel}
                onSelectPerson={handleSelectPerson}
                onSelectTeam={handleSelectTeam}
                onCreateChannel={() => setShowChannelModal(true)}
                onCreateChat={() => setShowChatModal(true)}
                onCreateTeam={() => setShowCreateTeamModal(true)}
              />
              <div className="home-chat">
                {threadParent && (
                  <ThreadPanel
                    parentMessage={threadParent}
                    onClose={() => setThreadParent(null)}
                  />
                )}
                {activeConversation ? (
                  <>
                    <header className="chat-header" role="banner">
                      <div className="chat-header-info">
                        {activeConversation.type === "direct" && (
                          <span
                            className={`${avatarClass(activeConversation.members?.find((m) => m.id !== currentUserId)?.id)} small`}
                            style={{ marginRight: 8 }}
                          >
                            {activeConversation.members?.find(
                              (m) => m.id !== currentUserId,
                            )?.first_name?.[0] ?? "U"}
                            {activeConversation.members?.find(
                              (m) => m.id !== currentUserId,
                            )?.last_name?.[0] ?? ""}
                            <i
                              className={
                                activeConversation.members?.find(
                                  (m) => m.id !== currentUserId,
                                )?.status || "offline"
                              }
                            />
                          </span>
                        )}
                        <h3>
                          {activeConversation.type === "channel" ? "# " : ""}
                          {activeConversation.name}
                        </h3>
                        {activeConversation.type === "channel" ? (
                          <p>
                            {activeChannel?.description ||
                              "Channel conversation"}
                          </p>
                        ) : activeConversation.type === "team" ? (
                          <p>
                            {activeTeam?.description || "Team conversation"}
                          </p>
                        ) : activeConversation.type === "direct" ? (
                          <p
                            className={`conv-status ${activeConversation.members?.find((m) => m.id !== currentUserId)?.status || "offline"}`}
                          >
                            <i aria-hidden="true" />
                            {statusLabel(
                              activeConversation.members?.find(
                                (m) => m.id !== currentUserId,
                              )?.status,
                            )}
                          </p>
                        ) : (
                          <p>
                            {activeConversation.description || "Conversation"}
                          </p>
                        )}
                      </div>
                      <div className="chat-header-actions">
                        <button
                          className="member-count"
                          title="Toggle members"
                          onClick={() => {
                            const next = !showMembers;
                            setShowMembers(next);
                            setMembersOpen(next);
                          }}
                        >
                          <Icon name="users" size={16} />
                          {conversationMembers.length > 0 && (
                            <span className="member-count-badge">
                              {conversationMembers.length}
                            </span>
                          )}
                        </button>
                        <span className="action-divider" aria-hidden="true" />
                        <button
                          className="icon-button"
                          title="Search messages (⌘K)"
                          onClick={() => setShowSearchModal(true)}
                        >
                          <Icon name="search" size={15} />
                        </button>
                        {activeConversation && (
                          <>
                            <span
                              className="action-divider"
                              aria-hidden="true"
                            />
                            <button
                              className="icon-button"
                              title="Call"
                              onClick={handleCall}
                            >
                              <Icon name="phone" size={15} />
                            </button>
                            <button
                              className="icon-button"
                              title="Video call"
                              onClick={handleVideoCall}
                            >
                              <Icon name="video" size={15} />
                            </button>
                          </>
                        )}
                        <span className="action-divider" aria-hidden="true" />
                        <button
                          className="icon-button"
                          title="Conversation info"
                          onClick={handleInfo}
                        >
                          <Icon name="info" size={15} />
                        </button>
                      </div>
                    </header>

                    {!isLoading &&
                      activeConversation &&
                      pinnedMessages.length > 0 &&
                      showPinnedRail && (
                        <div className="pinned-rail">
                          <div className="pinned-rail-header">
                            <Icon name="pin" size={13} /> Pinned messages
                            <button
                              onClick={() => setShowPinnedRail(false)}
                              aria-label="Hide pinned messages"
                            >
                              <Icon name="x" size={12} />
                            </button>
                          </div>
                          <ul>
                            {pinnedMessages.map((m) => (
                              <li key={m.id}>
                                <button
                                  onClick={() =>
                                    setJumpTarget({ id: m.id, ts: Date.now() })
                                  }
                                  title="Jump to message"
                                >
                                  <b>{senderOfMsg(m) || "Message"}</b>
                                  <span>{m.content}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {isLoading ? (
                      <div
                        className="messages-pane"
                        role="status"
                        aria-label="Loading messages"
                      >
                        {Array.from({ length: 5 }).map((_, i) => (
                          <MessageSkeleton key={i} />
                        ))}
                      </div>
                    ) : activeMessages.length === 0 ? (
                      <EmptyState
                        icon="message"
                        title="No messages yet"
                        description="Start the conversation — send a message to get things moving."
                      />
                    ) : (
                      <MessageList
                        messages={activeMessages}
                        currentUserId={currentUserId}
                        typingNames={typingNames}
                        jump={jumpTarget}
                        onReact={(messageId, emoji) =>
                          handleReact(activeConversation.id, messageId, emoji)
                        }
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onReply={handleReply}
                        onTogglePin={handleTogglePin}
                        onSetReminder={handleSetReminder}
                        reminders={reminders}
                        onForward={handleForward}
                        onBookmark={handleToggleBookmark}
                        bookmarkedIds={bookmarkedMessageIds}
                      />
                    )}

                     <MessageComposer
                       draft={draft}
                       onDraftChange={handleDraftChange}
                       onSend={handleSend}
                       active={activeConversation}
                       replyTo={replyTo}
                       onClearReply={() => setReplyTo(null)}
                       users={people}
                       onSendFile={handleSendFile}
                       uploading={uploading}
                       uploadProgress={uploadProgress}
                       onCreateMeeting={activeConversation ? () => setShowMeetingFromChat(true) : undefined}
                     />
                    <p className="composer-hint">
                      Press <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+
                      <kbd>Enter</kbd> for a new line · <kbd>@</kbd> to mention
                      · <kbd>⌘K</kbd> to search · <Icon name="mic" size={10} />{" "}
                      to record a voice note
                    </p>
                  </>
                ) : (
                  <WelcomeView
                    user={user}
                    onlineCount={onlineCount}
                    unreadCount={unreadCount}
                    channelCount={channels.length}
                    teamCount={teams.length}
                    notifications={notifications}
                    onBrowseChannels={() => handleSelectView("channels")}
                    onStartChat={() => setShowChatModal(true)}
                    onSearch={() => setShowSearchModal(true)}
                  />
                )}
              </div>
            </div>
          ) : view === "messages" ? (
            <MessagesView
              conversations={conversations}
              people={people}
              currentUserId={currentUserId}
              messages={messages}
              unreadMap={unreadMap}
              convUnreadMap={unreadByConversation}
              onOpenConversation={handleOpenConversation}
              onOpenDirect={handleSelectPerson}
              onCreateChat={() => setShowChatModal(true)}
              onAssignConversation={(id, agentId) =>
                void assignConversation(id, agentId)
              }
              onUnassignConversation={(id) => void unassignConversation(id)}
            />
          ) : view === "channels" ? (
            <ChannelsView
              channels={channels}
              unreadMap={unreadMap}
              canCreateChannel={canCreateChannel}
              onOpenChannel={handleSelectChannel}
              onCreateChannel={() => setShowChannelModal(true)}
            />
          ) : view === "teams" ? (
            <TeamsView
              teams={teams}
              channels={channels}
              canManage={canManage}
              onSelectTeam={handleManageTeam}
              onCreateTeam={() => setShowCreateTeamModal(true)}
            />
          ) : view === "announcements" ? (
            <AnnouncementsView
              announcements={announcements}
              currentUserId={currentUserId}
              canPublish={canManage}
              departments={departments}
              teams={teams}
              onCreate={createAnnouncement}
              onUpdate={updateAnnouncement}
              onDelete={deleteAnnouncement}
              onMarkRead={markAnnouncementRead}
              onLoadReaders={loadAnnouncementReaders}
              onToggleReaction={handleReactAnnouncement}
            />
          ) : view === "meetings" ? (
            <MeetingsView
              meetings={meetings}
              currentUserId={currentUserId}
              canSchedule={canManage}
              onCreate={createMeeting}
              onUpdate={updateMeeting}
              onCancel={cancelMeeting}
              onStartCall={startCall}
              teams={teams}
              departments={departments}
              users={users}
            />
          ) : view === "attendance" ? (
            canManage ? (
              <ManagerAttendanceView
                departments={departments}
                users={users}
              />
            ) : (
              <AttendanceView />
            )
          ) : view === "tasks" ? (
            <TasksView
              users={users}
              teams={teams}
              canManage={canManage}
              currentUserId={currentUserId}
            />
          ) : view === "notifs" ? (
            <NotifsView
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={markNotificationRead}
              onMarkAllRead={markAllNotificationsRead}
              onReplyMissedCall={handleReplyMissedCall}
              onReplyMessage={handleReplyMessage}
              onOpenMessageNotification={handleOpenMessageNotification}
            />
          ) : view === "bookmarks" ? (
            <BookmarksView
              onOpenConversation={(id) => handleOpenConversation(id)}
            />
          ) : view === "files" ? (
            <SharedFilesView
              teams={teams}
              conversations={conversations}
              canManage={canManage}
              currentUserId={currentUserId}
              onOpenConversation={(id) => handleOpenConversation(id)}
            />
          ) : view === "search" ? (
            <SearchView
              currentUserId={currentUserId}
              users={users}
              teams={teams}
              channels={channels}
              departments={departments}
              onOpenConversation={handleOpenConversation}
              onOpenDirect={handleSelectPerson}
              onOpenChannel={handleSelectChannel}
              onOpenTeam={handleSelectTeam}
              onGoToView={handleSelectView}
            />
          ) : (
            <SettingsView
              theme={theme}
              onToggleTheme={toggleTheme}
              user={user}
            />
          )}
        </section>

        {view === "home" && activeConversation && (
          <aside
            className={`members-panel ${showMembers ? "" : "hidden"} ${membersOpen ? "open" : ""}`}
          >
            <header>
              <h2>
                Members <span>{conversationMembers.length}</span>
              </h2>
              <button
                onClick={() => setShowMembers(false)}
                aria-label="Close members panel"
              >
                <Icon name="x" size={12} />
              </button>
            </header>
            <div className="member-search">
              <Icon name="search" size={13} />
              <input
                placeholder="Search members"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                aria-label="Search members"
              />
              {memberSearch && (
                <button
                  className="member-search-clear"
                  onClick={() => setMemberSearch("")}
                  aria-label="Clear member search"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
            {filteredMembers.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 12px" }}>
                <div style={{ color: "var(--text-faint)" }}>
                  <Icon name="users" size={24} />
                </div>
                <p
                  style={{
                    fontSize: 12,
                    marginTop: 8,
                    color: "var(--text-muted)",
                  }}
                >
                  {memberSearch
                    ? `No members match \u201c${memberSearch}\u201d`
                    : "No members yet"}
                </p>
              </div>
            ) : (
              <>
                <div className="online-label">
                  <i className="label-dot" aria-hidden="true" />
                  ONLINE —{" "}
                  {
                    filteredMembers.filter(
                      (m) => memberStatus.get(m.id) === "online",
                    ).length
                  }
                </div>
                {filteredMembers
                  .filter((m) => memberStatus.get(m.id) === "online")
                  .map((member) => (
                    <button
                      className="member"
                      key={member.id}
                      onClick={() =>
                        member.id !== currentUserId &&
                        openDirectWithUser(member.id)
                      }
                    >
                      <Avatar
                        person={{
                          ...member,
                          status: memberStatus.get(member.id) || "offline",
                        }}
                        className="small"
                        showStatus
                      />
                      <span>
                        <span className="member-name-row">
                          <b>
                            {member.first_name} {member.last_name}
                          </b>
                          {member.role && (
                            <em className="role-badge">
                              {roleLabel(member.role)}
                            </em>
                          )}
                        </span>
                        <small>{member.job_title || member.email}</small>
                      </span>
                    </button>
                  ))}
                <div className="online-label offline-label">
                  <i className="label-dot" aria-hidden="true" />
                  OFFLINE —{" "}
                  {
                    filteredMembers.filter(
                      (m) => memberStatus.get(m.id) !== "online",
                    ).length
                  }
                </div>
                {filteredMembers
                  .filter((m) => memberStatus.get(m.id) !== "online")
                  .map((member) => (
                    <button
                      className="member"
                      key={member.id}
                      onClick={() =>
                        member.id !== currentUserId &&
                        openDirectWithUser(member.id)
                      }
                    >
                      <Avatar
                        person={{ ...member, status: "offline" }}
                        className="small"
                        showStatus
                      />
                      <span>
                        <span className="member-name-row">
                          <b>
                            {member.first_name} {member.last_name}
                          </b>
                          {member.role && (
                            <em className="role-badge">
                              {roleLabel(member.role)}
                            </em>
                          )}
                        </span>
                        <small>{member.job_title || member.email}</small>
                      </span>
                    </button>
                  ))}
              </>
            )}
          </aside>
        )}
      </div>

      {showChatModal && (
        <CreateGroupModal
          users={users}
          currentUserId={currentUserId}
          onClose={() => setShowChatModal(false)}
          onDirect={async (id) => {
            await openDirectWithUser(id);
          }}
          onCreateGroup={createGroupConversation}
        />
      )}
      {showChannelModal && (
        <CreateChannelModal
          teams={teams}
          users={users}
          currentRole={role}
          onClose={() => setShowChannelModal(false)}
          onCreate={createChannel}
        />
      )}
      {showCreateTeamModal && (
        <CreateTeamModal
          users={users}
          onClose={() => setShowCreateTeamModal(false)}
          onCreate={createTeam}
        />
      )}
      {showTeamModal && viewingTeam && (
        <TeamModal
          team={viewingTeam}
          channels={channels}
          users={users}
          currentUserId={currentUserId}
          currentRole={role}
          onClose={() => {
            setShowTeamModal(false);
            setViewingTeam(null);
          }}
          onOpenChannel={handleSelectChannel}
          onMessageTeam={handleSelectTeam}
          onMembersChanged={refreshTeams}
        />
      )}
      {showSearchModal && (
        <SearchModal
          onClose={() => setShowSearchModal(false)}
          onJumpToMessage={handleJumpToMessage}
          onJumpToUser={handleJumpToUser}
        />
      )}
      {activeCall && <CallModal call={activeCall} />}
      {incomingCall && <IncomingCallModal call={incomingCall} />}
      {showInfoPanel && activeConversation && (
        <div
          className="conversation-info-panel"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="conversation-info-header">
            <h3>Conversation info</h3>
            <button
              className="icon-button"
              onClick={() => setShowInfoPanel(false)}
              aria-label="Close info"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="conversation-info-body">
            <div className="text-center mb-5">
              {activeConversation.type === "direct" ? (
                <Avatar
                  person={activeConversation.members?.find(
                    (m) => m.id !== currentUserId,
                  )}
                  className="profile-lg"
                  showStatus
                />
              ) : (
                <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-soft text-2xl text-lavender border border-line">
                  {activeConversation.type === "channel" ? (
                    "#"
                  ) : activeConversation.type === "team" ? (
                    <Icon name="grid" size={28} />
                  ) : (
                    "💬"
                  )}
                </span>
              )}
              <h4 className="mt-3 text-base font-bold text-ink">
                {activeConversation.type === "channel" ? "# " : ""}
                {activeConversation.name}
              </h4>
              <span
                className={`status-pill ${activeConversation.type === "channel" ? "public" : activeConversation.type === "team" ? "member" : "active"}`}
              >
                {activeConversation.type}
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Members</span>
                <span className="font-semibold text-ink">
                  {conversationMembers.length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Online</span>
                <span className="font-semibold text-ink">{onlineCount}</span>
              </div>
              {activeConversation.type === "channel" && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Description</span>
                  <span className="font-semibold text-ink text-right max-w-[200px]">
                    {activeChannel?.description || "—"}
                  </span>
                </div>
              )}
              {activeConversation.type === "team" && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Description</span>
                  <span className="font-semibold text-ink text-right max-w-[200px]">
                    {activeTeam?.description || "—"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {forwardingMessage && (
        <Modal
          title="Forward message"
          onClose={() => setForwardingMessage(null)}
          width={400}
        >
          <div className="forward-modal">
            <p className="text-sm text-muted mb-3">Forward to:</p>
            <div className="conversation-picker">
              {conversations.filter((c) => c.id !== activeId).length === 0 ? (
                <p className="text-sm text-muted">
                  No other conversations available.
                </p>
              ) : (
                conversations
                  .filter((c) => c.id !== activeId)
                  .map((conv) => (
                    <button
                      key={conv.id}
                      className="conversation-picker-item"
                      onClick={() => handleForwardConfirm(conv.id)}
                    >
                      <span className="conv-icon">
                        {conv.type === "channel" ? (
                          "#"
                        ) : conv.type === "team" ? (
                          <Icon name="grid" size={14} />
                        ) : (
                          "💬"
                        )}
                      </span>
                      <span className="conv-name">
                        {conv.name || "Conversation"}
                      </span>
                      <span className="conv-type">{conv.type}</span>
                    </button>
                  ))
              )}
            </div>
          </div>
        </Modal>
      )}
      {showMeetingFromChat && activeConversation && (
        <CreateMeetingModal
          users={people}
          currentUserId={currentUserId}
          selectedDate={new Date().toISOString().split('T')[0]}
          onClose={() => setShowMeetingFromChat(false)}
          onSubmit={async (data) => {
            const participants = activeConversation.type === 'direct'
              ? [activeConversation.id, currentUserId]
              : activeConversation.members?.map((m: any) => m.user_id || m.id) || [];
            const uniqueParticipants = participants.filter((v: number, i: number, a: number[]) => a.indexOf(v) === i);
            const result = await createMeeting({
              ...data,
              participants: uniqueParticipants,
            });
            setShowMeetingFromChat(false);
            if (result) {
              showToast('Meeting created from conversation', { type: 'success' });
            }
            return result;
          }}
        />
      )}
      {viewingMessageNotification && (
        <NotificationMessageModal
          notification={viewingMessageNotification}
          onClose={() => setViewingMessageNotification(null)}
          onOpenInChat={handleOpenMessageInChat}
          onReplyMessage={handleReplyMessage}
          onReplyMissedCall={handleReplyMissedCall}
          onAcknowledged={() => {
            if (!viewingMessageNotification.is_read) {
              markNotificationRead(viewingMessageNotification.id);
            }
          }}
        />
      )}
    </main>
  );
};

export default Dashboard;
