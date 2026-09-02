import React, { useState } from "react";
import type { Meeting, User } from "../../models";
import Modal from "../modals/Modal";
import Icon from "../common/Icon";
import { useChatViewModel } from "../../viewmodels/useChatViewModel";

interface CreateMeetingModalProps {
  meeting?: Meeting | null;
  users: User[];
  currentUserId: number;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description?: string;
    meeting_date: string;
    start_time: string;
    end_time: string;
    participants: number[];
    remind_before_minutes?: number;
    meeting_link?: string;
    recurrence_pattern?: 'none' | 'daily' | 'weekly' | 'monthly';
    recurrence_interval?: number;
    recurrence_end_date?: string;
    recurrence_days?: number[];
  }) => Promise<Meeting | undefined>;
  selectedDate?: string | null;
  initialStartTime?: string;
  initialEndTime?: string;
}

const CreateMeetingModal = ({
  meeting,
  users,
  currentUserId,
  onClose,
  onSubmit,
  selectedDate,
  initialStartTime,
  initialEndTime,
}: CreateMeetingModalProps) => {
  const { users: allUsers } = useChatViewModel();
  const [title, setTitle] = useState(meeting?.title || "");
  const [description, setDescription] = useState(meeting?.description || "");
  const [date, setDate] = useState(meeting?.meeting_date || selectedDate || "");
  const [start, setStart] = useState(meeting?.start_time || initialStartTime || "");
  const [end, setEnd] = useState(meeting?.end_time || initialEndTime || "");
  const [selected, setSelected] = useState<number[]>(
    meeting?.participants || [],
  );
  const [meetingLink, setMeetingLink] = useState(meeting?.meeting_link || "");
  const [remindBefore, setRemindBefore] = useState(meeting?.remind_before_minutes ?? 15);
  const [recurrencePattern, setRecurrencePattern] = useState<'none' | 'daily' | 'weekly' | 'monthly'>(meeting?.recurrence_pattern || 'none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(meeting?.recurrence_interval || 1);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(meeting?.recurrence_end_date || "");
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>(meeting?.recurrence_days || [1, 2, 3, 4, 5]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const others = allUsers.filter((u) => u.id !== currentUserId);

  const toggleParticipant = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleStartTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStart(val);
    if (val && !end) {
      const [h, m] = val.split(":").map(Number);
      const endHour = (h + 1) % 24;
      setEnd(`${String(endHour).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSubmitError(null);
    try {
      await onSubmit({
        title,
        description,
        meeting_date: date,
        start_time: start,
        end_time: end,
        participants: selected,
        remind_before_minutes: remindBefore,
        meeting_link: meetingLink,
        recurrence_pattern: recurrencePattern,
        recurrence_interval: recurrenceInterval,
        recurrence_end_date: recurrenceEndDate || undefined,
        recurrence_days: recurrenceDays,
      });
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save meeting');
    } finally {
      setSaving(false);
    }
  };

  const toggleRecurrenceDay = (day: number) => {
    setRecurrenceDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  };

  return (
    <Modal
      onClose={onClose}
      title={meeting ? "Edit Meeting" : "Schedule Meeting"}
    >
      <form onSubmit={handleSubmit} className="meeting-form">
        {submitError && (
          <div className="form-error">{submitError}</div>
        )}

        <div className="meeting-form-section">
          <div className="meeting-form-section-header">
            <span className="meeting-form-section-icon">
              <Icon name="message" size={14} />
            </span>
            <span>Basic Info</span>
          </div>
          <div className="meeting-form-section-body">
            <label>
              Title *
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Meeting title"
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Add a description..."
              />
            </label>
          </div>
        </div>

        <div className="meeting-form-section">
          <div className="meeting-form-section-header">
            <span className="meeting-form-section-icon">
              <Icon name="calendar" size={14} />
            </span>
            <span>Date & Time</span>
          </div>
          <div className="meeting-form-section-body">
            <label>
              Date *
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
            <div className="form-row">
              <label>
                Start Time *
                <input
                  type="time"
                  value={start}
                  onChange={handleStartTimeChange}
                  required
                />
              </label>
              <label>
                End Time *
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </label>
            </div>
          </div>
        </div>

        <div className="meeting-form-section">
          <div className="meeting-form-section-header">
            <span className="meeting-form-section-icon">
              <Icon name="users" size={14} />
            </span>
            <span>Participants</span>
          </div>
          <div className="meeting-form-section-body">
            <div className="participant-picker">
              {others.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={`participant-chip ${selected.includes(u.id) ? "selected" : ""}`}
                  onClick={() => toggleParticipant(u.id)}
                >
                  {selected.includes(u.id) && <Icon name="check" size={11} />}
                  {u.first_name} {u.last_name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="meeting-form-section">
          <div className="meeting-form-section-header">
            <span className="meeting-form-section-icon">
              <Icon name="bell" size={14} />
            </span>
            <span>Settings</span>
          </div>
          <div className="meeting-form-section-body">
            <label>
              Meeting Link
              <input
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://meet.example.com/..."
              />
            </label>
            <label>
              Remind before (minutes)
              <input
                type="number"
                value={remindBefore}
                onChange={(e) => setRemindBefore(Number(e.target.value))}
                min={1}
              />
            </label>
            <label>
              Recurrence
              <select value={recurrencePattern} onChange={(e) => setRecurrencePattern(e.target.value as 'none' | 'daily' | 'weekly' | 'monthly')}>
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            {recurrencePattern !== 'none' && (
              <>
                <label>
                  Repeat every
                  <input
                    type="number"
                    value={recurrenceInterval}
                    onChange={(e) => setRecurrenceInterval(Number(e.target.value))}
                    min={1}
                  />
                  {recurrencePattern === 'daily' && ' day(s)'}
                  {recurrencePattern === 'weekly' && ' week(s)'}
                  {recurrencePattern === 'monthly' && ' month(s)'}
                </label>
                {recurrencePattern === 'weekly' && (
                  <label>
                    Repeat on
                    <div className="participant-picker">
                      {[
                        { day: 0, label: 'Sun' },
                        { day: 1, label: 'Mon' },
                        { day: 2, label: 'Tue' },
                        { day: 3, label: 'Wed' },
                        { day: 4, label: 'Thu' },
                        { day: 5, label: 'Fri' },
                        { day: 6, label: 'Sat' },
                      ].map(({ day, label }) => (
                        <button
                          key={day}
                          type="button"
                          className={`participant-chip ${recurrenceDays.includes(day) ? "selected" : ""}`}
                          onClick={() => toggleRecurrenceDay(day)}
                        >
                          {recurrenceDays.includes(day) && <Icon name="check" size={11} />}
                          {label}
                        </button>
                      ))}
                    </div>
                  </label>
                )}
                <label>
                  Ends on
                  <input
                    type="date"
                    value={recurrenceEndDate}
                    onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving..." : meeting ? "Update" : "Schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateMeetingModal;
