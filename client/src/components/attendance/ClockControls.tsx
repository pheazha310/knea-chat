import React, { useState } from 'react';
import type { AttendanceDay } from '../../models/Attendance';
import { formatMinutes } from '../../utils/time';

interface Props {
  day: AttendanceDay;
  onClockIn: () => Promise<void>;
  onClockOut: () => Promise<void>;
  onBreakStart: () => Promise<void>;
  onBreakEnd: () => Promise<void>;
  onBreakToggle: () => Promise<void>;
  busy?: boolean;
  error?: string | null;
}

/**
 * Clock In / Clock Out widget.
 *
 * Before clocking in: shows the required hours + [Clock In].
 * After clocking in: shows Clock In time, worked so far, remaining, and
 * [Clock Out] (plus break controls).
 */
const ClockControls = ({ day, onClockIn, onClockOut, onBreakStart, onBreakEnd, onBreakToggle, busy, error }: Props) => {
  const [acting, setActing] = useState(false);
  const breakRunning = !!day.running_break;

  const run = async (fn: () => Promise<void>) => {
    if (busy || acting) return;
    setActing(true);
    try {
      await fn();
    } finally {
      setActing(false);
    }
  };

  const isWorkingDay = day.is_working_day && !day.is_day_off && !day.is_holiday;
  const canClockIn = isWorkingDay && !day.clock_in && day.status !== 'leave';
  const canClockOut = !!day.clock_in && !day.clock_out;
  const canBreak = !!day.clock_in && !day.clock_out;

  const formatTime = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const requiredHm = formatMinutes(day.required_work_minutes);

  return (
    <div className="clock-controls">
      {day.is_holiday && (
        <div className="clock-state clock-state-holiday">
          🎉 {day.holiday_name || 'Public holiday'} — no clock-in required (0h)
        </div>
      )}
      {!day.is_holiday && !isWorkingDay && (
        <div className="clock-state clock-state-off">⚪ Day off — no clock-in required</div>
      )}
      {day.status === 'leave' && (
        <div className="clock-state clock-state-leave">🔵 On approved leave today</div>
      )}

      {!day.clock_in && isWorkingDay && day.status !== 'leave' && (
        <div className="clock-before">
          <div className="clock-required">Required: <b>{requiredHm}</b></div>
          <button
            className="btn-primary clock-btn"
            disabled={busy || acting}
            onClick={() => run(onClockIn)}
          >
            {acting ? 'Clocking in…' : '🕘 Clock In'}
          </button>
        </div>
      )}

      {day.clock_in && (
        <div className="clock-after">
          <div className="clock-stats">
            <div className="clock-stat">
              <span className="clock-stat-label">Clock In</span>
              <span className="clock-stat-value">{formatTime(day.clock_in)}</span>
            </div>
            <div className="clock-stat">
              <span className="clock-stat-label">Worked</span>
              <span className="clock-stat-value">
                {day.total_work_minutes !== null ? formatMinutes(day.total_work_minutes) : '—'}
              </span>
            </div>
            <div className="clock-stat">
              <span className="clock-stat-label">Remaining</span>
              <span className="clock-stat-value">
                {day.total_work_minutes !== null
                  ? formatMinutes(Math.max(0, day.required_work_minutes - day.total_work_minutes))
                  : requiredHm}
              </span>
            </div>
          </div>
          {canBreak && (
            <button
              className="btn-secondary clock-btn"
              disabled={busy || acting}
              onClick={() => run(async () => {
                if (breakRunning) {
                  await onBreakEnd();
                } else {
                  await onBreakStart();
                }
                onBreakToggle();
              })}
            >
              {breakRunning ? 'End Break' : 'Start Break'}
            </button>
          )}
          {canClockOut && (
            <button
              className="btn-primary clock-btn clock-out-btn"
              disabled={busy || acting}
              onClick={() => run(onClockOut)}
            >
              {acting ? 'Clocking out…' : '🏁 Clock Out'}
            </button>
          )}
          {!canClockOut && day.clock_in && (
            <div className="clock-state">Clocked out at {formatTime(day.clock_out)}</div>
          )}
        </div>
      )}

      {error && <div className="clock-error">{error}</div>}
    </div>
  );
};

export default ClockControls;