import React, { useEffect, useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { MessageModel } from '../../models';
import Icon from '../common/Icon';
import Avatar from '../common/Avatar';

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

interface BookmarksViewProps {
  onOpenConversation?: (id: number) => void;
}

const BookmarksView = ({ onOpenConversation }: BookmarksViewProps) => {
  const { loadBookmarks, bookmarkedMessageIds } = useChatStore();
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    MessageModel.getBookmarks()
      .then((res: any) => {
        if (mounted) {
          setBookmarks(res.data?.data?.bookmarks || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [bookmarkedMessageIds.size]);

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>Bookmarks</h1>
          <p>Your saved messages — click any bookmark to jump back to the conversation.</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="list-card !p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : bookmarks.length === 0 ? (
        <div className="empty-conversation">
          <div className="empty-conversation-icon">
            <Icon name="bookmark" size={22} />
          </div>
          <b>No bookmarks yet</b>
          <p className="center">Click the bookmark icon on any message to save it here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookmarks.map((b) => {
            const senderName = [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || 'Someone';
            return (
              <button
                key={b.id}
                type="button"
                className="list-card text-left w-full !p-4"
                onClick={() => onOpenConversation?.(b.conversation_id)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Icon name="bookmark" size={16} className="text-lavender" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink leading-relaxed mb-2 line-clamp-3">
                      {b.content}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <Avatar
                        person={{
                          id: b.user_id,
                          first_name: b.first_name,
                          last_name: b.last_name,
                          profile_picture: b.profile_picture,
                        }}
                        className="small"
                      />
                      <span className="font-medium text-ink">{senderName}</span>
                      <span>·</span>
                      <time>{relativeTime(b.message_created_at || b.created_at)}</time>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BookmarksView;
