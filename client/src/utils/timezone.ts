/**
 * Timezone-aware formatting helpers.
 */

function safeDate(dateStr: string, time?: string): Date {
  const iso = time ? `${dateStr}T${time}` : `${dateStr}T00:00:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function formatMeetingTime(dateStr: string, startTime: string, endTime: string, timezone?: string): string {
  const tz = timezone || undefined;
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  };
  const start = safeDate(dateStr, startTime);
  const end = safeDate(dateStr, endTime);
  const fmt = new Intl.DateTimeFormat(undefined, options);
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function formatDateWithTimezone(dateStr: string, timezone?: string): string {
  const tz = timezone || undefined;
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  };
  const date = safeDate(dateStr);
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function getDayNumber(dateStr: string): number {
  return safeDate(dateStr).getDate();
}

export function getMonthName(dateStr: string): string {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return MONTH_NAMES[safeDate(dateStr).getMonth()] || '';
}
