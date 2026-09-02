import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import type { Meeting, User } from "../../models";
import Icon from "../common/Icon";
import Avatar from "../common/Avatar";
import Modal from "../modals/Modal";
import CreateMeetingModal from "../modals/CreateMeetingModal";
import MeetingNoteModal from "../modals/MeetingNoteModal";
import MeetingReminderModal from "../modals/MeetingReminderModal";
import WeekGridView from "./WeekGridView";
import DayGridView from "./DayGridView";
import { useMeetingStore } from "../../store/meetingStore";
import { formatMeetingTime, formatDateWithTimezone } from "../../utils/timezone";
import { formatTime12, formatDuration } from "../../utils/time";

interface MeetingsViewProps {
  meetings: Meeting[];
  currentUserId: number;
  canSchedule: boolean;
  onCreate: (data: {
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
  onUpdate: (
    id: number,
    data: {
      title?: string;
      description?: string;
      meeting_date?: string;
      start_time?: string;
      end_time?: string;
      participants?: number[];
      status?: "scheduled" | "completed" | "cancelled";
      recording_url?: string;
      recording_status?: "none" | "recording" | "processed" | "failed";
      calendar_event_id?: string;
      calendar_provider?: "google" | "outlook" | "ical";
      meeting_link?: string;
      remind_before_minutes?: number;
      recurrence_pattern?: 'none' | 'daily' | 'weekly' | 'monthly';
      recurrence_interval?: number;
      recurrence_end_date?: string;
      recurrence_days?: number[];
    },
  ) => Promise<Meeting | undefined>;
  onCancel: (id: number) => Promise<void>;
  onStartCall: (target: { type: "voice" | "video"; targetId: number; targetType: "user" | "conversation"; name: string; isGroup?: boolean; members?: any[]; conversationId?: number }) => void;
  teams?: Array<{ id: number; name: string; department_id?: number }>;
  departments?: Array<{ id: number; name: string }>;
  users?: User[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

type CalendarViewMode = "year" | "month" | "week" | "day" | "agenda";

const MeetingsView = ({
  meetings,
  currentUserId,
  canSchedule,
  onCreate,
  onUpdate,
  onCancel,
  onStartCall,
  teams,
  departments,
  users,
}: MeetingsViewProps) => {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [viewing, setViewing] = useState<Meeting | null>(null);
  const [noteMeetingId, setNoteMeetingId] = useState<number | null>(null);
  const [reminderMeetingId, setReminderMeetingId] = useState<number | null>(null);
  const [recordingMeetingId, setRecordingMeetingId] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [rsvpMeetingId, setRsvpMeetingId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [selectedDateForDay, setSelectedDateForDay] = useState<string | null>(null);
  const [scheduleTimes, setScheduleTimes] = useState<{ start: string; end: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOrganizer, setFilterOrganizer] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterTeam, setFilterTeam] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const meetingsRef = useRef<HTMLDivElement>(null);

  const nowRef = useMemo(() => new Date(), []);
  const [viewMonth, setViewMonth] = useState(() => nowRef.getMonth());
  const [viewYear, setViewYear] = useState(() => nowRef.getFullYear());
  const todayStr = `${nowRef.getFullYear()}-${String(nowRef.getMonth() + 1).padStart(2, "0")}-${String(nowRef.getDate()).padStart(2, "0")}`;

  const notesByMeeting = useMeetingStore((s) => s.notesByMeeting);
  const remindersByMeeting = useMeetingStore((s) => s.remindersByMeeting);
  const attendeesByMeeting = useMeetingStore((s) => s.attendeesByMeeting);
  const loadNotes = useMeetingStore((s) => s.loadNotes);
  const loadReminders = useMeetingStore((s) => s.loadReminders);
  const loadAttendees = useMeetingStore((s) => s.loadAttendees);
  const loadMeetings = useMeetingStore((s) => s.load);
  const createNote = useMeetingStore((s) => s.createNote);
  const deleteNote = useMeetingStore((s) => s.deleteNote);
  const setReminder = useMeetingStore((s) => s.setReminder);
  const deleteReminder = useMeetingStore((s) => s.deleteReminder);
  const updateRecording = useMeetingStore((s) => s.updateRecording);
  const updateCalendar = useMeetingStore((s) => s.updateCalendar);
  const updateAttendeeRsvp = useMeetingStore((s) => s.updateAttendeeRsvp);
  const addAttendee = useMeetingStore((s) => s.addAttendee);

  const meetingsByDate = useMemo(() => {
    const map: Record<string, Meeting[]> = {};
    for (const m of meetings) {
      if (!map[m.meeting_date]) map[m.meeting_date] = [];
      map[m.meeting_date].push(m);
    }
    return map;
  }, [meetings]);

  const meetingsByMonth = useMemo(() => {
    const map: Record<number, Meeting[]> = {};
    for (const m of meetings) {
      const d = new Date(m.meeting_date + "T00:00:00");
      const key = d.getFullYear() * 12 + d.getMonth();
      if (!map[key]) map[key] = [];
      map[key].push(m);
    }
    return map;
  }, [meetings]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const days: { date: Date; dateStr: string; isCurrentMonth: boolean; isToday: boolean }[] = [];

    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth - 1, daysInPrevMonth - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: ds === todayStr });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(viewYear, viewMonth, i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ date: d, dateStr: ds, isCurrentMonth: true, isToday: ds === todayStr });
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(viewYear, viewMonth + 1, i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: ds === todayStr });
    }

    return days;
  }, [viewMonth, viewYear, todayStr]);

  const upcomingMeetings = useMemo(() => {
    const cutoff = new Date(todayStr);
    cutoff.setDate(cutoff.getDate() + 30);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    let filtered = meetings
      .filter((m) => m.meeting_date >= todayStr && m.meeting_date <= cutoffStr);

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((m) =>
        m.title.toLowerCase().includes(q) ||
        (m.description || "").toLowerCase().includes(q) ||
        `${m.organizer_first_name || ""} ${m.organizer_last_name || ""}`.toLowerCase().includes(q) ||
        m.meeting_date.includes(q) ||
        m.start_time.includes(q),
      );
    }

    return filtered.sort((a, b) => {
      if (a.meeting_date !== b.meeting_date) return a.meeting_date.localeCompare(b.meeting_date);
      return a.start_time.localeCompare(b.start_time);
    });
  }, [meetings, todayStr, searchQuery]);

  const goToToday = () => {
    const now = new Date();
    setViewMonth(now.getMonth());
    setViewYear(now.getFullYear());
    setSelectedDateForDay(todayStr);
  };

  const toggleFullscreen = useCallback(async () => {
    const el = meetingsRef.current;
    if (!el) return;
    const doc = document as any;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      const request = el.requestFullscreen || (el as any).webkitRequestFullscreen;
      if (request) {
        await request.call(el);
      }
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) {
        await exit.call(document);
      }
    }
  }, []);

  useEffect(() => {
    const onFSChange = () => {
      const doc = document as any;
      const isFS = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      setIsFullscreen(isFS);
    };
    document.addEventListener("fullscreenchange", onFSChange);
    document.addEventListener("webkitfullscreenchange", onFSChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFSChange);
      document.removeEventListener("webkitfullscreenchange", onFSChange);
    };
  }, []);

  const weekDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const days: { date: Date; dateStr: string; isCurrentMonth: boolean; isToday: boolean }[] = [];

    const startOffset = startWeekday === 0 ? 6 : startWeekday - 1;
    for (let i = startOffset; i > 0; i--) {
      const d = new Date(viewYear, viewMonth - 1, daysInPrevMonth - i + 1);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: ds === todayStr });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(viewYear, viewMonth, i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ date: d, dateStr: ds, isCurrentMonth: true, isToday: ds === todayStr });
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(viewYear, viewMonth + 1, i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push({ date: d, dateStr: ds, isCurrentMonth: false, isToday: ds === todayStr });
    }

    return days;
  }, [viewMonth, viewYear, todayStr]);

  const goToPrevWeek = () => {
    const base = selectedDateForDay ? new Date(selectedDateForDay + "T00:00:00") : new Date(todayStr + "T00:00:00");
    base.setDate(base.getDate() - 7);
    const ds = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    setSelectedDateForDay(ds);
  };

  const goToNextWeek = () => {
    const base = selectedDateForDay ? new Date(selectedDateForDay + "T00:00:00") : new Date(todayStr + "T00:00:00");
    base.setDate(base.getDate() + 7);
    const ds = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    setSelectedDateForDay(ds);
  };

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const goToPrevYear = () => setViewYear((y) => y - 1);
  const goToNextYear = () => setViewYear((y) => y + 1);

  const weekViewDays = useMemo(() => {
    const current = selectedDateForDay ? new Date(selectedDateForDay + "T00:00:00") : new Date(todayStr + "T00:00:00");
    const dayOfWeek = current.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const start = new Date(current);
    start.setDate(start.getDate() - diff);

    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { date: d, dateStr: ds, isToday: ds === todayStr };
    });
  }, [selectedDateForDay, todayStr]);

  const dayViewDate = useMemo(() => {
    const current = selectedDateForDay ? new Date(selectedDateForDay + "T00:00:00") : new Date(todayStr + "T00:00:00");
    const ds = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
    return { date: current, dateStr: ds, isToday: ds === todayStr };
  }, [selectedDateForDay, todayStr]);

  const toolbarTitle = useMemo(() => {
    if (viewMode === "year") {
      return `${viewYear}`;
    }
    if (viewMode === "week") {
      const start = weekViewDays[0];
      const end = weekViewDays[6];
      const s = `${MONTH_NAMES[start.date.getMonth()].slice(0, 3)} ${start.date.getDate()}`;
      const e = `${MONTH_NAMES[end.date.getMonth()].slice(0, 3)} ${end.date.getDate()}`;
      if (start.date.getFullYear() === end.date.getFullYear()) {
        if (start.date.getMonth() === end.date.getMonth()) {
          return `${MONTH_NAMES[start.date.getMonth()]} ${start.date.getDate()} – ${end.date.getDate()}, ${start.date.getFullYear()}`;
        }
        return `${s} – ${e}, ${start.date.getFullYear()}`;
      }
      return `${s} – ${e}`;
    }
    return `${MONTH_NAMES[viewMonth]} ${viewYear}`;
  }, [viewMode, viewMonth, viewYear, weekViewDays]);

  const toolbarNav = useMemo(() => {
    if (viewMode === "year") {
      return (
        <>
          <button className="nav-arrow" onClick={goToPrevYear} aria-label="Previous year">
            <Icon name="chevron-left" size={15} />
          </button>
          <button className="today-btn" onClick={goToToday}>Today</button>
          <button className="nav-arrow" onClick={goToNextYear} aria-label="Next year">
            <Icon name="chevron-right" size={15} />
          </button>
        </>
      );
    }
    if (viewMode === "week") {
      return (
        <>
          <button className="nav-arrow" onClick={goToPrevWeek} aria-label="Previous week">
            <Icon name="chevron-left" size={15} />
          </button>
          <button className="today-btn" onClick={goToToday}>Today</button>
          <button className="nav-arrow" onClick={goToNextWeek} aria-label="Next week">
            <Icon name="chevron-right" size={15} />
          </button>
        </>
      );
    }
    return (
      <>
        <button className="nav-arrow" onClick={goToPrevMonth} aria-label="Previous month">
          <Icon name="chevron-left" size={15} />
        </button>
        <button className="today-btn" onClick={goToToday}>Today</button>
        <button className="nav-arrow" onClick={goToNextMonth} aria-label="Next month">
          <Icon name="chevron-right" size={15} />
        </button>
      </>
    );
  }, [viewMode, goToToday, goToPrevWeek, goToNextWeek, goToPrevMonth, goToNextMonth, goToPrevYear, goToNextYear]);

  const agendaGroups = useMemo(() => {
    const sorted = meetings
      .filter((m) => m.meeting_date >= todayStr)
      .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date) || a.start_time.localeCompare(b.start_time))
      .slice(0, 100);

    const groups: { date: string; weekday: string; dateLabel: string; isToday: boolean; meetings: Meeting[] }[] = [];
    for (const m of sorted) {
      let group = groups.find((g) => g.date === m.meeting_date);
      if (!group) {
        const d = new Date(`${m.meeting_date}T00:00:00`);
        group = {
          date: m.meeting_date,
          weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
          dateLabel: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
          isToday: m.meeting_date === todayStr,
          meetings: [],
        };
        groups.push(group);
      }
      group.meetings.push(m);
    }
    return groups;
  }, [meetings, todayStr]);

  const openScheduleModal = (date: string | null, times?: { start: string; end: string } | null) => {
    setSelectedDate(date);
    setScheduleTimes(times || null);
    setShowCreate(true);
  };

  const handleDayClick = (dateStr: string) => {
    openScheduleModal(dateStr);
  };

  const handleSlotClick = (dateStr: string, hour: number) => {
    if (!canSchedule) return;
    openScheduleModal(dateStr, {
      start: `${String(hour).padStart(2, "0")}:00`,
      end: `${String((hour + 1) % 24).padStart(2, "0")}:00`,
    });
  };

  const shiftDay = (delta: number) => {
    const next = new Date(dayViewDate.date);
    next.setDate(next.getDate() + delta);
    const ds = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    setSelectedDateForDay(ds);
  };

  const handleAddToCalendar = async (meeting: Meeting, provider: "google" | "outlook" | "ical") => {
    await updateCalendar(meeting.id, `evt-${meeting.id}`, provider);
    if (provider === "ical") {
      const token = localStorage.getItem("kneachat_token");
      const res = await fetch(`/api/meetings/${meeting.id}/ics`, {
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `meeting-${meeting.id}.ics`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    }
  };

  const toggleExpand = (id: number) => {
    setEditing((prev) => (prev && prev.id === id ? null : meetings.find((m) => m.id === id) || null));
    loadNotes(id);
    loadReminders(id);
    loadAttendees(id);
  };

  const handleViewDetails = (meeting: Meeting) => {
    setViewing(meeting);
    loadAttendees(meeting.id);
  };

  const handleRsvp = async (meetingId: number, status: 'accepted' | 'declined' | 'maybe') => {
    await updateAttendeeRsvp(meetingId, status);
    setRsvpMeetingId(null);
  };

  const handleStartVoice = (meeting: Meeting) => {
    onStartCall({
      type: "voice",
      targetId: meeting.id,
      targetType: "conversation",
      name: meeting.title,
      isGroup: true,
      conversationId: meeting.id,
    });
  };

  const handleStartVideo = (meeting: Meeting) => {
    onStartCall({
      type: "video",
      targetId: meeting.id,
      targetType: "conversation",
      name: meeting.title,
      isGroup: true,
      conversationId: meeting.id,
    });
  };

  const handleAddNote = async (content: string) => {
    if (!noteMeetingId) return;
    await createNote(noteMeetingId, content);
    setNoteMeetingId(null);
  };

  const handleSetReminder = async (remindAt: string) => {
    if (!reminderMeetingId) return;
    await setReminder(reminderMeetingId, remindAt);
    setReminderMeetingId(null);
  };

  const handleStartRecording = async (meeting: Meeting) => {
    await updateRecording(meeting.id, "recording");
    setRecordingMeetingId(null);
  };

  const handleStopRecording = async (meeting: Meeting) => {
    await updateRecording(meeting.id, "processed", "recording.mp4");
    setRecordingMeetingId(null);
  };

  const getCurrentUserRsvp = (meeting: Meeting): 'pending' | 'accepted' | 'declined' | 'maybe' | undefined => {
    const attendees = attendeesByMeeting[meeting.id] || [];
    const me = attendees.find((a) => a.user_id === currentUserId);
    return me?.rsvp_status;
  };

  useEffect(() => {
    loadMeetings({
      search: searchQuery || undefined,
      organizer_id: filterOrganizer ? Number(filterOrganizer) : undefined,
      department_id: filterDepartment ? Number(filterDepartment) : undefined,
      team_id: filterTeam ? Number(filterTeam) : undefined,
      status: filterStatus || undefined,
    });
  }, [searchQuery, filterOrganizer, filterDepartment, filterTeam, filterStatus]);

  return (
    <div className={`meetings-view${isFullscreen ? " meetings-fullscreen" : ""}`} ref={meetingsRef}>
      <div className="meetings-shell">
        <div className="meetings-toolbar">
          <div className="meetings-toolbar-top">
            <div className="meetings-toolbar-left">
              <div className="meetings-toolbar-nav" role="group" aria-label="Calendar navigation">
                {toolbarNav}
              </div>
              <h2 className="meetings-toolbar-title">{toolbarTitle}</h2>
            </div>
            <div className="meetings-toolbar-actions">
              <div className="meetings-view-tabs" role="tablist" aria-label="Calendar view">
                {(["year", "month", "week", "day", "agenda"] as CalendarViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    role="tab"
                    aria-selected={viewMode === mode}
                    className={`meetings-view-tab ${viewMode === mode ? "active" : ""}`}
                    onClick={() => setViewMode(mode)}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              {canSchedule && (
                <button className="btn-primary" onClick={() => openScheduleModal(null)}>
                  <Icon name="plus" size={14} /> Schedule Meeting
                </button>
              )}
              <button
                className={`btn-secondary ${isFullscreen ? "active" : ""}`}
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
                title={isFullscreen ? "Exit full screen" : "Enter full screen"}
              >
                <Icon name={isFullscreen ? "chevron-down" : "screen"} size={14} />
                {isFullscreen ? "Exit" : "Full screen"}
              </button>
            </div>
            {viewMode === "year" && (
              <div className="year-view">
                {Array.from({ length: 12 }).map((_, i) => {
                  const key = viewYear * 12 + i;
                  const monthMeetings = meetingsByMonth[key] || [];
                  const monthName = MONTH_NAMES[i];
                  const isCurrentMonth = viewYear === nowRef.getFullYear() && i === nowRef.getMonth();
                  const firstDay = new Date(viewYear, i, 1);
                  const startWeekday = firstDay.getDay();
                  const daysInMonth = new Date(viewYear, i + 1, 0).getDate();
                  const daysInPrevMonth = new Date(viewYear, i, 0).getDate();

                  const cells: { day: number; isCurrentMonth: boolean; isToday: boolean; dateStr: string }[] = [];

                  for (let d = startWeekday - 1; d >= 0; d--) {
                    const dayNum = daysInPrevMonth - d;
                    const m = i === 0 ? 11 : i - 1;
                    const y = i === 0 ? viewYear - 1 : viewYear;
                    const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
                    cells.push({ day: dayNum, isCurrentMonth: false, isToday: false, dateStr: ds });
                  }

                  for (let d = 1; d <= daysInMonth; d++) {
                    const ds = `${viewYear}-${String(i + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    cells.push({ day: d, isCurrentMonth: true, isToday: ds === todayStr, dateStr: ds });
                  }

                  const remaining = (7 - (cells.length % 7)) % 7;
                  for (let d = 1; d <= remaining; d++) {
                    const m = i === 11 ? 0 : i + 1;
                    const y = i === 11 ? viewYear + 1 : viewYear;
                    const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    cells.push({ day: d, isCurrentMonth: false, isToday: false, dateStr: ds });
                  }

                  return (
                    <div
                      key={i}
                      className={`year-month${isCurrentMonth ? " current-month" : ""}`}
                      onClick={() => {
                        setViewMonth(i);
                        setViewMode("month");
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setViewMonth(i);
                          setViewMode("month");
                        }
                      }}
                    >
                      <div className="year-month-header">
                        <span className="year-month-name">{monthName}</span>
                        {monthMeetings.length > 0 && (
                          <span className="year-month-count">{monthMeetings.length}</span>
                        )}
                      </div>
                      <div className="year-month-weekdays">
                        {["S", "M", "T", "W", "T", "F", "S"].map((w, idx) => (
                          <span key={idx}>{w}</span>
                        ))}
                      </div>
                      <div className="year-month-grid">
                        {cells.map((cell, idx) => {
                          const hasMeeting = meetingsByDate[cell.dateStr]?.length > 0;
                          return (
                            <button
                              key={idx}
                              className={`year-month-day${!cell.isCurrentMonth ? " other" : ""}${cell.isToday ? " today" : ""}${hasMeeting ? " has-meeting" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDayClick(cell.dateStr);
                              }}
                              title={hasMeeting ? `${meetingsByDate[cell.dateStr].length} meeting(s)` : undefined}
                            >
                              {cell.day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="meetings-toolbar-bottom">
            <div className="meetings-toolbar-controls">
              <div className="meetings-search">
                <Icon name="search" size={14} />
                <input
                  type="text"
                  placeholder="Search meetings..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search meetings"
                />
              </div>
              <div className="meetings-filters">
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Filter by status">
                  <option value="">All statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <select value={filterOrganizer} onChange={(e) => setFilterOrganizer(e.target.value)} aria-label="Filter by organizer">
                  <option value="">All organizers</option>
                  {(users || []).map((u) => (
                    <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
                  ))}
                </select>
                <select value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)} aria-label="Filter by department">
                  <option value="">All departments</option>
                  {(departments || []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} aria-label="Filter by team">
                  <option value="">All teams</option>
                  {(teams || []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="meetings-body">
          <div className="meetings-calendar">
            {viewMode === "month" && (
              <>
                <div className="calendar-weekdays">
                  {WEEKDAY_NAMES.map((w) => (
                    <div key={w} className="calendar-weekday">{w}</div>
                  ))}
                </div>
                <div className="calendar-grid">
                  {calendarDays.map((day) => {
                    const dayMeetings = meetingsByDate[day.dateStr] || [];
                    const scheduledMeetings = dayMeetings.filter((m) => m.status === "scheduled");
                    const pastMeetings = dayMeetings.filter((m) => m.status !== "scheduled");
                    const displayMeetings = scheduledMeetings.slice(0, 3);
                    const hasMore = scheduledMeetings.length > 3;

                    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;

                    return (
                      <div
                        key={day.dateStr}
                        className={`calendar-day${!day.isCurrentMonth ? " other-month" : ""}${day.isToday ? " today" : ""}${isWeekend ? " weekend" : ""}`}
                        onClick={() => handleDayClick(day.dateStr)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleDayClick(day.dateStr); }}
                      >
                        {canSchedule && (
                          <button
                            className="calendar-day-add"
                            title="Schedule meeting on this day"
                            aria-label={`Schedule meeting on ${day.dateStr}`}
                            onClick={(e) => { e.stopPropagation(); handleDayClick(day.dateStr); }}
                          >
                            <Icon name="plus" size={12} />
                          </button>
                        )}
                        <div className="calendar-day-number">{day.date.getDate()}</div>
                        <div className="calendar-day-events">
                          {displayMeetings.map((m) => (
                            <div
                              key={m.id}
                              className={`calendar-event-chip status-${m.status}`}
                              title={`${m.start_time} - ${m.end_time}: ${m.title}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleViewDetails(m)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleViewDetails(m);
                                }
                              }}
                            >
                              <span className="calendar-event-chip-time">{m.start_time}</span>
                              <span className="calendar-event-chip-title">{m.title}</span>
                            </div>
                          ))}
                          {hasMore && (
                            <div className="calendar-more">+{scheduledMeetings.length - 3} more</div>
                          )}
                          {pastMeetings.length > 0 && (
                            <div
                              className={`calendar-event-chip status-${pastMeetings[0].status} past`}
                              title="Past meeting"
                              role="button"
                              tabIndex={0}
                              onClick={() => handleViewDetails(pastMeetings[0])}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleViewDetails(pastMeetings[0]);
                                }
                              }}
                            >
                              <span className="calendar-event-chip-title">
                                {pastMeetings[0].title}
                                {pastMeetings.length > 1 && ` +${pastMeetings.length - 1}`}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {viewMode === "week" && (
              <WeekGridView
                weekDays={weekViewDays}
                meetings={meetings}
                currentUserId={currentUserId}
                selectedDateForDay={selectedDateForDay}
                onSelectDateForDay={setSelectedDateForDay}
                onDayClick={handleDayClick}
                onViewDetails={handleViewDetails}
              />
            )}

            {viewMode === "day" && (
              <DayGridView
                date={dayViewDate.date}
                dateStr={dayViewDate.dateStr}
                isToday={dayViewDate.isToday}
                meetings={meetingsByDate[dayViewDate.dateStr] || []}
                canSchedule={canSchedule}
                onPrevDay={() => shiftDay(-1)}
                onNextDay={() => shiftDay(1)}
                onSlotClick={handleSlotClick}
                onViewDetails={handleViewDetails}
              />
            )}

            {viewMode === "agenda" && (
              <div className="agenda-view">
                {agendaGroups.length === 0 ? (
                  <div className="upcoming-empty">
                    <Icon name="calendar" size={32} />
                    <p>No upcoming meetings.</p>
                    {canSchedule && (
                      <button className="btn-primary upcoming-empty-btn" onClick={() => openScheduleModal(null)}>
                        <Icon name="plus" size={14} /> Schedule Meeting
                      </button>
                    )}
                  </div>
                ) : (
                  agendaGroups.map((group) => (
                    <div key={group.date} className="agenda-group">
                      <div className="agenda-group-header">
                        <span className="agenda-group-weekday">{group.weekday}</span>
                        <span className="agenda-group-date">{group.dateLabel}</span>
                        {group.isToday && <span className="agenda-today-chip">Today</span>}
                        <span className="agenda-group-count">
                          {group.meetings.length} {group.meetings.length === 1 ? "meeting" : "meetings"}
                        </span>
                      </div>
                      <div className="agenda-list">
                        {group.meetings.map((m) => {
                          const organizer = [m.organizer_first_name, m.organizer_last_name].filter(Boolean).join(" ");
                          return (
                            <div key={m.id} className="agenda-item" onClick={() => handleViewDetails(m)}>
                              <div className="agenda-item-time">
                                <span className="agenda-item-time-start">{formatTime12(m.start_time)}</span>
                                <span className="agenda-item-time-end">{formatTime12(m.end_time)}</span>
                              </div>
                              <div className="agenda-item-content">
                                <p className="agenda-item-title">{m.title}</p>
                                <div className="agenda-item-meta">
                                  <span>{formatDuration(m.start_time, m.end_time)}</span>
                                  {organizer && <span>Organized by {organizer}</span>}
                                  <span className={`rsvp-badge rsvp-${getCurrentUserRsvp(m) || "pending"}`}>
                                    {getCurrentUserRsvp(m) || "pending"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="meetings-sidebar">
            <div className="sidebar-section">
              <h3 className="sidebar-section-title">Upcoming</h3>
              {upcomingMeetings.length === 0 ? (
                <div className="upcoming-empty">
                  <Icon name="calendar" size={32} />
                  <p>No upcoming meetings in the next 30 days.</p>
                  {canSchedule && (
                    <button className="btn-primary upcoming-empty-btn" onClick={() => openScheduleModal(null)}>
                      <Icon name="plus" size={14} /> Schedule Meeting
                    </button>
                  )}
                </div>
              ) : (
                <div className="upcoming-list">
                  {upcomingMeetings.slice(0, 20).map((m) => (
                    <div key={m.id} className={`upcoming-item status-${m.status}`} onClick={() => handleViewDetails(m)}>
                      <p className="upcoming-item-title">{m.title}</p>
                      <div className="upcoming-item-meta">
                        <span className="upcoming-item-date">{formatDateWithTimezone(m.meeting_date)}</span>
                        <span className="upcoming-item-time">{formatMeetingTime(m.meeting_date, m.start_time, m.end_time)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="sidebar-section">
              <h3 className="sidebar-section-title">Quick actions</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {canSchedule && (
                  <button className="btn-primary" onClick={() => openScheduleModal(null)}>
                    <Icon name="plus" size={14} /> New meeting
                  </button>
                )}
                <button className="btn-secondary" onClick={goToToday}>Jump to today</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateMeetingModal
          users={[]}
          currentUserId={currentUserId}
          selectedDate={selectedDate}
          initialStartTime={scheduleTimes?.start}
          initialEndTime={scheduleTimes?.end}
          onClose={() => { setShowCreate(false); setSelectedDate(null); setScheduleTimes(null); }}
          onSubmit={async (data) => {
            const result = await onCreate(data);
            setShowCreate(false);
            setSelectedDate(null);
            setScheduleTimes(null);
            return result;
          }}
        />
      )}
      {editing && (
        <CreateMeetingModal
          meeting={editing}
          users={users || []}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            const result = await onUpdate(editing.id, data);
            setEditing(null);
            return result;
          }}
        />
      )}
      {noteMeetingId && (
        <MeetingNoteModal
          onClose={() => setNoteMeetingId(null)}
          onSubmit={handleAddNote}
        />
      )}
      {reminderMeetingId && (
        <MeetingReminderModal
          onClose={() => setReminderMeetingId(null)}
          onSubmit={handleSetReminder}
        />
      )}
      {recordingMeetingId && (
        <Modal onClose={() => setRecordingMeetingId(null)} title="Recording">
          <div className="modal-actions">
            <button onClick={() => {
              const meeting = meetings.find((m) => m.id === recordingMeetingId);
              if (meeting && meeting.recording_status === "recording") {
                handleStopRecording(meeting);
              } else if (meeting) {
                handleStartRecording(meeting);
              }
            }}>
              {meetings.find((m) => m.id === recordingMeetingId)?.recording_status === "recording" ? "Stop Recording" : "Start Recording"}
            </button>
            <button onClick={() => setRecordingMeetingId(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {rsvpMeetingId && (
        <Modal onClose={() => setRsvpMeetingId(null)} title="Respond to Invitation">
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => handleRsvp(rsvpMeetingId, "accepted")}>Accept</button>
            <button className="btn-secondary" onClick={() => handleRsvp(rsvpMeetingId, "maybe")}>Maybe</button>
            <button className="btn-secondary" style={{ color: 'red' }} onClick={() => handleRsvp(rsvpMeetingId, "declined")}>Decline</button>
          </div>
        </Modal>
      )}
      {viewing && (
        <Modal onClose={() => setViewing(null)} title={viewing.title}>
          <div className="meeting-detail">
            <div className="meeting-detail-header">
              <span className={`status-pill ${viewing.status}`}>{viewing.status}</span>
            </div>

            <div className="meeting-detail-section">
              <div className="meeting-detail-row">
                <span className="meeting-detail-icon">
                  <Icon name="calendar" size={16} />
                </span>
                <div>
                  <div className="meeting-detail-label">Date</div>
                  <div className="meeting-detail-value">{formatDateWithTimezone(viewing.meeting_date)}</div>
                </div>
              </div>
              <div className="meeting-detail-row">
                <span className="meeting-detail-icon">
                  <Icon name="clock" size={16} />
                </span>
                <div>
                  <div className="meeting-detail-label">Time</div>
                  <div className="meeting-detail-value">
                    {formatMeetingTime(viewing.meeting_date, viewing.start_time, viewing.end_time)}
                  </div>
                </div>
              </div>
              <div className="meeting-detail-row">
                <span className="meeting-detail-icon">
                  <Icon name="user" size={16} />
                </span>
                <div>
                  <div className="meeting-detail-label">Organizer</div>
                  <div className="meeting-detail-value">
                    {viewing.organizer_first_name} {viewing.organizer_last_name}
                  </div>
                </div>
              </div>
            </div>

            {viewing.description && (
              <div className="meeting-detail-section">
                <div className="meeting-detail-label">Description</div>
                <p className="meeting-detail-desc">{viewing.description}</p>
              </div>
            )}

            {viewing.meeting_link && (
              <div className="meeting-detail-section">
                <div className="meeting-detail-label">Meeting Link</div>
                <a
                  href={viewing.meeting_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="meeting-detail-link"
                >
                  <Icon name="video" size={14} />
                  {viewing.meeting_link}
                </a>
              </div>
            )}

            <div className="meeting-detail-section">
              <div className="meeting-detail-label">Participants</div>
              <div className="meeting-detail-chips">
                {(viewing.participants || []).map((pid) => {
                  const u = users?.find((u) => u.id === pid);
                  const name = u
                    ? `${u.first_name || ''} ${u.last_name || ''}`.trim() || `User ${pid}`
                    : `User ${pid}`;
                  return (
                    <span key={pid} className="participant-chip">
                      {name}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="meeting-detail-section">
              <div className="meeting-detail-label">Attendees</div>
              <div className="meeting-detail-attendees">
                {(attendeesByMeeting[viewing.id] || []).map((a) => (
                  <div key={a.id} className="attendee-row">
                    <Avatar
                      person={{
                        id: a.user_id,
                        first_name: a.user_first_name || undefined,
                        last_name: a.user_last_name || undefined,
                      }}
                      className="small"
                    />
                    <span className="attendee-name">
                      {a.user_first_name} {a.user_last_name}
                    </span>
                    <span className={`rsvp-badge rsvp-${a.rsvp_status}`}>{a.rsvp_status}</span>
                  </div>
                ))}
              </div>
            </div>

            {(canSchedule || viewing.organizer_id === currentUserId || viewing.participants.includes(currentUserId)) && (
              <div className="modal-actions">
                {(canSchedule || viewing.organizer_id === currentUserId) && (
                  <button className="btn-secondary" onClick={() => { setViewing(null); setEditing(viewing); }}>
                    Edit Meeting
                  </button>
                )}
                {viewing.participants.includes(currentUserId) && viewing.status === "scheduled" && (
                  <button className="btn-primary" onClick={() => { setViewing(null); setRsvpMeetingId(viewing.id); }}>
                    Respond to Invitation
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default MeetingsView;
