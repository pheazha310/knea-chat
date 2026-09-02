import React, { useMemo, useEffect, useRef, useState } from "react";
import type { Meeting } from "../../models";
import Icon from "../common/Icon";
import { formatTime12 } from "../../utils/time";

const formatTimeRange = (start: string, end: string): string => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startHour12 = sh % 12 || 12;
  const endHour12 = eh % 12 || 12;
  const startAmPm = sh < 12 ? "AM" : "PM";
  const endAmPm = eh < 12 ? "AM" : "PM";
  const startStr = `${startHour12}:${String(sm || 0).padStart(2, "0")} ${startAmPm}`;
  const endStr = `${endHour12}:${String(em || 0).padStart(2, "0")} ${endAmPm}`;
  return `${startStr} – ${endStr}`;
};

interface WeekGridViewProps {
  weekDays: { date: Date; dateStr: string; isToday: boolean }[];
  meetings: Meeting[];
  currentUserId: number;
  selectedDateForDay: string | null;
  onSelectDateForDay: (dateStr: string) => void;
  onDayClick: (dateStr: string) => void;
  onViewDetails: (meeting: Meeting) => void;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_HEIGHT = 60;
const START_HOUR = 8;
const END_HOUR = 20;

const WeekGridView = ({
  weekDays,
  meetings,
  currentUserId,
  selectedDateForDay,
  onSelectDateForDay,
  onDayClick,
  onViewDetails,
}: WeekGridViewProps) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const meetingsByDate = useMemo(() => {
    const map: Record<string, Meeting[]> = {};
    for (const m of meetings) {
      if (!map[m.meeting_date]) map[m.meeting_date] = [];
      map[m.meeting_date].push(m);
    }
    return map;
  }, [meetings]);

  const totalHours = END_HOUR - START_HOUR;
  const gridHeight = totalHours * HOUR_HEIGHT;

  const timeSlots = useMemo(() => {
    const slots: { hour: number }[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) slots.push({ hour: h });
    return slots;
  }, []);

  const isTodayInView = weekDays.some((d) => d.isToday);
  const weekHasNoMeetings = useMemo(
    () => weekDays.every((d) => (meetingsByDate[d.dateStr] || []).length === 0),
    [weekDays, meetingsByDate],
  );

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const showNowLine = isTodayInView && nowTop >= 0 && nowTop <= gridHeight;

  const scrollToCurrentTime = () => {
    if (!gridRef.current) return;
    const targetMinutes = nowMinutes - START_HOUR * 60;
    const scrollTop = Math.max(0, targetMinutes - 2 * 60) * (HOUR_HEIGHT / 60);
    gridRef.current.scrollTop = scrollTop;
  };

  useEffect(() => {
    scrollToCurrentTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateForDay]);

  return (
    <div className="week-grid-view">
      {weekHasNoMeetings && (
        <div className="week-grid-empty">
          <Icon name="calendar" size={26} />
          <span>No meetings scheduled this week</span>
        </div>
      )}

      <div className="week-grid-header">
        <div className="week-grid-header-left" />
        <div className="week-grid-header-days">
          {weekDays.map((d) => (
            <div
              key={d.dateStr}
              className={`week-grid-header-day ${d.isToday ? "today" : ""}`}
              onClick={() => onDayClick(d.dateStr)}
            >
              <div className="week-grid-header-weekday">{WEEKDAY_NAMES[d.date.getDay()]}</div>
              <div className="week-grid-header-date">
                <span className={`week-grid-date-number ${d.isToday ? "is-today" : ""}`}>{d.date.getDate()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="week-grid-body" ref={gridRef}>
        <div className="week-grid-time-column">
          {timeSlots.map((slot) => (
            <div key={slot.hour} className="week-grid-time-label" style={{ height: HOUR_HEIGHT }}>
              <span className="week-grid-time-hour">{slot.hour % 12 || 12}</span>
              <span className="week-grid-time-ampm">{slot.hour < 12 ? "AM" : "PM"}</span>
            </div>
          ))}
        </div>

        <div className="week-grid-days" style={{ height: gridHeight }}>
          {weekDays.map((day) => {
            const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
            const dayMeetings = (meetingsByDate[day.dateStr] || []).sort((a, b) =>
              a.start_time.localeCompare(b.start_time),
            );

            return (
              <div
                key={day.dateStr}
                className={`week-grid-day-column${day.isToday ? " today" : ""}${isWeekend ? " weekend" : ""}`}
                onClick={() => onDayClick(day.dateStr)}
              >
                {timeSlots.map((slot) => (
                  <div key={slot.hour} className="week-grid-day-slot" style={{ height: HOUR_HEIGHT }} />
                ))}

                {day.isToday && showNowLine && <div className="week-grid-now-line" style={{ top: nowTop }} />}

                {dayMeetings.map((m) => {
                  const [sh, sm] = m.start_time.split(":").map(Number);
                  const [eh, em] = m.end_time.split(":").map(Number);
                  const gridEnd = totalHours * 60;
                  const startOffset = Math.min(Math.max(sh * 60 + sm - START_HOUR * 60, 0), gridEnd);
                  const endOffset = Math.min(Math.max(eh * 60 + em - START_HOUR * 60, startOffset + 30), gridEnd);
                  const top = (startOffset / 60) * HOUR_HEIGHT;
                  const height = Math.max(((endOffset - startOffset) / 60) * HOUR_HEIGHT, 24);
                  const compact = height < 44;
                  const statusClass =
                    m.status === "cancelled" ? "cancelled" : m.status === "completed" ? "completed" : "scheduled";

                  return (
                    <div
                      key={m.id}
                      className={`week-grid-meeting ${statusClass}${compact ? " compact" : ""}`}
                      style={{ top, height }}
                      title={`${formatTimeRange(m.start_time, m.end_time)} · ${m.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewDetails(m);
                      }}
                    >
                      <div className="week-grid-meeting-title">{m.title}</div>
                      <div className="week-grid-meeting-time">{formatTimeRange(m.start_time, m.end_time)}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WeekGridView;
