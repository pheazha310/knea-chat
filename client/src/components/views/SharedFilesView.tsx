import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSharedFileStore } from '../../store/sharedFileStore';
import { resolveSharedFileUrl } from '../../models';
import Icon, { type IconName } from '../common/Icon';
import Avatar from '../common/Avatar';
import ConfirmButton from '../common/ConfirmButton';
import Modal from '../modals/Modal';
import FilePreview from '../modals/FilePreview';
import FileVersionHistory from '../modals/FileVersionHistory';
import FilePermissionModal from '../modals/FilePermissionModal';
import FileShareModal from '../modals/FileShareModal';
import type { Team, Conversation } from '../../models';

const formatSize = (bytes?: number | null) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const relativeTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const FILE_TYPE_FILTERS: Array<{ key: FileFilter; label: string; icon: IconName }> = [
  { key: 'all', label: 'All files', icon: 'file' },
  { key: 'image', label: 'Images', icon: 'image' },
  { key: 'video', label: 'Videos', icon: 'video' },
  { key: 'pdf', label: 'PDFs', icon: 'file' },
  { key: 'document', label: 'Documents', icon: 'file' },
];

const FILE_TYPE_ICONS: Record<string, { icon: IconName; color: string }> = {
  image: { icon: 'image', color: '#10b981' },
  video: { icon: 'video', color: '#6366f1' },
  audio: { icon: 'mic', color: '#f59e0b' },
  pdf: { icon: 'file', color: '#ef4444' },
  document: { icon: 'file', color: '#3b82f6' },
  zip: { icon: 'archive', color: '#f97316' },
  default: { icon: 'file', color: '#94a3b8' },
};

const getFileTypeMeta = (mimeType?: string | null) => {
  if (!mimeType) return FILE_TYPE_ICONS.default;
  const type = mimeType.toLowerCase();
  if (type.startsWith('image/')) return FILE_TYPE_ICONS.image;
  if (type.startsWith('video/')) return FILE_TYPE_ICONS.video;
  if (type.startsWith('audio/')) return FILE_TYPE_ICONS.audio;
  if (type === 'application/pdf') return FILE_TYPE_ICONS.pdf;
  if (type.includes('word') || type.includes('document') || type.includes('text/plain')) return FILE_TYPE_ICONS.document;
  if (type.includes('zip') || type.includes('compressed')) return FILE_TYPE_ICONS.zip;
  return FILE_TYPE_ICONS.default;
};

interface SharedFilesViewProps {
  /** Teams the current user belongs to (all teams when a manager). */
  teams?: Team[];
  /** The user's conversations, offered as share destinations. */
  conversations?: Conversation[];
  canManage?: boolean;
  currentUserId?: number | null;
  onOpenConversation?: (id: number) => void;
}

type FileFilter = 'all' | 'image' | 'video' | 'pdf' | 'document';
type FilesTab = 'shared' | 'team';

const SharedFilesView = ({ teams = [], conversations = [], canManage = false, currentUserId, onOpenConversation }: SharedFilesViewProps) => {
  const {
    files, total, teamFiles, teamTotal, isLoading, error,
    loadFiles, loadTeamFiles, setSearchQuery, deleteFile, clear,
  } = useSharedFileStore();

  const [tab, setTab] = useState<FilesTab>('shared');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FileFilter>('all');
  const [previewFile, setPreviewFile] = useState<{ id: number; url: string; name: string; type?: string | null } | null>(null);
  const [versionFileId, setVersionFileId] = useState<number | null>(null);
  const [permFileId, setPermFileId] = useState<number | null>(null);
  const [shareFile, setShareFile] = useState<{ id: number; name: string } | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTeamId, setUploadTeamId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Teams the user may open: their own teams, plus every team for managers.
  const accessibleTeams = useMemo(
    () => teams.filter((t) => Boolean(t.user_role) || canManage),
    [teams, canManage],
  );

  // Pick the first accessible team once they load.
  useEffect(() => {
    if (accessibleTeams.length === 0) return;
    if (teamId === '' || !accessibleTeams.some((t) => t.id === teamId)) {
      setTeamId(accessibleTeams[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibleTeams]);

  // Load company files (shared tab) or the selected team's files.
  useEffect(() => {
    loadFiles();
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'team' && teamId === '') return;
    const timer = setTimeout(() => {
      if (tab === 'shared') {
        loadFiles({ search, fileType: filter === 'all' ? undefined : filter });
      } else if (teamId !== '') {
        loadTeamFiles(teamId, { search, fileType: filter === 'all' ? undefined : filter });
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, tab, teamId]);

  const activeTeam = accessibleTeams.find((t) => t.id === teamId) || null;
  const currentFiles = tab === 'shared' ? files : teamFiles;
  const currentTotal = tab === 'shared' ? total : teamTotal;

  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('description', '');
    if (uploadTeamId) {
      formData.append('team_id', String(uploadTeamId));
      formData.append('is_public', 'false');
    } else {
      formData.append('is_public', 'true');
    }
    await useSharedFileStore.getState().uploadFile(formData);
    setShowUpload(false);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // Team uploads land in the team list, not the company list — refresh it.
    if (uploadTeamId && tab === 'team' && teamId !== '') {
      loadTeamFiles(teamId, { search, fileType: filter === 'all' ? undefined : filter });
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleUpload(file);
  };

  const handleRetry = () => {
    if (tab === 'shared') loadFiles({ search, fileType: filter === 'all' ? undefined : filter });
    else if (teamId !== '') loadTeamFiles(teamId, { search, fileType: filter === 'all' ? undefined : filter });
  };

  const openUpload = (forTeam: number | null) => {
    setUploadTeamId(forTeam);
    setShowUpload(true);
  };

  const visibleFiles = filter === 'all' ? currentFiles : currentFiles.filter((f) => {
    if (filter === 'image') return f.file_type?.startsWith('image/');
    if (filter === 'video') return f.file_type?.startsWith('video/');
    if (filter === 'pdf') return f.file_type === 'application/pdf';
    if (filter === 'document') return !f.file_type?.startsWith('image/') && !f.file_type?.startsWith('video/') && !f.file_type?.startsWith('audio/') && f.file_type !== 'application/pdf';
    return true;
  });

  const headerTitle =
    tab === 'shared' ? (
      <>
        Shared Files
        {!isLoading && <span className="sf-count">{currentTotal}</span>}
      </>
    ) : (
      <>
        Team Files
        {!isLoading && activeTeam && <span className="sf-count">{currentTotal}</span>}
      </>
    );

  const headerSubtitle =
    tab === 'shared'
      ? 'Company documents, PDFs, images, and videos'
      : activeTeam
        ? `${activeTeam.name} — files uploaded or shared with this team`
        : 'Files stored in each team\u2019s own area';

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>{headerTitle}</h1>
          <p>{headerSubtitle}</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => openUpload(tab === 'team' ? (teamId === '' ? null : teamId) : null)}
          disabled={tab === 'team' && teamId === ''}
          title={tab === 'team' && teamId === '' ? 'Join or pick a team first' : undefined}
        >
          <Icon name="plus" size={14} /> Upload File
        </button>
      </div>

      {/* Scope tabs: company Shared files vs Team files */}
      <div className="sf-tabs mb-3" role="tablist" aria-label="File area">
        <button
          role="tab"
          aria-selected={tab === 'shared'}
          className={`sf-tab ${tab === 'shared' ? 'active' : ''}`}
          onClick={() => setTab('shared')}
        >
          <Icon name="file" size={14} /> Shared files
        </button>
        <button
          role="tab"
          aria-selected={tab === 'team'}
          className={`sf-tab ${tab === 'team' ? 'active' : ''}`}
          onClick={() => setTab('team')}
        >
          <Icon name="users" size={14} /> Team files
        </button>
        {tab === 'team' && (
          <select
            className="form-select !py-1.5 !px-2 !text-sm ml-auto w-auto"
            aria-label="Choose a team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            {accessibleTeams.length === 0 && <option value="">No teams</option>}
            {accessibleTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Filter tabs + search in one toolbar row */}
      <div className="sf-toolbar">
        <div className="sf-tabs" role="tablist" aria-label="File type filter">
          {FILE_TYPE_FILTERS.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={filter === item.key}
              className={`sf-tab ${filter === item.key ? 'active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="sf-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search files"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Icon name="alert" size={16} />
            {error}
          </span>
          <button className="btn-secondary !py-1 !px-3 !text-xs" onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && currentFiles.length === 0 && (
        <div className="sf-file-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="sf-file-row sf-skeleton">
              <div className="sf-file-icon" />
              <div className="sf-file-info">
                <div className="sf-file-name-row">
                  <div className="sf-skel-line" style={{ width: '55%' }} />
                </div>
                <div className="sf-file-meta">
                  <div className="sf-skel-line" style={{ width: '40%' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty states */}
      {!isLoading && tab === 'team' && accessibleTeams.length === 0 && (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="users" size={32} />
          </div>
          <b>No teams yet</b>
          <p className="center">
            Team files live in a team\u2019s own area. Ask a manager to add you to a
            team, then upload and share files here.
          </p>
        </div>
      )}

      {!isLoading && tab === 'team' && accessibleTeams.length > 0 && teamId === '' && (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="grid" size={32} />
          </div>
          <b>Pick a team</b>
          <p className="center">Choose a team above to see its files.</p>
        </div>
      )}

      {!isLoading && visibleFiles.length === 0 && (tab === 'shared' || teamId !== '') && (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="file" size={32} />
          </div>
          <b>No files yet</b>
          <p className="center">
            {search || filter !== 'all'
              ? 'Try adjusting your search or filters.'
              : tab === 'shared'
                ? 'Upload documents, PDFs, images, or videos to share with your team.'
                : 'Upload the first file to this team\u2019s area — members will see it right away.'}
          </p>
          {!search && filter === 'all' && (tab === 'shared' || teamId !== '') && (
            <button
              className="btn-primary mt-2"
              onClick={() => openUpload(tab === 'team' && teamId !== '' ? teamId : null)}
            >
              <Icon name="plus" size={14} /> Upload your first file
            </button>
          )}
        </div>
      )}

      {/* File list */}
      {visibleFiles.length > 0 && (
        <div className="sf-file-list">
          {visibleFiles.map((file) => {
            const meta = getFileTypeMeta(file.file_type);
            return (
              <div
                key={file.id}
                className="sf-file-row"
              >
                <div className="sf-file-icon" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                  <Icon name={meta.icon} size={22} />
                </div>

                <div className="sf-file-info">
                  <div className="sf-file-name-row">
                    <span className="sf-file-name" title={file.file_name}>{file.file_name}</span>
                    {file.is_public && (
                      <span className="sf-badge sf-badge-public">
                        <span className="sf-badge-dot" />
                        Public
                      </span>
                    )}
                    {tab === 'team' && !file.team_id && (
                      <span className="sf-badge sf-badge-shared">
                        <Icon name="send" size={10} />
                        Shared with team
                      </span>
                    )}
                  </div>
                  <div className="sf-file-meta">
                    <Avatar
                      person={{
                        id: file.uploaded_by,
                        first_name: file.uploader_first_name,
                        last_name: file.uploader_last_name,
                        profile_picture: file.uploader_profile_picture,
                      }}
                      className="tiny"
                    />
                    <span className="sf-file-uploader">
                      {[file.uploader_first_name, file.uploader_last_name].filter(Boolean).join(' ') || 'Someone'}
                    </span>
                    <span className="sf-meta-sep">·</span>
                    <span>{formatSize(file.file_size)}</span>
                    <span className="sf-meta-sep">·</span>
                    <span>{relativeTime(file.created_at)}</span>
                  </div>
                </div>

                <div className="sf-file-actions">
                  <button
                    className="sf-icon-btn"
                    title="Preview"
                    aria-label="Preview file"
                    onClick={() => setPreviewFile({ id: file.id, url: resolveSharedFileUrl(file.file_url), name: file.file_name, type: file.file_type })}
                  >
                    <Icon name="eye" size={16} />
                  </button>
                  <button
                    className="sf-icon-btn"
                    title="Version history"
                    aria-label="Version history"
                    onClick={() => setVersionFileId(file.id)}
                  >
                    <Icon name="clock" size={16} />
                  </button>
                  <button
                    className="sf-icon-btn"
                    title="Permissions"
                    aria-label="Permissions"
                    onClick={() => setPermFileId(file.id)}
                  >
                    <Icon name="users" size={16} />
                  </button>
                  <button
                    className="sf-icon-btn"
                    title="Share with a team or conversation"
                    aria-label="Share file"
                    onClick={() => setShareFile({ id: file.id, name: file.file_name })}
                  >
                    <Icon name="send" size={16} />
                  </button>
                  <a
                    href={resolveSharedFileUrl(file.file_url)}
                    download={file.file_name}
                    className="sf-icon-btn"
                    title="Download"
                    aria-label="Download file"
                  >
                    <Icon name="download" size={16} />
                  </a>
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Confirm?"
                    className="btn-danger sf-delete"
                    onConfirm={() => deleteFile(file.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <Modal
          onClose={() => { setShowUpload(false); setDragOver(false); }}
          title={uploadTeamId && activeTeam ? `Upload to ${activeTeam.name}` : 'Upload File'}
        >
          <div className="space-y-4">
            {uploadTeamId && activeTeam ? (
              <p className="text-xs text-muted flex items-center gap-1.5">
                <Icon name="users" size={13} />
                This file will be stored in <b className="text-ink">{activeTeam.name}</b> and
                visible to its members.
              </p>
            ) : (
              <p className="text-xs text-muted flex items-center gap-1.5">
                <Icon name="file" size={13} />
                This file will be public to everyone in the company.
              </p>
            )}
            <div
              className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-lavender bg-lavender/5'
                  : 'border-gray-300 dark:border-gray-600 hover:border-lavender'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="w-14 h-14 rounded-2xl bg-lavender/10 flex items-center justify-center mx-auto mb-3">
                <Icon name="plus" size={28} className="text-lavender" />
              </div>
              <p className="text-sm font-medium text-ink">
                {dragOver ? 'Drop the file here' : 'Click to select a file or drag and drop'}
              </p>
              <p className="text-xs text-muted mt-1">
                Supports PDFs, images, videos, documents, and more
              </p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileInput}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.jpg,.jpeg,.png,.gif,.webp,.svg,.mp4,.mov,.avi,.webm,.mp3,.wav,.ogg"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <Modal onClose={() => setPreviewFile(null)} title={previewFile.name}>
          <FilePreview url={previewFile.url} name={previewFile.name} type={previewFile.type} />
        </Modal>
      )}

      {/* Version History Modal */}
      {versionFileId && (
        <Modal onClose={() => setVersionFileId(null)} title="Version History">
          <FileVersionHistory fileId={versionFileId} />
        </Modal>
      )}

      {/* Permissions Modal */}
      {permFileId && (
        <Modal onClose={() => setPermFileId(null)} title="File Permissions">
          <FilePermissionModal fileId={permFileId} />
        </Modal>
      )}

      {/* Share Modal */}
      {shareFile && (
        <Modal onClose={() => setShareFile(null)} title={`Share "${shareFile.name}"`}>
          <FileShareModal
            fileId={shareFile.id}
            fileName={shareFile.name}
            teams={accessibleTeams}
            conversations={conversations}
            currentUserId={currentUserId}
          />
        </Modal>
      )}
    </div>
  );
};

export default SharedFilesView;
