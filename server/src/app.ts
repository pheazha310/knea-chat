/**
 * Express application — middleware, route mounting, 404 and the global error
 * handler. The HTTP server + WebSocket live in server.ts.
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { container } from './container';
import { createAuthRouter } from './routes/auth.routes';
import { createUserRouter } from './routes/user.routes';
import { createTeamRouter } from './routes/team.routes';
import { createChannelRouter } from './routes/channel.routes';
import { createConversationRouter } from './routes/conversation.routes';
import { createMessageRouter } from './routes/message.routes';
import { createSearchRouter } from './routes/search.routes';
import { createNotificationRouter } from './routes/notification.routes';
import { createCompanyRouter } from './routes/company.routes';
import { createSystemSettingRouter } from './routes/systemSetting.routes';
import { createDepartmentRouter } from './routes/department.routes';
import { createAnnouncementRouter } from './routes/announcement.routes';
import { createReminderRouter } from './routes/reminder.routes';
import { createBookmarkMessageRouter, createBookmarkListRouter } from './routes/bookmark.routes';
import { createSharedFileRouter } from './routes/sharedFile.routes';
import { errorHandler } from './middleware/error.middleware';
import { createMeetingRouter } from './routes/meeting.routes';
import { createAttendanceRouter } from './routes/attendance.routes';
import { createOvertimeRouter } from './routes/overtime.routes';
import { createWorkScheduleRouter } from './routes/workSchedule.routes';
import { createLeaveRequestRouter } from './routes/leaveRequest.routes';
import { createHolidayRouter } from './routes/holiday.routes';
import { createNotificationPreferenceRouter } from './routes/notificationPreference.routes';
import { createTaskRouter } from './routes/task.routes';
import { createAuditLogRouter } from './routes/auditLog.routes';
import { createCompanySettingRouter } from './routes/companySetting.routes';
import { createSubscriptionRouter } from './routes/subscription.routes';
import { createPlatformMetricRouter } from './routes/platformMetric.routes';
import { createTelegramRouter } from './integrations/telegram/telegram.routes';
import { createWebsiteRouter } from './integrations/website/website.routes';
import { createOmniRouter } from './integrations/omni/omni.routes';

export const app = express();

// ============ MIDDLEWARE ============
// CORS configuration
const defaultOrigins = ['http://localhost:3000', 'http://localhost:3001'];
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : defaultOrigins;
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // X-Telegram-Bot-Api-Secret-Token is sent by Telegram's webhook deliveries
    // and by local browser tooling while testing the webhook endpoint.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Bot-Api-Secret-Token'],
  }),
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging middleware (optional - simple version)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Serve uploaded files (SRS FR-17)
app.use('/uploads', express.static(path.join(__dirname, '..', '..', 'uploads')));

// ============ PUBLIC ROUTES (No Authentication Required) ============
app.use('/api/auth', createAuthRouter(container.authController, container.auth));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'KneaChat server is running',
    timestamp: new Date().toISOString(),
  });
});

// ============ OMNI-CHANNEL ============
// Generic channel surface: shared inbox actions (assign / status / reply) +
// per-channel health probes. Channel webhooks are mounted by each channel's
// own router (see the Website and Telegram sections below) so every webhook
// keeps its provider-specific secret validation.
app.use('/api/omni', createOmniRouter(container.omniController, container.auth));

// ============ WEBSITE (Omni-Channel) ==========
// The webhook + health routes are public; the reply and administration routes
// apply their own auth inside the router.
app.use('/api/website', createWebsiteRouter(container.websiteController, container.auth));

// ============ TELEGRAM (Omni-Channel) ==========
// The webhook + health routes are public (Telegram calls the webhook; health
// reveals no secrets); the reply and webhook-administration routes apply their
// own auth inside the router.
app.use('/api/telegram', createTelegramRouter(container.telegramController, container.auth));

// ============ PROTECTED ROUTES (Authentication Required) ============
// All routes below require authentication
app.use('/api/users', container.auth.authenticate, createUserRouter(container.userController, container.auth));
app.use('/api/teams', container.auth.authenticate, createTeamRouter(container.teamController, container.auth));
app.use('/api/channels', container.auth.authenticate, createChannelRouter(container.channelController, container.auth));
app.use('/api/conversations', container.auth.authenticate, createConversationRouter(container.conversationController, container.auth));
app.use('/api/messages', container.auth.authenticate, createMessageRouter(container.messageController, container.auth));
app.use('/api/messages', container.auth.authenticate, createReminderRouter(container.reminderController, container.auth));
app.use('/api/messages', container.auth.authenticate, createBookmarkMessageRouter(container.bookmarkController, container.auth));
app.use('/api/bookmarks', container.auth.authenticate, createBookmarkListRouter(container.bookmarkController, container.auth));
app.use('/api/shared-files', container.auth.authenticate, createSharedFileRouter(container.sharedFileController, container.auth));
app.use('/api/search', container.auth.authenticate, createSearchRouter(container.searchController, container.auth));
app.use('/api/notifications', container.auth.authenticate, createNotificationRouter(container.notificationController, container.auth));
app.use('/api/notification-preferences', container.auth.authenticate, createNotificationPreferenceRouter(container.notificationPreferenceController, container.auth));
app.use('/api/tasks', container.auth.authenticate, createTaskRouter(container.taskController, container.auth));
app.use('/api/companies', container.auth.authenticate, createCompanyRouter(container.companyController, container.auth));
app.use('/api/departments', container.auth.authenticate, createDepartmentRouter(container.departmentController, container.auth));
app.use('/api/announcements', container.auth.authenticate, createAnnouncementRouter(container.announcementController, container.auth));
app.use('/api/meetings', container.auth.authenticate, createMeetingRouter(container.meetingController, container.auth));
app.use('/api/attendance', createAttendanceRouter(container.attendanceController, container.auth));
app.use('/api/overtime', createOvertimeRouter(container.attendanceController, container.auth));
app.use('/api/work-schedules', createWorkScheduleRouter(container.workScheduleController, container.auth));
app.use('/api/leave-requests', createLeaveRequestRouter(container.leaveRequestController, container.auth));
app.use('/api/holidays', createHolidayRouter(container.holidayController, container.auth));
// Administration module (module 10): audit logs, company settings + security,
// permissions, subscriptions/plans, and platform monitoring.
app.use('/api/audit-logs', container.auth.authenticate, createAuditLogRouter(container.auditLogController, container.auth));
app.use('/api/company-settings', container.auth.authenticate, createCompanySettingRouter(container.companySettingController, container.auth));
app.use('/api/subscriptions', container.auth.authenticate, createSubscriptionRouter(container.subscriptionController, container.auth));
app.use('/api/admin/metrics', container.auth.authenticate, createPlatformMetricRouter(container.platformMetricController, container.auth));
// Settings has its own auth handling: GET /api/settings/public is open so the
// login page can render maintenance/registration state pre-auth.
app.use('/api/settings', createSystemSettingRouter(container.systemSettingController, container.auth));

// ============ ERROR HANDLING ============
// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
  });
});

// Global error handler (must be last)
app.use(errorHandler);
