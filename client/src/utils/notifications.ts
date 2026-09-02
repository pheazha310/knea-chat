/**
 * Notification helpers shared across the store and views.
 *
 * Notification rows store `data` as JSON with a `conversationId` when they
 * relate to a conversation (server: NotificationModel.create). The MySQL JSON
 * column arrives as an object via the API, but older rows / other shapes may
 * arrive as a string — both are handled here.
 */
export const conversationIdOf = (notification: { data?: unknown }): number | null => {
  try {
    const data =
      typeof notification.data === 'string'
        ? JSON.parse(notification.data)
        : notification.data;
    const id = Number((data as { conversationId?: unknown } | null)?.conversationId);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
};
