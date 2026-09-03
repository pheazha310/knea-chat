import React from 'react';
import Modal from '../modals/Modal';
import AttendanceStatusBadge from './AttendanceStatusBadge';
import type { AttendanceDay } from '../../models/Attendance';
import { formatMinutes } from '../../utils/time';

interface Props {
  day: AttendanceDay;
  onClose: () => void;
}

const formatTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateLong = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

/** Detail panel for a single calendar date (click a day on the calendar). */
const DayDetailsModal = ({ day, onClose }: Props) => (
  <Modal title={formatDateLong(day.date)} onClose={onClose} width={440}>
    <div className="day-details">
      <div className="day-details-status">
        <AttendanceStatusBadge status={day.status} />
      </div>

      {day.is_holiday && (
        <div className="day-details-holiday">🎉 {day.holiday_name}</div>
      )}

      <div className="meeting-detail-section">
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Schedule</span>
          <span className="meeting-detail-value">
            {day.is_working_day && day.scheduled_start
              ? `${day.scheduled_start.slice(0, 5)} – ${day.scheduled_end?.slice(0, 5)}`
              : 'Day off'}
          </span>
        </div>
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Break</span>
          <span className="meeting-detail-value">{day.break_minutes ? `${day.break_minutes}m` : '—'}</span>
        </div>
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Required</span>
          <span className="meeting-detail-value">{formatMinutes(day.required_work_minutes)}</span>
        </div>
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Clock In</span>
          <span className="meeting-detail-value">{formatTime(day.clock_in)}</span>
        </div>
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Clock Out</span>
          <span className="meeting-detail-value">{formatTime(day.clock_out)}</span>
        </div>
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Actual Working Time</span>
          <span className="meeting-detail-value">
            {day.total_work_minutes !== null ? formatMinutes(day.total_work_minutes) : '—'}
          </span>
        </div>
      </div>

      {day.late_minutes > 0 && (
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Late</span>
          <span className="meeting-detail-value text-warn">{formatMinutes(day.late_minutes)}</span>
        </div>
      )}
      {day.early_leave_minutes > 0 && (
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Early Leave</span>
          <span className="meeting-detail-value text-warn">{formatMinutes(day.early_leave_minutes)}</span>
        </div>
      )}
      {day.under_time_minutes > 0 && (
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Under Time</span>
          <span className="meeting-detail-value text-warn">{formatMinutes(day.under_time_minutes)}</span>
        </div>
      )}
      {day.overtime_minutes > 0 && (
        <div className="meeting-detail-row">
          <span className="meeting-detail-label">Overtime</span>
          <span className="meeting-detail-value text-ok">+{formatMinutes(day.overtime_minutes)}</span>
        </div>
      )}
    </div>
  </Modal>
);

export default DayDetailsModal;