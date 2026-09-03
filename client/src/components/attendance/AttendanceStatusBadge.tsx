import React from 'react';
import { STATUS_META, type DayStatus } from '../../models/Attendance';

interface Props {
  status: DayStatus;
  showLabel?: boolean;
}

/** Small colored chip/icon for an attendance status (🟢 Present, 🟡 Late, …). */
const AttendanceStatusBadge = ({ status, showLabel = true }: Props) => {
  if (!status) return null;
  const meta = STATUS_META[status] || { icon: '•', label: status };
  return (
    <span className={`attendance-status attendance-status-${status}`} title={meta.label}>
      <span aria-hidden="true">{meta.icon}</span>
      {showLabel && <span className="attendance-status-label">{meta.label}</span>}
    </span>
  );
};

export default AttendanceStatusBadge;