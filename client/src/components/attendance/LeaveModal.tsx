import React, { useState } from 'react';
import Modal from '../modals/Modal';
import { LEAVE_TYPE_LABELS, type LeaveType } from '../../models/Attendance';

interface Props {
  onClose: () => void;
  onSubmit: (data: { leave_type: LeaveType; start_date: string; end_date: string; reason?: string }) => Promise<void>;
  defaultDate?: string;
}

const LeaveModal = ({ onClose, onSubmit, defaultDate }: Props) => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [leaveType, setLeaveType] = useState<LeaveType>('annual');
  const [startDate, setStartDate] = useState(defaultDate || todayStr);
  const [endDate, setEndDate] = useState(defaultDate || todayStr);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate) {
      setError('Start and end dates are required');
      return;
    }
    if (startDate > endDate) {
      setError('End date must be on or after the start date');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason.trim() || undefined });
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Could not submit leave request');
      setBusy(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-lavender/40 focus:border-lavender text-sm';

  return (
    <Modal title="Request Leave" onClose={onClose} width={440}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-muted block mb-1">Leave type</label>
          <select className={inputCls} value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
            {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => (
              <option key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted block mb-1">Start date</label>
            <input type="date" className={inputCls} value={startDate} min={todayStr} onChange={(e) => setStartDate(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted block mb-1">End date</label>
            <input type="date" className={inputCls} value={endDate} min={startDate || todayStr} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted block mb-1">Reason</label>
          <textarea className={inputCls} rows={3} placeholder="Optional reason…" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <div className="clock-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default LeaveModal;