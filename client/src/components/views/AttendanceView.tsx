import React, { useEffect, useMemo, useState } from 'react';
import { useAttendanceStore } from '../../store/attendanceStore';
import AttendanceStatusBadge from '../attendance/AttendanceStatusBadge';
import ClockControls from '../attendance/ClockControls';
import DayDetailsModal from '../attendance/DayDetailsModal';
import LeaveModal from '../attendance/LeaveModal';
import type { AttendanceDay } from '../../models/Attendance';
import { STATUS_META, LEAVE_TYPE_LABELS, type LeaveType } from '../../models/Attendance';
import { formatMinutes } from '../../utils/time';
import Icon from '../common/Icon';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const todayStr = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/**
 * Employee Attendance Calendar — current month, working days / days off /
 * holidays / leave, attendance status per day, required vs actual hours,
 * overtime, late/early-leave minutes, plus Clock In / Clock Out controls.
 */
const AttendanceView = () => {
  const {
    today,
    monthDays,
    monthSummary,
    loadingToday,
    loadingMonth,
    todayError,
    loadToday,
    loadMonth,
    clockIn,
    clockOut,
    breakStart,
    breakEnd,
    leaves,
    loadLeaves,
    createLeave,
    holidays,
    loadHolidays,
    overtime,
    loadOvertime,
    requestOvertime,
  } = useAttendanceStore();

  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<AttendanceDay | null>(null);
  const [showLeave, setShowLeave] = useState(false);
  const [showOwnLeaves, setShowOwnLeaves] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showOtForm, setShowOtForm] = useState(false);
  const [otForm, setOtForm] = useState({ date: todayStr(), minutes: '', reason: '' });
  const [otError, setOtError] = useState<string | null>(null);

  useEffect(() => {
    loadToday();
    loadLeaves();
    loadHolidays();
    loadOvertime();
  }, [loadToday, loadLeaves, loadHolidays, loadOvertime]);

  useEffect(() => {
    loadMonth(viewYear, viewMonth);
  }, [viewYear, viewMonth, loadMonth]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth - 1, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const byDate = new Map(monthDays.map((d) => [d.date, d]));

    const cells: Array<{ dateStr: string; dayNum: number; isCurrentMonth: boolean; isToday: boolean; day?: AttendanceDay }> = [];
    // Leading blanks belong to the PREVIOUS month: day 0 / negative days of
    // the current month's first week index back into it (Aug 30, Aug 31 for
    // a September 1st that falls on a Tuesday).
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth - 1, -i);
      cells.push({
        dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        dayNum: d.getDate(),
        isCurrentMonth: false,
        isToday: false,
      });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const ds = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      cells.push({ dateStr: ds, dayNum: i, isCurrentMonth: true, isToday: ds === todayStr(), day: byDate.get(ds) });
    }
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(viewYear, viewMonth, i);
      cells.push({
        dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        dayNum: d.getDate(),
        isCurrentMonth: false,
        isToday: false,
      });
    }
    return cells;
  }, [viewYear, viewMonth, monthDays]);

  const goToPrevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const goToNextMonth = () => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };
  const goToToday = () => {
    const n = new Date();
    setViewYear(n.getFullYear());
    setViewMonth(n.getMonth() + 1);
    loadToday();
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch {
      // store surfaces the error
    } finally {
      setBusy(null);
    }
  };

  const leaveDates = useMemo(() => new Set(leaves.filter((l) => l.status === 'approved').flatMap((l) => {
    const out: string[] = [];
    let d = new Date(`${l.start_date}T00:00:00`);
    const end = new Date(`${l.end_date}T00:00:00`);
    while (d <= end) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      d.setDate(d.getDate() + 1);
    }
    return out;
  })), [leaves]);

  const s = monthSummary;

  return (
    <div className="attendance-view">
      <div className="attendance-shell">
        <div className="attendance-main">
          <div className="attendance-toolbar">
            <div className="meetings-toolbar-nav" role="group" aria-label="Calendar navigation">
              <button className="nav-arrow" onClick={goToPrevMonth} aria-label="Previous month">
                <Icon name="chevron-left" size={15} />
              </button>
              <button className="today-btn" onClick={goToToday}>Today</button>
              <button className="nav-arrow" onClick={goToNextMonth} aria-label="Next month">
                <Icon name="chevron-right" size={15} />
              </button>
            </div>
            <h2 className="attendance-title">{MONTH_NAMES[viewMonth - 1]} {viewYear}</h2>
            <button className="btn-primary" onClick={() => setShowLeave(true)}>
              <Icon name="plus" size={13} /> Request leave
            </button>
          </div>

          <div className="calendar-weekdays">
            {WEEKDAY_NAMES.map((w) => <div key={w} className="calendar-weekday">{w}</div>)}
          </div>
          <div className="calendar-grid attendance-calendar-grid">
            {calendarDays.map((cell) => {
              const d = cell.day;
              const status = d?.status ?? null;
              const meta = status ? STATUS_META[status] : null;
              const isLeave = d ? leaveDates.has(d.date) : false;
              const cls = [
                'calendar-day',
                'attendance-day',
                cell.isCurrentMonth ? '' : 'other-month',
                cell.isToday ? 'today' : '',
                d && !d.is_working_day && !d.is_holiday ? 'weekend' : '',
              ].filter(Boolean).join(' ');
              return (
                <div
                  key={cell.dateStr}
                  className={cls}
                  role="button"
                  tabIndex={0}
                  onClick={() => d && setSelectedDay(d)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && d) setSelectedDay(d); }}
                >
                  <div className="calendar-day-number">{cell.dayNum}</div>
                  {status && (
                    <div className={`attendance-day-status ${status}`} title={meta?.label}>
                      <span aria-hidden="true">{meta?.icon}</span>
                    </div>
                  )}
                  {isLeave && status !== 'leave' && (
                    <div className="attendance-day-status leave" title="Approved leave">
                      <span aria-hidden="true">🔵</span>
                    </div>
                  )}
                  {d?.overtime_minutes ? d.overtime_minutes > 0 && (
                    <div className="attendance-day-ot" title={`+${formatMinutes(d.overtime_minutes)}`}>
                      +{formatMinutes(d.overtime_minutes)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {loadingMonth && <div className="text-muted text-sm py-2">Loading…</div>}

          {s && (
            <div className="attendance-summary">
              <h3 className="sidebar-section-title">Monthly summary — {MONTH_NAMES[s.month - 1]} {s.year}</h3>
              <div className="attendance-summary-grid">
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{s.working_days}</span><span className="attendance-summary-label">Working days</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{s.present}</span><span className="attendance-summary-label">Present</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{s.late}</span><span className="attendance-summary-label">Late</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{s.absent}</span><span className="attendance-summary-label">Absent</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{s.leave}</span><span className="attendance-summary-label">Leave</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{s.day_off}</span><span className="attendance-summary-label">Day off</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{formatMinutes(s.required_minutes)}</span><span className="attendance-summary-label">Required</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{formatMinutes(s.actual_minutes)}</span><span className="attendance-summary-label">Actual</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num text-warn">{formatMinutes(s.under_time_minutes)}</span><span className="attendance-summary-label">Under time</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num text-ok">+{formatMinutes(s.overtime_minutes)}</span><span className="attendance-summary-label">Overtime</span></div>
                <div className="attendance-summary-cell"><span className="attendance-summary-num">{s.attendance_rate !== null ? `${s.attendance_rate}%` : '—'}</span><span className="attendance-summary-label">Attendance rate</span></div>
              </div>
            </div>
          )}
        </div>

        <div className="attendance-sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">Today</h3>
            {loadingToday ? (
              <div className="text-muted text-sm">Loading…</div>
            ) : today ? (
              <div className="attendance-today-card">
                <div className="attendance-today-head">
                  <span className="attendance-today-date">
                    {new Date(`${today.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                  </span>
                  <AttendanceStatusBadge status={today.status} />
                </div>
                <div className="attendance-today-schedule">
                  {today.is_working_day && today.scheduled_start
                    ? `${today.scheduled_start.slice(0, 5)} – ${today.scheduled_end?.slice(0, 5)} · break ${today.break_minutes}m`
                    : 'Day off'}
                </div>
                <ClockControls
                  day={today}
                  onClockIn={() => run('in', clockIn)}
                  onClockOut={() => run('out', clockOut)}
                  onBreakStart={() => run('bs', breakStart)}
                  onBreakEnd={() => run('be', breakEnd)}
                  onBreakToggle={() => loadToday()}
                  busy={!!busy}
                  error={todayError}
                />
              </div>
            ) : (
              <div className="text-muted text-sm">Unavailable</div>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="sidebar-section-title">My leave requests</h3>
            {leaves.length === 0 ? (
              <div className="text-muted text-sm">No requests yet.</div>
            ) : (
              <ul className="attendance-leave-list">
                {leaves.slice(0, 5).map((l) => (
                  <li key={l.id}>
                    <div className="attendance-leave-row">
                      <span className="attendance-leave-type">{LEAVE_TYPE_LABELS[l.leave_type]}</span>
                      <span className={`status-pill ${l.status}`}>{l.status}</span>
                    </div>
                    <small className="text-muted">{l.start_date} → {l.end_date}</small>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn-secondary mt-2 w-full" onClick={() => setShowOwnLeaves(true)}>
              View all
            </button>
          </div>

          <div className="sidebar-section">
            <div className="attendance-holiday-head">
              <h3 className="sidebar-section-title">Overtime requests</h3>
              <button
                className="btn-secondary !py-1 !px-2 !text-xs"
                onClick={() => {
                  setShowOtForm((v) => !v);
                  setOtError(null);
                }}
              >
                {showOtForm ? 'Cancel' : 'Request'}
              </button>
            </div>
            {showOtForm && (
              <form
                className="space-y-2 mt-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setOtError(null);
                  const minutes = Number(otForm.minutes);
                  if (!otForm.date || !Number.isFinite(minutes) || minutes <= 0) {
                    setOtError('Date and a positive minute count are required');
                    return;
                  }
                  try {
                    await requestOvertime({
                      date: otForm.date,
                      minutes,
                      reason: otForm.reason.trim() || undefined,
                    });
                    setShowOtForm(false);
                    setOtForm({ date: todayStr(), minutes: '', reason: '' });
                  } catch (err: any) {
                    setOtError(err.response?.data?.message || err.message || 'Could not request overtime');
                  }
                }}
              >
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-sm"
                  type="date"
                  value={otForm.date}
                  onChange={(e) => setOtForm({ ...otForm, date: e.target.value })}
                  aria-label="Overtime date"
                />
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-sm"
                  type="number"
                  min={1}
                  max={1440}
                  placeholder="Minutes (e.g. 90)"
                  value={otForm.minutes}
                  onChange={(e) => setOtForm({ ...otForm, minutes: e.target.value })}
                  aria-label="Overtime minutes"
                />
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-lavender text-sm"
                  placeholder="Reason (optional)"
                  value={otForm.reason}
                  onChange={(e) => setOtForm({ ...otForm, reason: e.target.value })}
                  aria-label="Overtime reason"
                />
                {otError && <div className="clock-error">{otError}</div>}
                <button type="submit" className="btn-primary w-full !py-2 !text-xs">
                  Submit request
                </button>
              </form>
            )}
            {overtime.length === 0 ? (
              <div className="text-muted text-sm">No overtime requests.</div>
            ) : (
              <ul className="attendance-leave-list">
                {overtime.slice(0, 6).map((o) => (
                  <li key={o.id}>
                    <div className="attendance-leave-row">
                      <b>{formatMinutes(o.minutes)}</b>
                      <span className={`status-pill ${o.status}`}>{o.status}</span>
                    </div>
                    <small className="text-muted">{o.date}{o.reason ? ` · ${o.reason}` : ''}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="sidebar-section-title">Upcoming holidays</h3>
            {holidays.length === 0 ? (
              <div className="text-muted text-sm">No public holidays scheduled.</div>
            ) : (
              <ul className="attendance-holiday-list">
                {holidays.slice(0, 6).map((h) => (
                  <li key={h.id}>🎉 <b>{h.name}</b> <span className="text-muted">{h.date}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {selectedDay && <DayDetailsModal day={selectedDay} onClose={() => setSelectedDay(null)} />}
      {showLeave && (
        <LeaveModal
          defaultDate={today?.date}
          onClose={() => setShowLeave(false)}
          onSubmit={createLeave}
        />
      )}
      {showOwnLeaves && (
        <div className="modal-overlay" onClick={() => setShowOwnLeaves(false)}>
          <div className="modal" style={{ width: 'min(100%, 480px)' }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              <h3 className="modal-title mb-3">My leave requests</h3>
              {leaves.length === 0 ? (
                <div className="text-muted text-sm">No requests yet.</div>
              ) : (
                <ul className="attendance-leave-list">
                  {leaves.map((l) => (
                    <li key={l.id}>
                      <div className="attendance-leave-row">
                        <span className="attendance-leave-type">{LEAVE_TYPE_LABELS[l.leave_type]}</span>
                        <span className={`status-pill ${l.status}`}>{l.status}</span>
                      </div>
                      <small className="text-muted">{l.start_date} → {l.end_date}{l.reason ? ` · ${l.reason}` : ''}</small>
                    </li>
                  ))}
                </ul>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowOwnLeaves(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceView;