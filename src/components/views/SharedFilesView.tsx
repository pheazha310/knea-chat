import React, { useEffect, useRef, useState } from 'react';
import { useSharedFileStore } from '../../store/sharedFileStore';
import { resolveSharedFileUrl } from '../../models';
import Icon, { type IconName } from '../common/Icon';
import Avatar from '../common/Avatar';
import ConfirmButton from '../common/ConfirmButton';
import Modal from '../modals/Modal';
import FilePreview from '../modals/FilePreview';
import FileVersionHistory from '../modals/FileVersionHistory';
import FilePermissionModal from '../modals/FilePermissionModal';

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
  onOpenConversation?: (id: number) => void;
}

type FileFilter = 'all' | 'image' | 'video' | 'pdf' | 'document';

const SharedFilesView = ({ onOpenConversation }: SharedFilesViewProps) => {
  const {
    files, total, isLoading, error,
    loadFiles, setSearchQuery, deleteFile, clear,
  } = useSharedFileStore();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FileFilter>('all');
  const [previewFile, setPreviewFile] = useState<{ id: number; url: string; name: string; type?: string | null } | null>(null);
  const [versionFileId, setVersionFileId] = useState<number | null>(null);
  const [permFileId, setPermFileId] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();
    return () => clear();
  }, [loadFiles, clear]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(search);
      loadFiles({ search, fileType: filter === 'all' ? undefined : filter });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, filter, loadFiles, setSearchQuery]);

  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('company_id', '1');
    formData.append('file', file);
    formData.append('description', '');
    formData.append('is_public', 'true');
    await useSharedFileStore.getState().uploadFile(formData);
    setShowUpload(false);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    loadFiles({ search, fileType: filter === 'all' ? undefined : filter });
  };

  const visibleFiles = filter === 'all' ? files : files.filter((f) => {
    const meta = getFileTypeMeta(f.file_type);
    if (filter === 'image') return f.file_type?.startsWith('image/');
    if (filter === 'video') return f.file_type?.startsWith('video/');
    if (filter === 'pdf') return f.file_type === 'application/pdf';
    if (filter === 'document') return !f.file_type?.startsWith('image/') && !f.file_type?.startsWith('video/') && !f.file_type?.startsWith('audio/') && f.file_type !== 'application/pdf';
    return true;
  });

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Shared Files</h1>
          <p>
            Company documents, PDFs, images, and videos
            {!isLoading && ` — ${total} file${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowUpload(true)}>
          <Icon name="plus" size={14} /> Upload File
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {FILE_TYPE_FILTERS.map((item) => (
          <button
            key={item.key}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              filter === item.key
                ? 'bg-lavender/10 border-lavender/30 text-lavender'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
            }`}
            onClick={() => setFilter(item.key)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name={item.icon} size={14} />
              {item.label}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="view-toolbar mb-4">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            type="text"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
      {isLoading && files.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="list-card !p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && visibleFiles.length === 0 && (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="file" size={32} />
          </div>
          <b>No shared files yet</b>
          <p className="center">
            {search || filter !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Upload documents, PDFs, images, or videos to share with your team.'}
          </p>
          {!search && filter === 'all' && (
            <button className="btn-primary mt-2" onClick={() => setShowUpload(true)}>
              <Icon name="plus" size={14} /> Upload your first file
            </button>
          )}
        </div>
      )}

      {/* File list */}
      {visibleFiles.length > 0 && (
        <div className="space-y-2">
          {visibleFiles.map((file) => {
            const meta = getFileTypeMeta(file.file_type);
            return (
              <div
                key={file.id}
                className="list-card !p-0 overflow-hidden group"
              >
                <div className="flex items-center gap-4 p-4">
                  {/* File type icon */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${meta.color}15`, color: meta.color }}
                  >
                    <Icon name={meta.icon} size={22} />
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{file.file_name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted mt-1.5 flex-wrap">
                      <Avatar
                        person={{
                          id: file.uploaded_by,
                          first_name: file.uploader_first_name,
                          last_name: file.uploader_last_name,
                          profile_picture: file.uploader_profile_picture,
                        }}
                        className="tiny"
                      />
                      <span className="font-medium text-ink">
                        {[file.uploader_first_name, file.uploader_last_name].filter(Boolean).join(' ') || 'Someone'}
                      </span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span>{formatSize(file.file_size)}</span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span>{relativeTime(file.created_at)}</span>
                      {file.is_public && (
                        <>
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Public
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      className="icon-btn"
                      title="Preview"
                      onClick={() => setPreviewFile({ id: file.id, url: resolveSharedFileUrl(file.file_url), name: file.file_name, type: file.file_type })}
                    >
                      <Icon name="file" size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Version history"
                      onClick={() => setVersionFileId(file.id)}
                    >
                      <Icon name="clock" size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Permissions"
                      onClick={() => setPermFileId(file.id)}
                    >
                      <Icon name="users" size={16} />
                    </button>
                    <a
                      href={resolveSharedFileUrl(file.file_url)}
                      download={file.file_name}
                      className="icon-btn"
                      title="Download"
                    >
                      <Icon name="download" size={16} />
                    </a>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Confirm?"
                      className="btn-danger !py-1 !px-2 !text-xs"
                      onConfirm={() => deleteFile(file.id)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <Modal onClose={() => { setShowUpload(false); setDragOver(false); }} title="Upload File">
          <div className="space-y-4">
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
    </div>
  );
};

export default SharedFilesView;
