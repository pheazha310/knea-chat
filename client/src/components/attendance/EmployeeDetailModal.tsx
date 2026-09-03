import React, { useEffect, useState } from 'react';
import Modal from '../modals/Modal';
import AttendanceStatusBadge from './AttendanceStatusBadge';
import DayDetailsModal from './DayDetailsModal';
import { AttendanceModel, type AttendanceDay, type AttendanceMonthSummary, STATUS_META } from '../../models/Attendance';
import { formatMinutes } from '../../utils/time';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  employeeId: number;
  year: number;
  month: number;
  onClose: () => void;
}

/** Manager drill-down: one employee's detailed attendance calendar + summary. */
const EmployeeDetailModal = ({ employeeId, year, month, onClose }: Props) => {
  const [data, setData] = useState<{
    employee: { first_name: string; last_name: string; department_name: string | null };
    days: AttendanceDay[];
    summary: AttendanceMonthSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<AttendanceDay | null>(null);

  useEffect(() => {
    AttendanceModel.employeeDetail(employeeId, year, month)
      .then((res) => {
        const d = (res.data as any)?.data;
        setData({
          employee: d.employee,
          days: d.days,
          summary: d.summary,
        });
      })
      .catch(() => setError('Could not load this employee’s attendance'));
  }, [employeeId, year, month]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells: Array<{ dayNum: number; day?: AttendanceDay } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dayNum: d, day: data?.days.find((x) => Number(x.date.slice(8, 10)) === d) });
  }
  const s = data?.summary;

  return (
    <Modal
      title={data ? `${data.employee.first_name} ${data.employee.last_name}` : 'Employee attendance'}
      onClose={onClose}
      width={560}
    >
      {error && <div className="clock-error">{error}</div>}
      {!data && !error && <div className="text-muted text-sm py-4">Loading…</div>}
      {data && s && (
        <div className="employee-detail">
          <div className="employee-detail-head">
            <span className="text-muted text-sm">
              {data.employee.department_name || 'No department'} · {year}-{String(month).padStart(2, '0')}
            </span>
          </div>

          <div className="employee-detail-summary">
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
              <div className="attendance-summary-cell"><span className="attendance-summary-num">{s.attendance_rate !== null ? `${s.attendance_rate}%` : '—'}</span><span className="attendance-summary-label">Rate</span></div>
            </div>
          </div>

          <div className="calendar-weekdays">
            {DAY_NAMES.map((w) => <div key={w} className="calendar-weekday">{w}</div>)}
          </div>
          <div className="calendar-grid employee-detail-calendar">
            {cells.map((cell, i) => {
              if (!cell) return <div key={`empty-${i}`} className="calendar-day" />;
              const d = cell.day;
              const status = d?.status ?? null;
              const meta = status ? STATUS_META[status] : null;
              return (
                <div
                  key={cell.dayNum}
                  className={`calendar-day attendance-day ${d && d.is_holiday ? 'holiday-cell' : ''} ${d?.clock_in ? 'worked-cell' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => d && setSelectedDay(d)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && d) setSelectedDay(d); }}
                >
                  <div className="calendar-day-number">{cell.dayNum}</div>
                  {status && (
                    <div className="attendance-day-status" title={meta?.label}>
                      <span aria-hidden="true">{meta?.icon}</span>
                    </div>
                  )}
                  {d?.total_work_minutes !== null && d?.clock_out && (
                    <div className="attendance-day-ot" title={`${formatMinutes(d.total_work_minutes || 0)} worked`}>
                      {formatMinutes(d.total_work_minutes || 0)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
      {selectedDay && <DayDetailsModal day={selectedDay} onClose={() => setSelectedDay(null)} />}
    </Modal>
  );
};

export default EmployeeDetailModal;