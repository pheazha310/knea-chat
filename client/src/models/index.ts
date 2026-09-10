// MVVM Model layer — barrel export.
//
// The Model layer owns the domain entities (TypeScript interfaces) and the
// data-access objects that talk to the REST API through the shared HTTP
// client in `services/api.ts`. Views and ViewModels depend on this layer;
// nothing here depends on React components.
export * from './Announcement';
export * from './Auth';
export * from './User';
export * from './Department';
export * from './Team';
export * from './Channel';
export * from './Conversation';
export * from './Message';
export * from './Notification';
export * from './Company';
export * from './SystemSetting';
export * from './Search';
export * from './Pagination';
export * from './SharedFile';
export * from './Meeting';
export * from './Attendance';
export * from './NotificationPreference';
export * from './Task';
export * from './CompanySetting';
export * from './Permission';
export * from './AuditLog';
export * from './Subscription';
export * from './PlatformMetric';
export * from './Telegram';
export * from './Omni';