import React, { useEffect, useState } from 'react';
import { useSharedFileStore } from '../../store/sharedFileStore';
import { resolveSharedFileUrl } from '../../models';
import Icon from '../common/Icon';
import Avatar from '../common/Avatar';

const formatSize = (bytes?: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface FileVersionHistoryProps {
  fileId: number;
}

const FileVersionHistory = ({ fileId }: FileVersionHistoryProps) => {
  const { loadVersions, versions } = useSharedFileStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadVersions(fileId)
      .then(() => { if (mounted) setLoading(false); })
      .catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [fileId, loadVersions]);

  return (
    <div className="space-y-3">
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="list-card !p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
              </div>
            </div>
          </div>
        ))
      ) : versions.length === 0 ? (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="clock" size={22} />
          </div>
          <b>No version history</b>
          <p className="center">Upload a new version to start tracking changes.</p>
        </div>
      ) : (
        versions.map((version, index) => (
          <div key={version.id} className="list-card !p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-lavender/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-lavender">v{versions.length - index}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{version.file_name}</p>
                <div className="flex items-center gap-2 text-xs text-muted mt-1">
                  <Avatar
                    person={{
                      id: version.uploaded_by,
                      first_name: version.uploader_first_name,
                      last_name: version.uploader_last_name,
                    }}
                    className="tiny"
                  />
                  <span>{[version.uploader_first_name, version.uploader_last_name].filter(Boolean).join(' ')}</span>
                  <span>·</span>
                  <span>{formatSize(version.file_size)}</span>
                  <span>·</span>
                  <span>{new Date(version.created_at).toLocaleString()}</span>
                </div>
                {version.change_description && (
                  <p className="text-xs text-muted mt-1 italic">{version.change_description}</p>
                )}
              </div>
              <a
                href={resolveSharedFileUrl(version.file_url)}
                download={version.file_name}
                className="icon-btn"
                title="Download this version"
              >
                <Icon name="download" size={16} />
              </a>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default FileVersionHistory;
