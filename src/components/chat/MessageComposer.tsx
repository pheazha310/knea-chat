import React, { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "../common/Avatar";
import Icon from "../common/Icon";
import { EmojiPicker } from "./ChatEnhancements";
import type { ChatMessage, Conversation, User } from "../../models";

const CHAR_LIMIT = 4000;

interface MessageComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  active: Conversation | null;
  replyTo: ChatMessage | null;
  onClearReply: () => void;
  users: User[];
  onSendFile: (file: File) => void;
  uploading: boolean;
  uploadProgress: number | null;
}

const MessageComposer = ({
  draft,
  onDraftChange,
  onSend,
  active,
  replyTo,
  onClearReply,
  users,
  onSendFile,
  uploading,
  uploadProgress,
}: MessageComposerProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- voice messages (MediaRecorder → upload as a file) -------------------
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number | null>(null);

  // Stop the mic if the composer unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const clearRecording = () => {
    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    recorderRef.current = null;
    streamRef.current = null;
    setRecording(false);
    setRecordSeconds(0);
  };

  const startRecording = async () => {
    if (uploading || recording) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      alert("Voice messages are not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : "webm";
        const file = new File(
          [new Blob(chunksRef.current, { type })],
          `voice-${Date.now()}.${ext}`,
          { type },
        );
        stream.getTracks().forEach((t) => t.stop());
        if (file.size > 0 && !uploading) onSendFile(file);
      };
      recorderRef.current = recorder;
      streamRef.current = stream;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(
        () => setRecordSeconds((s) => s + 1),
        1000,
      );
    } catch (err: any) {
      alert(
        `Could not access your microphone: ${err?.message || "permission denied"}`,
      );
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    clearRecording();
  };

  const cancelRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      // Suppress the onstop handler so nothing is sent.
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    clearRecording();
  };

  const recordLabel =
    `${String(Math.floor(recordSeconds / 60)).padStart(2, "0")}:` +
    `${String(recordSeconds % 60).padStart(2, "0")}`;

  // Generate animated waveform bars for recording state
  const [recordingBars, setRecordingBars] = useState<number[]>([]);

  useEffect(() => {
    if (!recording) {
      setRecordingBars([]);
      return;
    }
    setRecordingBars(
      Array.from({ length: 20 }, () => Math.random() * 0.5 + 0.2),
    );
    const interval = setInterval(() => {
      setRecordingBars((prev) => prev.map(() => Math.random() * 0.7 + 0.15));
    }, 150);
    return () => clearInterval(interval);
  }, [recording]);

  // ---- file attachment (paperclip / drag & drop / paste) ------------------
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !uploading) onSendFile(file);
  };

  // ---- emoji picker --------------------------------------------------------
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Close the picker when clicking anywhere else or pressing Escape.
  useEffect(() => {
    if (!emojiOpen) return;
    const close = (e: MouseEvent) => {
      if (
        !(e.target as HTMLElement).closest(
          ".emoji-picker, .emoji-picker-enhanced, .emoji-toggle",
        )
      ) {
        setEmojiOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [emojiOpen]);

  const insertEmoji = (emoji: string) => {
    const pos = caretRef.current;
    const next = draft.slice(0, pos) + emoji + draft.slice(pos);
    onDraftChange(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const caret = pos + emoji.length;
        el.focus();
        el.setSelectionRange(caret, caret);
        caretRef.current = caret;
      }
    });
  };

  // ---- @mention autocomplete ---------------------------------------------
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const caretRef = useRef<number>(draft.length);

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    const list = q
      ? users.filter((u) =>
          `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(q),
        )
      : users;
    return list.slice(0, 8);
  }, [users, mentionQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [mentionQuery]);

  const updateMentionState = (value: string, caret?: number) => {
    const pos = typeof caret === "number" ? caret : value.length;
    const before = value.slice(0, pos);
    // Require a word boundary before @ so emails like user@example.com do
    // not open the autocomplete.
    const match = before.match(/(?:^|\s)@([A-Za-zÀ-ÿ0-9_.\-']*)$/);
    if (match) {
      setMentionOpen(true);
      setMentionQuery(match[1]);
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (user: User) => {
    const pos = caretRef.current;
    const before = draft.slice(0, pos);
    const match = before.match(/(?:^|\s)@([A-Za-zÀ-ÿ0-9_.\-']*)$/);
    const start = match
      ? pos - (match[0].length - (match[0].startsWith("@") ? 0 : 1))
      : pos;
    const inserted = `@${user.first_name} ${user.last_name} `;
    const next = draft.slice(0, start) + inserted + draft.slice(pos);
    onDraftChange(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const caret = start + inserted.length;
        el.focus();
        el.setSelectionRange(caret, caret);
        caretRef.current = caret;
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionCandidates[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        setMentionOpen(false);
        return;
      }
    }
    if (emojiOpen && e.key === "Escape") {
      setEmojiOpen(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    onDraftChange(value);
    caretRef.current = e.target.selectionStart;
    updateMentionState(value, e.target.selectionStart);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && !uploading) onSendFile(file);
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = e.clipboardData?.files?.[0];
    if (file && !uploading) {
      // Pasting an image/file from the clipboard attaches it instead of
      // dropping a broken path into the message text.
      e.preventDefault();
      onSendFile(file);
    }
  };

  const replyName =
    replyTo &&
    `${"first_name" in replyTo ? replyTo.first_name : (replyTo as any).senderFirstName || ""} ${
      "last_name" in replyTo
        ? replyTo.last_name
        : (replyTo as any).senderLastName || ""
    }`.trim();

  return (
    <div
      className={`composer-wrap${dragOver ? " drag-over" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={handleDrop}
    >
      {replyTo && (
        <div className="reply-bar">
          <span>↩︎</span>
          <div>
            <b>Replying to {replyName || "message"}</b>
            <p>{replyTo.content}</p>
          </div>
          <button onClick={onClearReply} aria-label="Cancel reply">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      {recording && (
        <div className="voice-recording">
          <span className="rec-dot" />
          <b>Recording voice message</b>
          <div className="rec-waveform" aria-hidden="true">
            {recordingBars.map((h, i) => (
              <span
                key={i}
                className="rec-bar"
                style={{ height: `${Math.max(h * 100, 12)}%` }}
              />
            ))}
          </div>
          <span className="rec-timer">{recordLabel}</span>
          <button type="button" className="rec-stop" onClick={stopRecording}>
            <Icon name="send" size={13} /> Send
          </button>
          <button
            type="button"
            className="rec-cancel"
            onClick={cancelRecording}
            aria-label="Cancel recording"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      <div className="composer">
        {uploading && (
          <div className="upload-progress">
            <span>
              Uploading… {uploadProgress !== null ? `${uploadProgress}%` : ""}
            </span>
            <i style={{ width: `${uploadProgress ?? 0}%` }} />
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) =>
            updateMentionState((e.target as HTMLTextAreaElement).value)
          }
          onSelect={(e) => {
            caretRef.current = (e.target as HTMLTextAreaElement).selectionStart;
            updateMentionState(
              (e.target as HTMLTextAreaElement).value,
              caretRef.current,
            );
          }}
          onPaste={handlePaste}
          placeholder={`Message ${active?.type === "channel" ? `#${active.name}` : active?.name || ""}`}
        />
        {mentionOpen && mentionCandidates.length > 0 && (
          <div className="mention-dropdown">
            {mentionCandidates.map((u, i) => (
              <button
                key={u.id}
                type="button"
                className={i === activeIndex ? "active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(u)}
              >
                <Avatar person={u} className="small" showStatus />
                <b>
                  {u.first_name} {u.last_name}
                </b>
                <small>{u.job_title || u.email}</small>
              </button>
            ))}
          </div>
        )}
        {emojiOpen && (
          <EmojiPicker
            onSelect={insertEmoji}
            onClose={() => setEmojiOpen(false)}
          />
        )}
        <div className="composer-tools">
          <div className="tool-group">
            <button
              type="button"
              className="attach-button"
              title={uploading ? "Uploading…" : "Attach a file"}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Icon name="paperclip" size={15} />
            </button>
            <button type="button" title="Bold (⌘B)">
              <Icon name="bold" size={15} />
            </button>
            <button
              type="button"
              className={`emoji-toggle${emojiOpen ? " active" : ""}`}
              title="Insert emoji"
              onClick={() => setEmojiOpen((v) => !v)}
            >
              <Icon name="emoji" size={15} />
            </button>
            <span className="tool-divider" />
            <button type="button" title="More options">
              <Icon name="more" size={15} />
            </button>
            <button
              type="button"
              className={`mic-toggle${recording ? " active" : ""}`}
              title={
                recording
                  ? "Recording… click to send"
                  : "Record a voice message"
              }
              onClick={recording ? stopRecording : startRecording}
              disabled={uploading}
            >
              <Icon name="mic" size={15} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={handleFile}
            />
          </div>
          <button
            className="send-button"
            onClick={onSend}
            disabled={!draft.trim()}
          >
            Send <Icon name="send" size={13} />
          </button>
        </div>
        {draft.length > 0 && (
          <span
            className={`composer-char-count${
              draft.length > CHAR_LIMIT * 0.9 ? " warn" : ""
            }${draft.length > CHAR_LIMIT ? " limit" : ""}`}
          >
            {Math.min(draft.length, CHAR_LIMIT)}/{CHAR_LIMIT}
          </span>
        )}
      </div>
    </div>
  );
};

export default MessageComposer;
