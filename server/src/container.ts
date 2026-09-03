/**
 * Composition root (bootstrap) — wires the whole dependency graph.
 *
 *   Db → Repositories → Services → Controllers / WebSocket handlers
 *
 * Nothing in the layers below constructs its own dependencies; everything is
 * injected here so tests can substitute stubs and the graph is easy to follow.
 */
import db from './database/connection';

// Repositories
import { UserRepository } from './repositories/userRepository';
import { MessageRepository } from './repositories/messageRepository';
import { ConversationRepository } from './repositories/conversationRepository';
import { CompanyRepository } from './repositories/companyRepository';
import { TeamRepository } from './repositories/teamRepository';
import { NotificationRepository } from './repositories/notificationRepository';
import { ChannelRepository } from './repositories/channelRepository';
import { ChannelMemberRepository } from './repositories/channelMemberRepository';
import { TeamMemberRepository } from './repositories/teamMemberRepository';
import { ReactionRepository } from './repositories/reactionRepository';
import { SystemSettingRepository } from './repositories/systemSettingRepository';
import { SessionRepository } from './repositories/sessionRepository';
import { DepartmentRepository } from './repositories/departmentRepository';
import { AnnouncementRepository } from './repositories/announcementRepository';
import { ReminderRepository } from './repositories/reminderRepository';
import { BookmarkRepository } from './repositories/bookmarkRepository';
import { SharedFileRepository } from './repositories/sharedFileRepository';
import { MeetingRepository } from './repositories/meetingRepository';
import { MeetingNoteRepository } from './repositories/meetingNoteRepository';
import { MeetingReminderRepository } from './repositories/meetingReminderRepository';
import { MeetingAttendeeRepository } from './repositories/meetingAttendeeRepository';
import { MeetingAttachmentRepository } from './repositories/meetingAttachmentRepository';
import { WorkScheduleRepository } from './repositories/workScheduleRepository';
import { AttendanceRepository } from './repositories/attendanceRepository';
import { LeaveRequestRepository } from './repositories/leaveRequestRepository';
import { HolidayRepository } from './repositories/holidayRepository';

// Services
import { AuthService } from './services/Auth.service';
import { UserService } from './services/User.service';
import { MessageService } from './services/Message.service';
import { ConversationService } from './services/Conversation.service';
import { CompanyService } from './services/Company.service';
import { TeamService } from './services/Team.service';
import { ChannelService } from './services/Channel.service';
import { SearchService } from './services/Search.service';
import { SystemSettingService } from './services/SystemSetting.service';
import { NotificationService } from './services/Notification.service';
import { DepartmentService } from './services/Department.service';
import { AnnouncementService } from './services/Announcement.service';
import { ReminderService } from './services/Reminder.service';
import { BookmarkService } from './services/Bookmark.service';
import { SharedFileService } from './services/SharedFile.service';
import { MeetingService } from './services/Meeting.service';
import { WorkScheduleService } from './services/WorkSchedule.service';
import { AttendanceService } from './services/Attendance.service';
import { LeaveService } from './services/Leave.service';
import { HolidayService } from './services/Holiday.service';

// Controllers
import { AuthController } from './controllers/auth.controller';
import { UserController } from './controllers/user.controller';
import { MessageController } from './controllers/message.controller';
import { ConversationController } from './controllers/conversation.controller';
import { NotificationController } from './controllers/notification.controller';
import { TeamController } from './controllers/team.controller';
import { ChannelController } from './controllers/channel.controller';
import { CompanyController } from './controllers/company.controller';
import { SearchController } from './controllers/search.controller';
import { SystemSettingController } from './controllers/systemSetting.controller';
import { DepartmentController } from './controllers/department.controller';
import { AnnouncementController } from './controllers/announcement.controller';
import { ReminderController } from './controllers/reminder.controller';
import { BookmarkController } from './controllers/bookmark.controller';
import { SharedFileController } from './controllers/sharedFile.controller';
import { MeetingController } from './controllers/meeting.controller';
import { AttendanceController } from './controllers/attendance.controller';
import { WorkScheduleController } from './controllers/workSchedule.controller';
import { LeaveRequestController } from './controllers/leaveRequest.controller';
import { HolidayController } from './controllers/holiday.controller';

// Middleware
import { createAuthMiddleware } from './middleware/auth.middleware';

// WebSocket
import { createBroadcastToConversation } from './websocket/broadcast.utils';
import { MessageHandler } from './websocket/message.handler';
import { TypingHandler } from './websocket/typing.handler';
import { PresenceHandler } from './websocket/presence.handler';
import { CallHandler } from './websocket/call.handler';
import { ChatWebSocketServer } from './websocket/websocket.server';
import { attendanceEventPublisher } from './websocket/attendance.events';

// ---------------------------------------------------------------------------
// Repositories (each receives the shared pool-backed Db)
// ---------------------------------------------------------------------------
const userRepository = new UserRepository(db);
const messageRepository = new MessageRepository(db);
const conversationRepository = new ConversationRepository(db);
const companyRepository = new CompanyRepository(db);
const teamRepository = new TeamRepository(db);
const notificationRepository = new NotificationRepository(db);
const channelRepository = new ChannelRepository(db);
const channelMemberRepository = new ChannelMemberRepository(db);
const teamMemberRepository = new TeamMemberRepository(db);
const reactionRepository = new ReactionRepository(db);
const systemSettingRepository = new SystemSettingRepository(db);
const sessionRepository = new SessionRepository(db);
const departmentRepository = new DepartmentRepository(db);
const announcementRepository = new AnnouncementRepository(db);
const reminderRepository = new ReminderRepository(db);
const bookmarkRepository = new BookmarkRepository(db);
const sharedFileRepository = new SharedFileRepository(db);
const meetingRepository = new MeetingRepository(db);
const meetingNoteRepository = new MeetingNoteRepository(db);
const meetingReminderRepository = new MeetingReminderRepository(db);
const meetingAttendeeRepository = new MeetingAttendeeRepository(db);
const meetingAttachmentRepository = new MeetingAttachmentRepository(db);
const workScheduleRepository = new WorkScheduleRepository(db);
const attendanceRepository = new AttendanceRepository(db);
const leaveRequestRepository = new LeaveRequestRepository(db);
const holidayRepository = new HolidayRepository(db);

// ---------------------------------------------------------------------------
// Services (receive their repositories)
// ---------------------------------------------------------------------------
const systemSettingService = new SystemSettingService(systemSettingRepository);
const notificationService = new NotificationService(notificationRepository);
const authService = new AuthService(
  userRepository,
  notificationRepository,
  companyRepository,
  sessionRepository,
);
const userService = new UserService(userRepository);
const teamService = new TeamService(
  teamRepository,
  teamMemberRepository,
  conversationRepository,
);
const channelService = new ChannelService(
  channelRepository,
  channelMemberRepository,
  teamMemberRepository,
  conversationRepository,
);
const conversationService = new ConversationService(
  conversationRepository,
  messageRepository,
  userRepository,
  channelRepository,
  channelMemberRepository,
  teamRepository,
  teamMemberRepository,
);
const messageService = new MessageService(
  messageRepository,
  reactionRepository,
  conversationRepository,
  notificationRepository,
);
const companyService = new CompanyService(companyRepository);
const searchService = new SearchService(messageRepository, userRepository);
const departmentService = new DepartmentService(departmentRepository);
const announcementService = new AnnouncementService(
  announcementRepository,
  notificationRepository,
  userRepository,
);
const reminderService = new ReminderService(
  reminderRepository,
  notificationRepository,
  messageRepository,
);
const bookmarkService = new BookmarkService(
  bookmarkRepository,
  messageRepository,
  conversationRepository,
);
const sharedFileService = new SharedFileService(
  sharedFileRepository,
);
const meetingService = new MeetingService(
  meetingRepository,
  meetingNoteRepository,
  meetingReminderRepository,
  meetingAttendeeRepository,
  meetingAttachmentRepository,
  notificationRepository,
  userRepository,
);
const workScheduleService = new WorkScheduleService(workScheduleRepository, userRepository);
const attendanceService = new AttendanceService(
  attendanceRepository,
  workScheduleService,
  workScheduleRepository,
  holidayRepository,
  leaveRequestRepository,
  userRepository,
  attendanceEventPublisher,
);
const leaveService = new LeaveService(leaveRequestRepository, userRepository);
const holidayService = new HolidayService(holidayRepository);

// ---------------------------------------------------------------------------
// WebSocket handlers (receive their services/repositories)
// ---------------------------------------------------------------------------
const broadcastToConversation = createBroadcastToConversation(conversationRepository);
const messageHandler = new MessageHandler(messageService, conversationRepository, broadcastToConversation);
const typingHandler = new TypingHandler(broadcastToConversation);
const presenceHandler = new PresenceHandler(userRepository);
const callHandler = new CallHandler(
  userRepository,
  conversationRepository,
  notificationRepository,
);
const chatWebSocketServer = new ChatWebSocketServer({
  messageHandler,
  typingHandler,
  presenceHandler,
  callHandler,
});

// ---------------------------------------------------------------------------
// Controllers (receive their services)
// ---------------------------------------------------------------------------
const authController = new AuthController(authService, userRepository, systemSettingService);
const userController = new UserController(userService, userRepository, systemSettingService);
const messageController = new MessageController(
  messageService,
  systemSettingService,
  broadcastToConversation,
);
const conversationController = new ConversationController(
  conversationService,
  conversationRepository,
  messageService,
);
const notificationController = new NotificationController(notificationService);
const teamController = new TeamController(teamService);
const channelController = new ChannelController(channelService);
const companyController = new CompanyController(companyService);
const searchController = new SearchController(searchService);
const systemSettingController = new SystemSettingController(systemSettingService);
const departmentController = new DepartmentController(departmentService);
const announcementController = new AnnouncementController(announcementService);
const reminderController = new ReminderController(reminderService);
const bookmarkController = new BookmarkController(bookmarkService);
const sharedFileController = new SharedFileController(sharedFileService);
const meetingController = new MeetingController(meetingService);
const attendanceController = new AttendanceController(attendanceService);
const workScheduleController = new WorkScheduleController(workScheduleService);
const leaveRequestController = new LeaveRequestController(leaveService);
const holidayController = new HolidayController(holidayService);

// ---------------------------------------------------------------------------
// Middleware (bound to the settings service for maintenance-mode checks)
// ---------------------------------------------------------------------------
const auth = createAuthMiddleware(systemSettingService);

export const container = {
  // db
  db,
  // repositories
  userRepository,
  messageRepository,
  conversationRepository,
  companyRepository,
  teamRepository,
  notificationRepository,
  channelRepository,
  channelMemberRepository,
  teamMemberRepository,
  reactionRepository,
  systemSettingRepository,
  sessionRepository,
  departmentRepository,
  announcementRepository,
  reminderRepository,
  bookmarkRepository,
  sharedFileRepository,
  meetingRepository,
  meetingNoteRepository,
  meetingReminderRepository,
  meetingAttendeeRepository,
  meetingAttachmentRepository,
  workScheduleRepository,
  attendanceRepository,
  leaveRequestRepository,
  holidayRepository,
  // services
  systemSettingService,
  notificationService,
  authService,
  userService,
  teamService,
  channelService,
  conversationService,
  messageService,
  companyService,
  searchService,
  departmentService,
  announcementService,
  reminderService,
  bookmarkService,
  sharedFileService,
  meetingService,
  workScheduleService,
  attendanceService,
  leaveService,
  holidayService,
  // websocket
  broadcastToConversation,
  messageHandler,
  typingHandler,
  presenceHandler,
  callHandler,
  chatWebSocketServer,
  // controllers
  authController,
  userController,
  messageController,
  conversationController,
  notificationController,
  teamController,
  channelController,
  companyController,
  searchController,
  systemSettingController,
  departmentController,
  announcementController,
  reminderController,
  bookmarkController,
  sharedFileController,
  meetingController,
  attendanceController,
  workScheduleController,
  leaveRequestController,
  holidayController,
  attendanceEventPublisher,
  // middleware
  auth,
};

export type Container = typeof container;
