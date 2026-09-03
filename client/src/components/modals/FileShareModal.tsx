// FileShareModal — share a shared file with teams and conversations.
//
// Sharing a file grants every member of the destination (team or chat
// conversation) access to it. The modal lists where the file is currently
// shared, lets the user remove a destination, and add new ones from the
// teams/conversations they belong to.
import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import { useSharedFileStore } from '../../store/sharedFileStore';
import type { Team, Conversation } from '../../models';

interface FileShareModalProps {
  fileId: number;
  fileName: string;
  /** Teams the sharer can pick from (membership already filtered by the view). */
  teams: Team[];
  /** The sharer's conversations (part of the conversation list). */
  conversations: Conversation[];
  currentUserId?: number | null;
}

/** Best label for a conversation in the share picker. */
const conversationLabel = (conv: Conversation, currentUserId?: number | null) => {
  if (conv.type === 'channel') return `# ${conv.name || 'channel'}`;
  if (conv.type === 'team') return conv.name || 'Team conversation';
  if (conv.type === 'direct') {
    const other = (conv.members || []).find((m) => m.id !== currentUserId);
    if (other) return `${other.first_name || ''} ${other.last_name || ''}`.trim() || other.email || 'Direct';
    return 'Direct message';
  }
  return conv.name || 'Group conversation';
};

const FileShareModal = ({ fileId, fileName, teams, conversations, currentUserId }: FileShareModalProps) => {
  const { shares, loadShares, shareFile, embedFile, unshareFile } = useSharedFileStore();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<number | ''>('');
  const [selectedConversation, setSelectedConversation] = useState<number | ''>('');

  useEffect(() => {
    loadShares(fileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const handleShare = async (targetType: 'team' | 'conversation', targetId: number) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const share = await shareFile(fileId, targetType, targetId);
    setBusy(false);
    if (share) {
      if (targetType === 'team') setSelectedTeam('');
      else setSelectedConversation('');
      if (targetType === 'team') {
        const team = teams.find((t) => t.id === targetId);
        setNotice(`Shared with ${team?.name || 'the team'} — members can now open it.`);
      }
    } else {
      setError(useSharedFileStore.getState().error || 'Failed to share file');
    }
  };

  /** Share INTO a conversation: posts a chat message that embeds the file. */
  const handleEmbed = async (conversationId: number) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const share = await embedFile(fileId, conversationId);
    setBusy(false);
    if (share) {
      setSelectedConversation('');
      const conv = conversations.find((c) => c.id === conversationId);
      const where = conv ? conversationLabel(conv, currentUserId) : 'the conversation';
      setNotice(`Posted into ${where} — it now appears in that chat.`);
    } else {
      setError(useSharedFileStore.getState().error || 'Failed to share into the conversation');
    }
  };

  const handleUnshare = async (shareId: number) => {
    setBusy(true);
    setError(null);
    const ok = await unshareFile(fileId, shareId);
    setBusy(false);
    if (!ok) setError(useSharedFileStore.getState().error || 'Failed to remove share');
  };

  const shareableTeams = useMemo(() => {
    const existing = new Set(
      shares.filter((s) => s.target_type === 'team').map((s) => s.target_id),
    );
    return teams.filter((t) => !existing.has(t.id));
  }, [teams, shares]);

  const shareableConversations = useMemo(() => {
    const existing = new Set(
      shares.filter((s) => s.target_type === 'conversation').map((s) => s.target_id),
    );
    return conversations.filter((c) => !existing.has(c.id));
  }, [conversations, shares]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Sharing with a <b className="text-ink">team</b> gives its members access
        to <b className="text-ink">{fileName}</b>. Sharing with a{' '}
        <b className="text-ink">conversation</b> also posts it into that chat as
        a message.
      </p>

      {/* Where the file is currently shared */}
      {shares.length === 0 ? (
        <div className="text-sm text-muted border border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-4 py-5 text-center">
          Not shared anywhere yet — pick a team or conversation below.
        </div>
      ) : (
        <ul className="space-y-2">
          {shares.map((share) => (
            <li
              key={share.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-lavender/10 text-lavender flex items-center justify-center flex-shrink-0">
                  <Icon name={share.target_type === 'team' ? 'users' : 'message'} size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">
                    {share.target_name || 'Unknown'}
                  </span>
                  <span className="block text-[11px] text-muted capitalize">
                    {share.target_type}
                  </span>
                </span>
              </span>
              <button
                className="icon-btn !text-red-500 hover:!bg-red-50 dark:hover:!bg-red-900/20"
                title="Stop sharing with this destination"
                aria-label={`Stop sharing with ${share.target_name || 'destination'}`}
                disabled={busy}
                onClick={() => handleUnshare(share.id)}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <Icon name="check-circle" size={13} />
          {notice}
        </div>
      )}

      {/* Add a destination */}
      <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Share with…
        </p>

        {/* Teams */}
        {shareableTeams.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="form-select flex-1"
              aria-label="Choose a team"
              value={selectedTeam}
              onChange={(e) =>
                setSelectedTeam(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">Team…</option>
              {shareableTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary !py-2"
              disabled={busy || selectedTeam === ''}
              onClick={() => selectedTeam !== '' && handleShare('team', selectedTeam)}
            >
              <Icon name="send" size={13} /> Share
            </button>
          </div>
        )}

        {/* Conversations */}
        {shareableConversations.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="form-select flex-1"
              aria-label="Choose a conversation"
              value={selectedConversation}
              onChange={(e) =>
                setSelectedConversation(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">Conversation… (posts in chat)</option>
              {shareableConversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {conversationLabel(c, currentUserId)}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary !py-2"
              disabled={busy || selectedConversation === ''}
              onClick={() =>
                selectedConversation !== '' && handleEmbed(selectedConversation)
              }
            >
              <Icon name="send" size={13} /> Post
            </button>
          </div>
        )}

        {shareableTeams.length === 0 && shareableConversations.length === 0 && (
          <p className="text-sm text-muted">
            Everything you can share with already has access to this file.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted">
        <Icon name="info" size={13} />
        <span>
          The owner or a manager of the file can remove a destination again at
          any time.
        </span>
      </div>
    </div>
  );
};

export default FileShareModal;
