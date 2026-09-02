import React, { useState } from "react";
import Modal from "./Modal";

interface MeetingReminderModalProps {
  onClose: () => void;
  onSubmit: (remindAt: string) => Promise<void>;
}

const MeetingReminderModal = ({ onClose, onSubmit }: MeetingReminderModalProps) => {
  const [remindAt, setRemindAt] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remindAt) return;
    setSaving(true);
    try {
      await onSubmit(remindAt);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Set Meeting Reminder">
      <form onSubmit={handleSubmit}>
        <label>
          Remind me at
          <input
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            required
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !remindAt}>
            {saving ? "Saving..." : "Set Reminder"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default MeetingReminderModal;
