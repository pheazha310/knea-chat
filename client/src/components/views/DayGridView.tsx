import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Meeting } from "../../models";
import Icon from "../common/Icon";
import { formatTime12 } from "../../utils/time";

interface DayGridViewProps {
  date: Date;
  dateStr: string;
  isToday: boolean;
  meetings: Meeting[];
  canSchedule: boolean;
  onPrevDay: () => void;
  onNextDay: () => void;
  onSlotClick: (dateStr: string, hour: number) => void;
  onViewDetails: (meeting: Meeting) => void;
}

const HOUR_HEIGHT = 60;
const START_HOUR = 0;
const END_HOUR = 21;

const DayGridView = ({
  date,
  dateStr,
  isToday,
  meetings,
  canSchedule,
  onPrevDay,
  onNextDay,
  onSlotClick,
  onViewDetails,
}: DayGridViewProps) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const slots = useMemo(() => {
    const out: number[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) out.push(h);
    return out;
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;
  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const showNowLine = isToday && nowTop >= 0 && nowTop <= gridHeight;

  useEffect(() => {
    if (!gridRef.current) return;
    const target = isToday ? Math.max(0, nowMinutes - 120) : 8 * 60;
    gridRef.current.scrollTop = target * (HOUR_HEIGHT / 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr]);

  const sortedMeetings = useMemo(
    () => [...meetings].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [meetings],
  );

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSchedule) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = Math.min(Math.max(START_HOUR + Math.floor(y / HOUR_HEIGHT), START_HOUR), END_HOUR - 1);
    onSlotClick(dateStr, hour);
  };

  const title = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="day-grid-view">
      <div className="day-grid-header">
        <button onClick={onPrevDay} aria-label="Previous day">
          <Icon name="chevron-left" size={14} />
        </button>
        <div className="day-grid-title">
          <span>{title}</span>
          {isToday && <span className="day-grid-today-chip">Today</span>}
        </div>
        <button onClick={onNextDay} aria-label="Next day">
          <Icon name="arrow-right" size={14} />
        </button>
      </div>

      <div className="day-grid-body" ref={gridRef}>
        <div className="week-grid-time-column">
          {slots.map((h) => (
            <div key={h} className="week-grid-time-label" style={{ height: HOUR_HEIGHT }}>
              <span className="week-grid-time-hour">{h % 12 || 12}</span>
              <span className="week-grid-time-ampm">{h < 12 ? "AM" : "PM"}</span>
            </div>
          ))}
          {showNowLine && (
            <div className="week-grid-now-bubble" style={{ top: nowTop }}>
              {formatTime12(`${now.getHours()}:${now.getMinutes()}`)}
            </div>
          )}
        </div>

        <div className="week-grid-days day-grid-single" style={{ height: gridHeight }}>
          <div
            className={`week-grid-day-column day-grid-column${isToday ? " today" : ""}${canSchedule ? " interactive" : ""}`}
            onClick={handleColumnClick}
          >
            {slots.map((h) => (
              <div key={h} className="week-grid-day-slot" style={{ height: HOUR_HEIGHT }} />
            ))}

            {isToday && showNowLine && <div className="week-grid-now-line" style={{ top: nowTop }} />}

            {sortedMeetings.map((m) => {
              const [sh, sm] = m.start_time.split(":").map(Number);
              const [eh, em] = m.end_time.split(":").map(Number);
              const gridEnd = (END_HOUR - START_HOUR) * 60;
              const startOffset = Math.min(Math.max(sh * 60 + sm - START_HOUR * 60, 0), gridEnd);
              const endOffset = Math.min(Math.max(eh * 60 + em - START_HOUR * 60, startOffset + 30), gridEnd);
              const top = (startOffset / 60) * HOUR_HEIGHT;
              const height = Math.max(((endOffset - startOffset) / 60) * HOUR_HEIGHT, 26);
              const compact = height < 44;
              const statusClass =
                m.status === "cancelled" ? "cancelled" : m.status === "completed" ? "completed" : "scheduled";

              return (
                <div
                  key={m.id}
                  className={`week-grid-meeting ${statusClass}${compact ? " compact" : ""}`}
                  style={{ top, height }}
                  title={`${formatTime12(m.start_time)} – ${formatTime12(m.end_time)} · ${m.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewDetails(m);
                  }}
                >
                  <div className="week-grid-meeting-time">
                    {formatTime12(m.start_time)} – {formatTime12(m.end_time)}
                  </div>
                  <div className="week-grid-meeting-title">{m.title}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DayGridView;
