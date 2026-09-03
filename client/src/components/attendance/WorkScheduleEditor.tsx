import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../modals/Modal';
import { WorkScheduleModel, type WorkSchedule } from '../../models/Attendance';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: '08:00', end: '17:00' },
  2: { start: '08:00', end: '17:00' },
  3: { start: '08:00', end: '17:00' },
  4: { start: '08:00', end: '17:00' },
  5: { start: '08:00', end: '17:00' },
};

interface Props {
  employeeId: number;
  employeeName: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Manager configuration page for one employee's weekly schedule. */
const WorkScheduleEditor = ({ employeeId, employeeName, onClose, onSaved }: Props) => {
  const [rows, setRows] = useState<Record<number, EditableSchedule>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    WorkScheduleModel.getByEmployee(employeeId)
      .then((res) => {
        const list = (res.data as any)?.data?.schedules || [];
        const map: Record<number, EditableSchedule> = {};
        for (const s of list) map[s.day_of_week] = s;
        setRows(map);
      })
      .catch(() => setError('Could not load the schedule'))
      .finally(() => setLoading(false));
  }, [employeeId]);

  const ordered = useMemo(() => [1, 2, 3, 4, 5, 6, 0], []);

  const updateDay = (dow: number, patch: Partial<Omit<WorkSchedule, 'day_of_week'>>) => {
    setRows((prev) => ({ ...prev, [dow]: { ...(prev[dow] || { day_of_week: dow }), ...patch } }));
  };

  const setWorking = (dow: number, working: boolean) => {
    const base = rows[dow];
    const def = DEFAULT_TIMES[dow] || { start: '08:00', end: '17:00' };
    updateDay(dow, {
      is_working_day: working ? 1 : 0,
      start_time: working ? (base?.start_time || def.start) : null,
      end_time: working ? (base?.end_time || def.end) : null,
    });
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      for (const dow of ordered) {
        const row = rows[dow];
        if (!row) continue;
        await WorkScheduleModel.upsert({
          employee_id: employeeId,
          day_of_week: dow,
          start_time: row.start_time,
          end_time: row.end_time,
          break_minutes: row.break_minutes ?? 60,
          required_work_minutes: row.required_work_minutes ?? 480,
          is_working_day: row.is_working_day ?? 0,
        });
      }
      setMessage('Schedule saved ✓');
      onSaved();
      setTimeout(onClose, 900);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not save the schedule');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-lavender w-full';

  return (
    <Modal title={`Work schedule — ${employeeName}`} onClose={onClose} width={560}>
      {loading ? (
        <div className="text-muted text-sm py-4">Loading schedule…</div>
      ) : (
        <div>
          <table className="admin-table schedule-editor-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Working</th>
                <th>Start</th>
                <th>End</th>
                <th>Break (min)</th>
                <th>Required (min)</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((dow) => {
                const row = rows[dow];
                const working = row ? row.is_working_day === 1 : dow !== 0 && dow !== 6;
                return (
                  <tr key={dow}>
                    <td className="font-semibold">{DAY_NAMES[dow]}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={working}
                        onChange={(e) => setWorking(dow, e.target.checked)}
                        aria-label={`${DAY_NAMES[dow]} working day`}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        className={inputCls}
                        disabled={!working}
                        value={row?.start_time?.slice(0, 5) || DEFAULT_TIMES[dow]?.start || '08:00'}
                        onChange={(e) => updateDay(dow, { start_time: e.target.value || null })}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        className={inputCls}
                        disabled={!working}
                        value={row?.end_time?.slice(0, 5) || DEFAULT_TIMES[dow]?.end || '17:00'}
                        onChange={(e) => updateDay(dow, { end_time: e.target.value || null })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className={`${inputCls} w-20`}
                        min={0}
                        value={row?.break_minutes ?? 60}
                        onChange={(e) => updateDay(dow, { break_minutes: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className={`${inputCls} w-20`}
                        min={0}
                        value={working ? (row?.required_work_minutes ?? 480) : 0}
                        disabled={!working}
                        onChange={(e) => updateDay(dow, { required_work_minutes: Number(e.target.value) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {error && <div className="clock-error mt-3">{error}</div>}
          {message && <div className="text-green-600 text-sm mt-3">{message}</div>}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={handleSave}>
              {busy ? 'Saving…' : 'Save schedule'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

type EditableSchedule = Partial<Omit<WorkSchedule, 'day_of_week'>> & { day_of_week: number };

export default WorkScheduleEditor;