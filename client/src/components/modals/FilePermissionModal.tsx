import React, { useEffect, useState } from 'react';
import { useSharedFileStore } from '../../store/sharedFileStore';
import Icon from '../common/Icon';
import Avatar from '../common/Avatar';
import ConfirmButton from '../common/ConfirmButton';

interface FilePermissionModalProps {
  fileId: number;
}

const PERMISSION_LABELS: Record<string, string> = {
  view: 'Can View',
  edit: 'Can Edit',
  delete: 'Can Delete',
  manage: 'Can Manage',
};

const FilePermissionModal = ({ fileId }: FilePermissionModalProps) => {
  const { loadPermissions, permissions, grantPermission, revokePermission } = useSharedFileStore();
  const [loading, setLoading] = useState(true);
  const [showGrant, setShowGrant] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPermission, setSelectedPermission] = useState('view');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadPermissions(fileId)
      .then(() => { if (mounted) setLoading(false); })
      .catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [fileId, loadPermissions]);

  const handleGrant = async () => {
    if (!selectedUserId) return;
    await grantPermission(fileId, Number(selectedUserId), selectedPermission);
    setShowGrant(false);
    setSelectedUserId('');
    setSelectedPermission('view');
  };



  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Manage who can access this file</p>
        <button className="btn-primary text-sm" onClick={() => setShowGrant(true)}>
          <Icon name="plus" size={14} /> Grant Access
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="list-card !p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : permissions.length === 0 ? (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="users" size={22} />
          </div>
          <b>No permissions granted</b>
          <p className="center">Only the owner can access this file.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {permissions.map((perm) => (
            <div key={perm.id} className="list-card !p-4">
              <div className="flex items-center gap-3">
                <Avatar
                  person={{
                    id: perm.user_id,
                    first_name: perm.user_first_name,
                    last_name: perm.user_last_name,
                    profile_picture: perm.user_profile_picture,
                  }}
                  className="small"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {[perm.user_first_name, perm.user_last_name].filter(Boolean).join(' ') || perm.user_email}
                  </p>
                  <p className="text-xs text-muted">{PERMISSION_LABELS[perm.permission] || perm.permission}</p>
                </div>
                <ConfirmButton
                  label="Revoke"
                  confirmLabel="Confirm?"
                  className="btn-danger !py-1 !px-2 !text-xs"
                  onConfirm={() => revokePermission(fileId, perm.user_id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grant Permission Modal */}
      {showGrant && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Grant Permission</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">User ID</label>
                <input
                  type="number"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="input"
                  placeholder="Enter user ID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Permission</label>
                <select
                  value={selectedPermission}
                  onChange={(e) => setSelectedPermission(e.target.value)}
                  className="input"
                >
                  <option value="view">Can View</option>
                  <option value="edit">Can Edit</option>
                  <option value="delete">Can Delete</option>
                  <option value="manage">Can Manage</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-secondary" onClick={() => setShowGrant(false)}>Cancel</button>
                <button className="btn-primary" onClick={handleGrant}>Grant</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilePermissionModal;
