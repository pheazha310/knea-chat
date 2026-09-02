/** Time formatting helpers shared by the calendar views. */

/** "14:30" or "14:30:00" -> "2:30 PM" */
export const formatTime12 = (time: string): string => {
  const [h, m] = time.split(":").map(Number);
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** Duration between two "HH:MM(:SS)" times -> "1h 30m" */
export const formatDuration = (start: string, end: string): string => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};
