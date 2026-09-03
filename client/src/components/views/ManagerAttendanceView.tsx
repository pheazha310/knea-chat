import React, { useEffect, useMemo, useState } from 'react';
import { useAttendanceStore } from '../../store/attendanceStore';
import WorkScheduleEditor from '../attendance/WorkScheduleEditor';
import EmployeeDetailModal from '../attendance/EmployeeDetailModal';
import DayDetailsModal from '../attendance/DayDetailsModal';
import type { AttendanceDay, LeaveType, Holiday } from '../../models/Attendance';
import { LEAVE_TYPE_LABELS } from '../../models/Attendance';
import { formatMinutes } from '../../utils/time';
import Icon from '../common/Icon';
import Modal from '../modals/Modal';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  departments?: Array<{ id: number; name: string }>;
  users?: Array<{ id: number; first_name: string; last_name: string; department_id?: number | null; role?: string }>;
}

/** Manager Attendance Console — today dashboard, employee×day table,
 *  work schedule config, leave approvals and public holiday management. */
const ManagerAttendanceView = ({ departments = [], users = [] }: Props) => {
  const {
    dashboard,
    employees,
    leaves,
    holidays,
    overtime,
    loadDashboard,
    loadEmployees,
    loadSchedules,
    loadLeaves,
    loadHolidays,
    loadOvertime,
    approveLeave,
    rejectLeave,
    createHoliday,
    deleteHoliday,
    approveOvertime,
    rejectOvertime,
  } = useAttendanceStore();

  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [scheduleFor, setScheduleFor] = useState<{ id: number; name: string } | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<{ id: number; name: string } | null>(null);
  const [selectedDay, setSelectedDay] = useState<{ day: AttendanceDay; employeeName: string } | null>(null);
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ name: '', date: '', description: '' });
  const [holidayError, setHolidayError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
    loadSchedules();
    loadLeaves();
    loadHolidays();
    loadOvertime();
  }, [loadDashboard, loadSchedules, loadLeaves, loadHolidays, loadOvertime]);

  useEffect(() => {
    loadEmployees({
      year: viewYear,
      month: viewMonth,
      department_id: filterDept ? Number(filterDept) : undefined,
      status: filterStatus || undefined,
    });
  }, [viewYear, viewMonth, filterDept, filterStatus, loadEmployees]);

  const goToPrevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const goToNextMonth = () => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const dashboardCards = useMemo(() => {
    if (!dashboard) return [];
    return [
      { label: 'Total employees', value: dashboard.total_employees, icon: 'users' },
      { label: 'Present', value: dashboard.present, icon: 'check' },
      { label: 'Late', value: dashboard.late, icon: 'clock' },
      { label: 'Absent', value: dashboard.absent, icon: 'x' },
      { label: 'On leave', value: dashboard.on_leave, icon: 'calendar' },
      { label: 'Day off', value: dashboard.day_off, icon: 'moon' },
      { label: 'Holiday', value: dashboard.holiday, icon: 'sparkles' },
      { label: 'Currently working', value: dashboard.currently_working, icon: 'bolt' },
      { label: 'On break', value: dashboard.on_break, icon: 'clock' },
    ];
  }, [dashboard]);

  const pendingLeaves = useMemo(() => leaves.filter((l) => l.status === 'pending'), [leaves]);
  const pendingOvertime = useMemo(() => overtime.filter((o) => o.status === 'pending'), [overtime]);

  const handleHolidaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHolidayError(null);
    if (!holidayForm.name.trim() || !holidayForm.date) {
      setHolidayError('Name and date are required');
      return;
    }
    try {
      await createHoliday({ name: holidayForm.name.trim(), date: holidayForm.date, description: holidayForm.description || undefined });
      setShowHolidayForm(false);
      setHolidayForm({ name: '', date: '', description: '' });
      setMessage('Holiday added ✓');
      setTimeout(() => setMessage(null), 2000);
    } catch (err: any) {
      setHolidayError(err.response?.data?.message || 'Could not add holiday');
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm';

  return (
    <div className="attendance-view manager-attendance">
      <div className="attendance-shell">
        <div className="attendance-main">
          <div className="manager-attendance-dashboard">
            <h3 className="sidebar-section-title">Today's attendance — {dashboard ? dashboard.date : ''}</h3>
            <div className="manager-dashboard-grid">
              {dashboardCards.map((c) => (
                <div key={c.label} className="manager-stat-card">
                  <div className="manager-stat-label">
                    <span><Icon name={c.icon as never} size={15} /></span>
                    <small>{c.label}</small>
                  </div>
                  <div className="manager-stat-value">{c.value}</div>
                </div>
              ))}
            </div>
            {message && <div className="text-green-600 text-sm mt-3">{message}</div>}
          </div>

          <div className="attendance-toolbar">
            <div className="meetings-toolbar-nav" role="group" aria-label="Calendar navigation">
              <button className="nav-arrow" onClick={goToPrevMonth} aria-label="Previous month">
                <Icon name="chevron-left" size={15} />
              </button>
              <button className="today-btn" onClick={() => {
                const n = new Date();
                setViewYear(n.getFullYear());
                setViewMonth(n.getMonth() + 1);
                loadDashboard();
              }}>Today</button>
              <button className="nav-arrow" onClick={goToNextMonth} aria-label="Next month">
                <Icon name="chevron-right" size={15} />
              </button>
            </div>
            <h2 className="attendance-title">Attendance — {MONTH_NAMES[viewMonth - 1]} {viewYear}</h2>
            <div className="attendance-filters">
              <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} aria-label="Filter by department">
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Filter by status">
                <option value="">All statuses</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="leave">Leave</option>
                <option value="day_off">Day off</option>
                <option value="holiday">Holiday</option>
              </select>
            </div>
          </div>

          <div className="table-scroll manager-attendance-table-wrap">
            <table className="admin-table manager-attendance-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <th key={d} className="attendance-col-day">
                      {d === 1 || d % 5 === 0 ? d : ''}
                    </th>
                  ))}
                  <th>Rate</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.employee_id}>
                    <td className="font-semibold whitespace-nowrap">
                      <button
                        className="attendance-employee-name"
                        onClick={() => setDetailEmployee({ id: emp.employee_id, name: `${emp.first_name} ${emp.last_name}` })}
                        title={`Open ${emp.first_name} ${emp.last_name}’s attendance`}
                      >
                        {emp.first_name} {emp.last_name}
                      </button>
                      {emp.department_name && <small className="block text-muted font-normal">{emp.department_name}</small>}
                    </td>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                      const day = emp.days.find((x) => Number(x.date.slice(8, 10)) === d);
                      if (!day) return <td key={d} />;
                      return (
                        <td key={d} className="attendance-col-day">
                          <button
                            className={`attendance-cell status-${day.status || 'none'}`}
                            title={`${day.date}: ${day.status || ''}${day.total_work_minutes ? ` · ${formatMinutes(day.total_work_minutes)}` : ''}`}
                            onClick={() => setSelectedDay({ day, employeeName: `${emp.first_name} ${emp.last_name}` })}
                          >
                            <span aria-hidden="true">{statusIcon(day.status)}</span>
                          </button>
                        </td>
                      );
                    })}
                    <td className="text-muted text-sm whitespace-nowrap">
                      {emp.summary.attendance_rate !== null ? `${emp.summary.attendance_rate}%` : '—'}
                    </td>
                    <td className="whitespace-nowrap">
                      <button
                        className="btn-secondary !py-1 !px-2 !text-xs"
                        onClick={() => setScheduleFor({ id: emp.employee_id, name: `${emp.first_name} ${emp.last_name}` })}
                      >
                        Schedule
                      </button>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr><td colSpan={35} className="text-center text-muted py-6">No employees found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="attendance-sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">Pending leave requests ({pendingLeaves.length})</h3>
            {pendingLeaves.length === 0 ? (
              <div className="text-muted text-sm">Nothing pending.</div>
            ) : (
              <ul className="attendance-leave-list">
                {pendingLeaves.map((l) => (
                  <li key={l.id}>
                    <div className="attendance-leave-row">
                      <b>{l.employee_first_name} {l.employee_last_name}</b>
                      <span className={`status-pill ${l.status}`}>{l.status}</span>
                    </div>
                    <small className="text-muted">{LEAVE_TYPE_LABELS[l.leave_type as LeaveType]} · {l.start_date} → {l.end_date}</small>
                    {l.reason && <small className="text-muted block">{l.reason}</small>}
                    <div className="flex gap-2 mt-2">
                      <button className="btn-primary !py-1 !px-2 !text-xs" onClick={() => approveLeave(l.id)}>Approve</button>
                      <button className="btn-danger !py-1 !px-2 !text-xs" onClick={() => rejectLeave(l.id)}>Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="sidebar-section">
            <h3 className="sidebar-section-title">Pending overtime ({pendingOvertime.length})</h3>
            {pendingOvertime.length === 0 ? (
              <div className="text-muted text-sm">Nothing pending.</div>
            ) : (
              <ul className="attendance-leave-list">
                {pendingOvertime.map((o) => (
                  <li key={o.id}>
                    <div className="attendance-leave-row">
                      <b>{o.employee_first_name} {o.employee_last_name}</b>
                      <span className={`status-pill ${o.status}`}>{o.status}</span>
                    </div>
                    <small className="text-muted">
                      {o.date} · +{formatMinutes(o.minutes)}
                      {o.reason ? ` · ${o.reason}` : ''}
                    </small>
                    <div className="flex gap-2 mt-2">
                      <button className="btn-primary !py-1 !px-2 !text-xs" onClick={() => approveOvertime(o.id)}>Approve</button>
                      <button className="btn-danger !py-1 !px-2 !text-xs" onClick={() => rejectOvertime(o.id)}>Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="sidebar-section">
            <div className="attendance-holiday-head">
              <h3 className="sidebar-section-title">Public holidays</h3>
              <button className="btn-secondary !py-1 !px-2 !text-xs" onClick={() => setShowHolidayForm((v) => !v)}>
                {showHolidayForm ? 'Cancel' : 'Add'}
              </button>
            </div>
            {showHolidayForm && (
              <form onSubmit={handleHolidaySubmit} className="space-y-2 mt-2">
                <input className={inputCls} placeholder="Name (e.g. Pchum Ben)" value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} />
                <input className={inputCls} type="date" value={holidayForm.date} onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })} />
                <input className={inputCls} placeholder="Description (optional)" value={holidayForm.description} onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })} />
                {holidayError && <div className="clock-error">{holidayError}</div>}
                <button type="submit" className="btn-primary w-full !py-2 !text-xs">Add holiday</button>
              </form>
            )}
            <ul className="attendance-holiday-list mt-2">
              {holidays.length === 0 ? (
                <li className="text-muted text-sm">No public holidays yet.</li>
              ) : holidays.map((h: Holiday) => (
                <li key={h.id}>
                  <span>🎉 <b>{h.name}</b> <span className="text-muted">{h.date}</span></span>
                  <button className="picker-remove" onClick={() => deleteHoliday(h.id)}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {scheduleFor && (
        <WorkScheduleEditor
          employeeId={scheduleFor.id}
          employeeName={scheduleFor.name}
          onClose={() => setScheduleFor(null)}
          onSaved={() => loadEmployees({ year: viewYear, month: viewMonth, department_id: filterDept ? Number(filterDept) : undefined, status: filterStatus || undefined })}
        />
      )}
      {detailEmployee && (
        <EmployeeDetailModal
          employeeId={detailEmployee.id}
          year={viewYear}
          month={viewMonth}
          onClose={() => setDetailEmployee(null)}
        />
      )}
      {selectedDay && (
        <DayDetailsModal day={selectedDay.day} onClose={() => setSelectedDay(null)} />
      )}
    </div>
  );
};

const statusIcon = (status: string | null | undefined): string => {
  switch (status) {
    case 'present': return '🟢';
    case 'late': return '🟡';
    case 'absent': return '🔴';
    case 'leave': return '🔵';
    case 'day_off': return '⚪';
    case 'holiday': return '🎉';
    case 'early_leave': return '🌅';
    case 'under_time': return '⏳';
    case 'overtime': return '➕';
    case 'not_started': return '○';
    default: return '';
  }
};

export default ManagerAttendanceView;