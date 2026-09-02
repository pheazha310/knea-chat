import React, { useState } from "react";
import Modal from "./Modal";

interface MeetingNoteModalProps {
  onClose: () => void;
  onSubmit: (content: string) => Promise<void>;
}

const MeetingNoteModal = ({ onClose, onSubmit }: MeetingNoteModalProps) => {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await onSubmit(content.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Add Meeting Note">
      <form onSubmit={handleSubmit}>
        <label>
          Note
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="Enter meeting note..."
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !content.trim()}>
            {saving ? "Saving..." : "Add Note"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default MeetingNoteModal;
