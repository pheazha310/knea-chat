// SearchView — workspace-wide search (SRS US-17 / FR-16).
//
// One query box searches across Messages, People, Teams, Channels, Files,
// Meetings and Tasks. The initial result page shows a grouped overview (top
// hits per scope with totals); clicking a scope tab (or "See all") expands
// the full paginated list for that scope. Filters — Person, Team,
// Department, File type, Message type and a Date range — narrow every scope
// where they make sense.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import Avatar from '../common/Avatar';
import type { AppView } from '../layout/Sidebar';
import { API_BASE_URL } from '../../services/api';
import { SearchModel } from '../../models';
import type {
  Channel,
  Department,
  GlobalSearchFilters,
  GlobalSearchOverview,
  MessageSearchResult,
  SearchGroup,
  SearchScope,
  Task,
  Team,
  User,
} from '../../models';

interface SearchViewProps {
  currentUserId?: number | null;
  users: User[];
  teams: Team[];
  channels: Channel[];
  departments: Department[];
  /** Open a conversation found in message results. */
  onOpenConversation: (conversationId: number) => void;
  /** Open (or create) the direct conversation with a person. */
  onOpenDirect: (user: User) => void;
  onOpenChannel: (channel: Channel) => void;
  onOpenTeam: (team: Team) => void;
  /** Route to the entity's own view (Meetings / Tasks / Files). */
  onGoToView: (view: AppView) => void;
}

const SCOPE_META: Record<SearchScope, { label: string; icon: IconName }> = {
  messages: { label: 'Messages', icon: 'message' },
  people: { label: 'People', icon: 'user' },
  teams: { label: 'Teams', icon: 'grid' },
  channels: { label: 'Channels', icon: 'hash' },
  files: { label: 'Files', icon: 'file' },
  meetings: { label: 'Meetings', icon: 'calendar' },
  tasks: { label: 'Tasks', icon: 'check-circle' },
};

/** Scope order on the overview page and the tab bar. */
const SCOPE_ORDER: SearchScope[] = ['messages', 'people', 'teams', 'channels', 'files', 'meetings', 'tasks'];

const FILE_TYPE_OPTIONS = [
  { value: '', label: 'Any file type' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'word', label: 'Word documents' },
  { value: 'excel', label: 'Spreadsheets' },
  { value: 'powerpoint', label: 'Presentations' },
  { value: 'archive', label: 'Archives' },
  { value: 'text', label: 'Text files' },
];

const MESSAGE_TYPE_OPTIONS = [
  { value: '', label: 'Any message type' },
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Images' },
  { value: 'file', label: 'Files' },
  { value: 'voice', label: 'Voice notes' },
];

const personName = (first?: string | null, last?: string | null, email?: string | null) =>
  [first, last].filter(Boolean).join(' ').trim() || email || 'Someone';

const formatWhen = (value?: string | null, withTime = true) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
    (withTime ? ` · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '');
};

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatBytes = (bytes?: number | null) => {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const resolveFileUrl = (fileUrl: string) => {
  if (/^https?:\/\//.test(fileUrl)) return fileUrl;
  return `${API_BASE_URL.replace(/\/api$/, '')}${fileUrl}`;
};

/** Case-insensitive <mark> highlighter around every query occurrence. */
const Highlight = ({ text, query }: { text: string; query: string }) => {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </>
  );
};

const SearchView = ({
  currentUserId,
  users,
  teams,
  channels,
  departments,
  onOpenConversation,
  onOpenDirect,
  onOpenChannel,
  onOpenTeam,
  onGoToView,
}: SearchViewProps) => {
  const [q, setQ] = useState('');
  const [personId, setPersonId] = useState<number | ''>('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [fileType, setFileType] = useState('');
  const [messageType, setMessageType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GlobalSearchOverview>({});
  const [ranSearch, setRanSearch] = useState(false);

  /** Which scope's full list is open (null = grouped overview). */
  const [scopeView, setScopeView] = useState<SearchScope | null>(null);
  const [scopeData, setScopeData] = useState<SearchGroup<unknown> | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  /** Filters with empty values dropped — sent to the server. */
  const filters = useMemo<GlobalSearchFilters>(() => {
    const f: GlobalSearchFilters = { q: q.trim() || undefined };
    if (personId !== '') f.person_id = Number(personId);
    if (teamId !== '') f.team_id = Number(teamId);
    if (departmentId !== '') f.department_id = Number(departmentId);
    if (fileType) f.file_type = fileType;
    if (messageType) f.message_type = messageType as GlobalSearchFilters['message_type'];
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    return f;
  }, [q, personId, teamId, departmentId, fileType, messageType, dateFrom, dateTo]);

  const hasCriteria = useMemo(
    () =>
      !!(filters.q || filters.person_id || filters.team_id || filters.department_id ||
        filters.file_type || filters.message_type || filters.date_from || filters.date_to),
    [filters],
  );

  const queryKey = useMemo(
    () => JSON.stringify(filters),
    [filters],
  );

  const runOverview = async () => {
    if (!hasCriteria) {
      setGroups({});
      setRanSearch(false);
      return;
    }
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await SearchModel.global(filters);
      if (id !== runId.current) return; // superseded
      setGroups(res.data.data?.groups || {});
      setRanSearch(true);
    } catch {
      if (id !== runId.current) return;
      setGroups({});
      setError('Search failed — please try again.');
      setRanSearch(true);
    } finally {
      if (id === runId.current) setLoading(false);
    }
  };

  const runScope = async (scope: SearchScope, page = 1) => {
    const id = ++runId.current;
    setScopeLoading(true);
    setError(null);
    try {
      const res = await SearchModel.globalScope(scope, { ...filters, page, limit: 20 } as GlobalSearchFilters & { page?: number });
      if (id !== runId.current) return;
      const result = res.data.data?.result as SearchGroup<unknown> | undefined;
      if (!result) return;
      setScopeData((prev) =>
        page === 1 || !prev ? result : { ...result, items: [...prev.items, ...result.items] },
      );
    } catch {
      if (id !== runId.current) return;
      setError(`Could not load more ${SCOPE_META[scope].label.toLowerCase()} — please try again.`);
    } finally {
      if (id === runId.current) setScopeLoading(false);
    }
  };

  // Debounced search: any change to the query or a filter re-runs the
  // overview (or the currently open scope's first page).
  useEffect(() => {
    if (!hasCriteria) {
      setGroups({});
      setRanSearch(false);
      setScopeData(null);
      setScopeView(null);
      return;
    }
    const timer = window.setTimeout(() => {
      if (scopeView) runScope(scopeView, 1);
      else runOverview();
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, scopeView]);

  // Focus the box when the view mounts (⌘K / sidebar navigation).
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  const clearAll = () => {
    setQ('');
    setPersonId('');
    setTeamId('');
    setDepartmentId('');
    setFileType('');
    setMessageType('');
    setDateFrom('');
    setDateTo('');
    setScopeView(null);
    setScopeData(null);
    setRanSearch(false);
    inputRef.current?.focus();
  };

  const activeFiltersCount =
    (personId !== '' ? 1 : 0) + (teamId !== '' ? 1 : 0) + (departmentId !== '' ? 1 : 0) +
    (fileType ? 1 : 0) + (messageType ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);

  const selectableTeams = teams;
  const otherPeople = users.filter((u) => u.id !== currentUserId);

  const totalHits = useMemo(() => {
    let n = 0;
    for (const scope of SCOPE_ORDER) {
      const g = groups[scope];
      if (g && typeof g.total === 'number') n += g.total;
    }
    return n;
  }, [groups]);

  // ---------------------------------------------------------------------------
  // Item rendering per scope
  // ---------------------------------------------------------------------------

  const scopeCount = (scope: SearchScope): number => {
    const g = groups[scope];
    return g && typeof g.total === 'number' ? g.total : 0;
  };

  const renderMessageRow = (m: MessageSearchResult) => {
    const convLabel = m.conversation_type === 'channel' ? `# ${m.conversation_name || ''}`
      : m.conversation_name || 'Conversation';
    return (
      <button className="gs-row" onClick={() => onOpenConversation(m.conversation_id)}>
        <Avatar
          person={{ id: m.sender_id, first_name: m.first_name, last_name: m.last_name, profile_picture: m.profile_picture }}
          className="small"
        />
        <span className="gs-row-main">
          <span className="gs-row-title">
            <b>{personName(m.first_name, m.last_name, m.email)}</b>
            <em>{convLabel}</em>
            <time>{formatWhen(m.created_at)}</time>
          </span>
          <span className="gs-snippet">
            <Highlight text={m.content} query={q} />
          </span>
        </span>
        <Icon name="arrow-right" size={13} className="gs-row-arrow" />
      </button>
    );
  };

  const renderPersonRow = (u: User) => (
    <button className="gs-row" onClick={() => onOpenDirect(u)}>
      <Avatar person={u} className="small" showStatus />
      <span className="gs-row-main">
        <span className="gs-row-title">
          <b>{personName(u.first_name, u.last_name)}</b>
          {u.job_title && <em>{u.job_title}</em>}
        </span>
        <span className="gs-row-sub">{u.email}</span>
      </span>
      <Icon name="arrow-right" size={13} className="gs-row-arrow" />
    </button>
  );

  const renderTeamRow = (t: Team) => (
    <button className="gs-row" onClick={() => onOpenTeam(t)}>
      <span className="gs-entity-avatar"><Icon name="grid" size={15} /></span>
      <span className="gs-row-main">
        <span className="gs-row-title">
          <b><Highlight text={t.name} query={q} /></b>
          {typeof t.member_count === 'number' && <em>{t.member_count} member{t.member_count === 1 ? '' : 's'}</em>}
        </span>
        <span className="gs-row-sub">
          {t.description ? <Highlight text={t.description} query={q} /> : 'Team'}
        </span>
      </span>
      <Icon name="arrow-right" size={13} className="gs-row-arrow" />
    </button>
  );

  const renderChannelRow = (c: Channel) => (
    <button className="gs-row" onClick={() => onOpenChannel(c)}>
      <span className="gs-entity-avatar hash"><Icon name="hash" size={15} /></span>
      <span className="gs-row-main">
        <span className="gs-row-title">
          <b><Highlight text={c.name} query={q} /></b>
          {c.team_name && <em>{c.team_name}</em>}
        </span>
        <span className="gs-row-sub">
          {c.description ? <Highlight text={c.description} query={q} /> : c.type === 'private' ? 'Private channel' : 'Channel'}
        </span>
      </span>
      <Icon name="arrow-right" size={13} className="gs-row-arrow" />
    </button>
  );

  const renderFileRow = (f: any) => {
    const ext = f.file_type ? f.file_type.split('/').pop() : '';
    return (
      <a className="gs-row" href={resolveFileUrl(f.file_url)} target="_blank" rel="noopener noreferrer" title="Open file">
        <span className="gs-entity-avatar file"><Icon name="file" size={15} /></span>
        <span className="gs-row-main">
          <span className="gs-row-title">
            <b><Highlight text={f.file_name} query={q} /></b>
            <em>{[f.team_name, ext].filter(Boolean).join(' · ')}</em>
            <time>{formatWhen(f.created_at, false)}</time>
          </span>
          <span className="gs-row-sub">
            {personName(f.uploader_first_name, f.uploader_last_name, f.uploader_email)}
            {f.file_size ? ` · ${formatBytes(f.file_size)}` : ''}
          </span>
        </span>
        <Icon name="download" size={14} className="gs-row-arrow" />
      </a>
    );
  };

  const renderMeetingRow = (m: any) => {
    const organizer = personName(m.organizer_first_name, m.organizer_last_name);
    const start = typeof m.start_time === 'string' ? m.start_time.slice(0, 5) : '';
    return (
      <button className="gs-row" onClick={() => onGoToView('meetings')} title="Open in Meetings">
        <span className="gs-entity-avatar meeting"><Icon name="calendar" size={15} /></span>
        <span className="gs-row-main">
          <span className="gs-row-title">
            <b><Highlight text={m.title} query={q} /></b>
            <em>{m.status}</em>
            <time>{m.meeting_date ? formatDate(m.meeting_date) : ''}{start ? ` · ${start}` : ''}</time>
          </span>
          <span className="gs-row-sub">
            {m.description ? <Highlight text={m.description} query={q} /> : ''}
            {organizer && <span>Organized by {organizer}</span>}
          </span>
        </span>
        <Icon name="arrow-right" size={13} className="gs-row-arrow" />
      </button>
    );
  };

  const renderTaskRow = (t: Task) => (
    <button className="gs-row" onClick={() => onGoToView('tasks')} title="Open in Tasks">
      <span className="gs-entity-avatar task"><Icon name="check-circle" size={15} /></span>
      <span className="gs-row-main">
        <span className="gs-row-title">
          <b><Highlight text={t.title} query={q} /></b>
          <em className={`gs-status ${t.status}`}>{t.status.replace('_', ' ')}</em>
          {t.team_name && <em>{t.team_name}</em>}
          {t.due_date && <time>Due {formatDate(t.due_date)}</time>}
        </span>
        <span className="gs-row-sub">
          {t.description ? <Highlight text={t.description} query={q} /> : ''}
          <span>Assignee: {personName(t.assignee_first_name, t.assignee_last_name, t.assignee_email)}</span>
        </span>
      </span>
      <Icon name="arrow-right" size={13} className="gs-row-arrow" />
    </button>
  );

  const renderItem = (scope: SearchScope, item: unknown) => {
    switch (scope) {
      case 'messages': return renderMessageRow(item as MessageSearchResult);
      case 'people': return renderPersonRow(item as User);
      case 'teams': return renderTeamRow(item as Team);
      case 'channels': return renderChannelRow(item as Channel);
      case 'files': return renderFileRow(item);
      case 'meetings': return renderMeetingRow(item);
      case 'tasks': return renderTaskRow(item as Task);
    }
  };

  /** The item list shown in the active mode (scope list or overview). */
  const visibleItems = (scope: SearchScope): unknown[] => {
    if (scopeView === scope && scopeData) return scopeData.items;
    const g = groups[scope];
    return g && Array.isArray(g.items) ? g.items : [];
  };

  const visibleTotal = (scope: SearchScope): number =>
    scopeView === scope && scopeData ? scopeData.total : scopeCount(scope);

  const isActiveTab = (scope: SearchScope | null) =>
    scopeView === null ? scope === null : scopeView === scope;

  /** Opening a scope clears the previous list; the debounced effect fetches it. */
  const openScope = (scope: SearchScope) => {
    setScopeView(scope);
    setScopeData(null);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const renderScopeSection = (scope: SearchScope) => {
    const items = visibleItems(scope);
    const total = visibleTotal(scope);
    if (!scopeView && total === 0) return null;
    const shown = scopeView === scope ? items.length : Math.min(items.length, 5);
    const showAll = scopeView !== scope && total > items.length;

    return (
      <section className="gs-section" key={scope}>
        <header className="gs-section-header">
          <span className={`gs-scope-icon ${scope}`}>
            <Icon name={SCOPE_META[scope].icon} size={14} />
          </span>
          <h3>{SCOPE_META[scope].label}</h3>
          <span className="gs-count">{total}</span>
          {scopeView !== scope && total > 0 && (
            <button className="gs-link" onClick={() => openScope(scope)}>
              See all <Icon name="chevron-right" size={11} />
            </button>
          )}
          {scopeView === scope && (
            <button className="gs-link" onClick={() => { setScopeView(null); setScopeData(null); }}>
              Back to all results
            </button>
          )}
        </header>
        {items.length === 0 && scopeView === scope && (
          <div className="gs-empty">
            {scopeLoading || !scopeData ? 'Loading…' : 'No results in this category'}
          </div>
        )}
        {shown > 0 && (
          <div className="gs-list">{items.slice(0, shown).map((item, i) => (
            <React.Fragment key={i}>{renderItem(scope, item)}</React.Fragment>
          ))}</div>
        )}
        {showAll && (
          <button className="gs-more" onClick={() => openScope(scope)}>
            Show all {total} {SCOPE_META[scope].label.toLowerCase()}
          </button>
        )}
        {scopeView === scope && scopeData && scopeData.items.length < total && (
          <button className="gs-more" disabled={scopeLoading} onClick={() => runScope(scope, scopeData.page + 1)}>
            {scopeLoading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>
    );
  };

  return (
    <div className="view-page gs-view">
      <div className="view-header">
        <div>
          <h1>Search</h1>
          <p>Find anything across the workspace — messages, people, teams, channels, files, meetings and tasks.</p>
        </div>
      </div>

      <form
        className="gs-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (hasCriteria) {
            if (scopeView) runScope(scopeView, 1);
            else runOverview();
          }
        }}
      >
        <div className="gs-search">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the whole workspace…"
            aria-label="Search the whole workspace"
          />
          {!q && !loading && (
            <kbd className="gs-kbd">⌘K</kbd>
          )}
          {q && (
            <button type="button" className="gs-clear" onClick={() => setQ('')} aria-label="Clear query">
              <Icon name="x" size={13} />
            </button>
          )}
          {loading && <span className="gs-spinner" aria-label="Searching" />}
        </div>

        <div className="gs-filters" role="group" aria-label="Search filters">
          <select
            className="form-select"
            aria-label="Filter by person"
            value={personId}
            onChange={(e) => setPersonId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Any person</option>
            {otherPeople.map((u) => (
              <option key={u.id} value={u.id}>{personName(u.first_name, u.last_name, u.email)}</option>
            ))}
          </select>
          <select
            className="form-select"
            aria-label="Filter by team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Any team</option>
            {selectableTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <select
            className="form-select"
            aria-label="Filter by department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Any department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            className="form-select"
            aria-label="Filter by file type"
            value={fileType}
            onChange={(e) => setFileType(e.target.value)}
          >
            {FILE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            className="form-select"
            aria-label="Filter by message type"
            value={messageType}
            onChange={(e) => setMessageType(e.target.value)}
          >
            {MESSAGE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <label className="gs-date" title="From date">
            <span>From</span>
            <input
              type="date"
              aria-label="From date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="gs-date" title="To date">
            <span>To</span>
            <input
              type="date"
              aria-label="To date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          {activeFiltersCount > 0 && (
            <button type="button" className="gs-clear-filters" onClick={clearAll}>
              <Icon name="x" size={11} /> Clear {activeFiltersCount}
            </button>
          )}
        </div>
      </form>

      {error && <div className="gs-error">{error}</div>}

      {!hasCriteria && (
        <div className="gs-intro">
          <span className="gs-intro-icon"><Icon name="search" size={28} /></span>
          <h3>Search the whole workspace</h3>
          <p>
            Start typing above — or pick a person, team, department, date range,
            file type or message type to narrow the results.
          </p>
          <div className="gs-scope-chips">
            {SCOPE_ORDER.map((s) => (
              <span key={s}><Icon name={SCOPE_META[s].icon} size={12} /> {SCOPE_META[s].label}</span>
            ))}
          </div>
        </div>
      )}

      {hasCriteria && ranSearch && !loading && totalHits === 0 && (
        <div className="gs-no-results">
          <Icon name="search" size={26} />
          <h3>No results found</h3>
          <p>
            Nothing matches{activeFiltersCount > 0 ? ' these filters' : ''}. Try
            different keywords or clear a filter.{' '}
            {activeFiltersCount > 0 && (
              <button className="gs-link" onClick={clearAll}>Clear filters</button>
            )}
          </p>
        </div>
      )}

      {hasCriteria && !scopeView && (
        <div className="gs-tabs" role="tablist" aria-label="Result categories">
          <button
            role="tab"
            aria-selected={!scopeView}
            className={`gs-tab ${!scopeView ? 'active' : ''}`}
            onClick={() => { setScopeView(null); setScopeData(null); }}
          >
            All results
            {totalHits > 0 && <span className="gs-count">{totalHits}</span>}
          </button>
          {SCOPE_ORDER.map((s) => {
            const count = scopeCount(s);
            if (count === 0 && !scopeView) return null;
            return (
              <button
                key={s}
                role="tab"
                aria-selected={scopeView === s}
                className={`gs-tab ${scopeView === s ? 'active' : ''}`}
                onClick={() => (scopeView === s ? setScopeView(null) : openScope(s))}
              >
                <Icon name={SCOPE_META[s].icon} size={12} /> {SCOPE_META[s].label}
                {count > 0 && <span className="gs-count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {hasCriteria && (
        <div className="gs-results">
          {scopeView === null
            ? SCOPE_ORDER.map((s) => renderScopeSection(s))
            : renderScopeSection(scopeView)}
        </div>
      )}
    </div>
  );
};

export default SearchView;
