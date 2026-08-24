import React, { useEffect, useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { MessageModel } from '../../models';
import MessageComposer from '../chat/MessageComposer';
import Icon from '../common/Icon';
import type { ChatMessage, Message } from '../../models';

interface ThreadPanelProps {
  parentMessage: ChatMessage;
  onClose: () => void;
}

const createdAtOf = (m: ChatMessage) =>
  (m as Message).created_at ?? (m as any).createdAt;

const ThreadPanel = ({ parentMessage, onClose }: ThreadPanelProps) => {
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const { activeId, sendMessage } = useChatStore();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    MessageModel.getThread(parentMessage.id)
      .then((res: any) => {
        if (mounted) {
          setReplies(res.data?.data?.replies || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [parentMessage.id]);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || activeId === null) return;
    sendMessage(activeId, trimmed, parentMessage.id);
    setDraft('');
  };

  return (
    <div className="thread-panel">
      <div className="thread-panel-header">
        <button onClick={onClose} className="thread-close" aria-label="Close thread">
          <Icon name="chevron-left" size={16} />
        </button>
        <h3>Thread</h3>
      </div>
      <div className="thread-parent">
        <div className="thread-parent-message">
          <p>{parentMessage.content}</p>
        </div>
      </div>
      <div className="thread-replies">
        {loading ? (
          <p className="text-sm text-muted">Loading replies...</p>
        ) : replies.length === 0 ? (
          <p className="text-sm text-muted">No replies yet. Start the conversation!</p>
        ) : (
          replies.map((reply) => (
            <div key={reply.id} className="thread-reply">
              <p>{reply.content}</p>
              <small>{createdAtOf(reply) ? new Date(createdAtOf(reply) as string).toLocaleString() : ''}</small>
            </div>
          ))
        )}
      </div>
      <MessageComposer
        draft={draft}
        onDraftChange={setDraft}
        onSend={handleSend}
        active={null}
        replyTo={null}
        onClearReply={() => {}}
        users={[]}
        onSendFile={async () => {}}
        uploading={false}
        uploadProgress={null}
      />
    </div>
  );
};

export default ThreadPanel;
