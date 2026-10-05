import React, { useState } from 'react';
import Avatar from '../../../shared/ui/Avatar';
import Icon from '../../../shared/ui/Icon';
import Modal from '../../../shared/ui/Modal';
import { useToast } from '../../../app/providers/ToastProvider';
import { OmniModel } from '../../../entities/omni/model/Omni';
import type { ChatMessage, Conversation, User } from '../../../entities';
import { conversationContactName } from '../../../entities/conversation/model/Conversation';
import type { IconName } from '../../../shared/ui/Icon';

interface OmniInboxViewProps {
  conversations: Conversation[];
  currentUserId: number | null;
  messages: Record<number, ChatMessage[]>;
  unreadMap: Record<number, number>;
  channelFilter?: string | null;
  onShowAllChannels?: () => void;
  onManageIntegrations?: () => void;
  onOpenConversation: (id: number) => void;
  onAssignConversation: (id: number, agentId?: number) => void;
  onUnassignConversation: (id: number) => void;
}

const channelIcon = (channel: string): IconName => {
  switch (channel.toLowerCase()) {
    case 'telegram':
      return 'message';
    case 'email':
      return 'at';
    case 'website':
      return 'external';
    default:
      return 'message';
  }
};

const CHANNEL_LABELS: Record<string, string> = {
  website: 'Website Widget',
  telegram: 'Telegram',
  email: 'Email',
};

const OmniInboxView = ({
  conversations = [],
  currentUserId,
  messages = {},
  unreadMap = {},
  channelFilter = null,
  onShowAllChannels,
  onManageIntegrations,
  onOpenConversation,
  onAssignConversation,
  onUnassignConversation,
}: OmniInboxViewProps) => {
  const [hideFailing, setHideFailing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeBusy, setComposeBusy] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const { showToast } = useToast();

  const allExternal = conversations.filter(
    (c) => !!c.channel && (!channelFilter || c.channel.toLowerCase() === channelFilter.toLowerCase()),
  );
  const isFailing = (conv: Conversation): boolean =>
    Number(conv.delivery_fail_count ?? 0) > 0;
  const failingCount = allExternal.filter(isFailing).length;
  const external = hideFailing ? allExternal.filter((c) => !isFailing(c)) : allExternal;
  const channelLabel = channelFilter
    ? (CHANNEL_LABELS[channelFilter.toLowerCase()] || channelFilter)
    : null;

  const previewOf = (conv: Conversation) => {
    const list = messages[conv.id];
    if (list && list.length > 0) return list[list.length - 1].content;
    const last = conv.last_message_content;
    return last !== undefined && last !== null && last !== '' ? last : 'No messages yet';
  };

  const startEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (composeBusy) return;
    setComposeBusy(true);
    try {
      const result = await OmniModel.startEmail({ to: recipient, subject, text: body });
      const conversationId = result.data.data.conversationId;
      showToast('Email sent', { type: 'success' });
      setComposeOpen(false);
      setRecipient('');
      setSubject('');
      setBody('');
      onOpenConversation(conversationId);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } }; message?: string })
        .response?.data?.message || (error as Error).message || 'Could not send email';
      showToast(message, { type: 'error' });
    } finally {
      setComposeBusy(false);
    }
  };

  return (
    <div className="view-page">
      <div className="view-header">
        <div>
          <h1>{channelLabel ? `${channelLabel} Inbox` : 'Omni Inbox'}</h1>
          <p>{channelLabel ? `Customer conversations from ${channelLabel}.` : 'External conversations from all channels.'}</p>
        </div>
        <div className="omni-inbox-header-actions">
          {(!channelFilter || ['email', 'website'].includes(channelFilter.toLowerCase())) && (
            <button className="btn-primary" onClick={() => setComposeOpen(true)}>
              <Icon name="plus" size={14} />
              {channelFilter?.toLowerCase() === 'website' ? 'Contact customer' : 'New email'}
            </button>
          )}
          {channelFilter && onShowAllChannels && (
            <button className="btn-secondary" onClick={onShowAllChannels}>
              All channels
            </button>
          )}
          {failingCount > 0 && (
          <button
            className={`delivery-toggle${hideFailing ? ' active' : ''}`}
            onClick={() => setHideFailing((v) => !v)}
            title={
              hideFailing
                ? 'Show conversations with delivery problems'
                : 'Hide conversations with delivery problems'
            }
          >
            <Icon name="alert" size={13} />
            {failingCount} delivery issue{failingCount > 1 ? 's' : ''}
            {hideFailing ? ' · hidden' : ''}
          </button>
          )}
        </div>
      </div>

      {external.length > 0 ? (
        <div className="list-card">
          {external.map((conv) => {
            const other = conv.members?.find((m) => m.id !== currentUserId);
            const emailContact = conv.channel?.toLowerCase() === 'email';
            const contactName = emailContact
              ? conversationContactName(conv, currentUserId) || conv.name
              : conv.name;
            const unread = unreadMap[conv.id] || 0;
            const failing = isFailing(conv);
            const errorTitle = failing
              ? `Delivery failing (${conv.delivery_fail_count} consecutive): ${conv.last_delivery_error || 'unknown error'}`
              : undefined;
            return (
              <div
                key={conv.id}
                className={`list-row${failing ? ' delivery-failing' : ''}`}
                role="button"
                tabIndex={0}
                title={errorTitle}
                onClick={() => onOpenConversation(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenConversation(conv.id);
                  }
                }}
              >
                <Avatar person={other} className="small" />
                <span className="list-row-main">
                  <b>
                    <em className="group-tag">
                      <Icon name={channelIcon(conv.channel || '')} size={12} />
                      {conv.channel}
                    </em>
                    {contactName}
                    {failing && (
                      <em
                        className="group-tag delivery-warning-tag"
                        title={errorTitle}
                        aria-label={errorTitle}
                      >
                        <Icon name="alert" size={11} /> delivery failing
                      </em>
                    )}
                  </b>
                  {emailContact && (
                    <small className="omni-contact-email">
                      {conv.external_contact_email || other?.email || 'Customer email unavailable'}
                      {conv.name && contactName !== conv.name && ` · Subject: ${conv.name}`}
                    </small>
                  )}
                  <small className="list-row-preview">
                    {failing && conv.last_delivery_error
                      ? `⚠ ${conv.last_delivery_error}`
                      : previewOf(conv)}
                  </small>
                </span>
                {conv.assigned_agent_name ? (
                  <span className="row-meta">
                    <em className="group-tag assigned-tag">
                      Assigned: {conv.assigned_agent_name}
                    </em>
                    <button
                      className="icon-btn-unassign"
                      title="Unassign agent"
                      aria-label="Unassign agent"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnassignConversation(conv.id);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <button
                    className="claim-btn"
                    title="Claim this conversation"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssignConversation(conv.id);
                    }}
                  >
                    Claim
                  </button>
                )}
                {unread > 0 && <span className="unread-dot">{unread}</span>}
              </div>
            );
          })}
        </div>
      ) : hideFailing && failingCount > 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="alert" size={18} />
          </span>
          All conversations hidden — {failingCount} with delivery problems.
        </div>
      ) : (
        <div className="omni-empty-state">
          <div className="omni-empty-state-icon"><Icon name="message" size={23} /></div>
          <span className="omni-empty-eyebrow">{channelLabel ? `${channelLabel} channel` : 'Shared customer inbox'}</span>
          <h2>{channelLabel === 'Email' ? 'Start a conversation with a customer' : channelLabel ? `Your ${channelLabel} conversations will appear here` : 'Your customer conversations will appear here'}</h2>
          <p className="omni-empty-description">
            {channelLabel === 'Email'
              ? 'You can email a customer first, even if they have never contacted you. Use New email to start an outbound conversation.'
              : channelLabel === 'Website Widget'
              ? 'Visitor chats appear here when someone messages your website widget. To contact a customer first, use the email form; a website chat can only be replied to after the visitor starts it.'
              : channelLabel
                ? `When a customer messages your ${channelLabel} connection, the conversation will show up here.`
                : 'Connect a customer channel and its conversations will come into one place for your team.'}
          </p>
          {channelLabel === 'Website Widget' && (
            <form className="email-compose-form website-contact-form" onSubmit={startEmail}>
              <div>
                <h3>Contact a customer by email</h3>
                <p>Send a first message to a customer. Their reply will start an email conversation in your inbox.</p>
              </div>
              <label>
                <span>Customer email</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="customer@example.com"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Subject</span>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="How can we help?"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Message</span>
                <textarea
                  rows={4}
                  maxLength={20000}
                  placeholder="Write your message…"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  required
                />
              </label>
              <div className="website-contact-form-actions">
                <button className="btn-primary" type="submit" disabled={composeBusy}>
                  <Icon name="send" size={14} /> {composeBusy ? 'Sending…' : 'Send email'}
                </button>
              </div>
            </form>
          )}
          {channelLabel !== 'Website Widget' && <div className="omni-empty-steps">
            {channelLabel === 'Email' ? <>
              <div><span>1</span><b>Write an email</b><small>Choose a recipient and subject.</small></div>
              <div><span>2</span><b>Send your message</b><small>It creates a new customer thread.</small></div>
              <div><span>3</span><b>Continue the conversation</b><small>Replies stay together in this inbox.</small></div>
            </> : <>
              <div><span>1</span><b>Connect a channel</b><small>Set up a provider in Integrations.</small></div>
              <div><span>2</span><b>Receive a message</b><small>A customer starts the conversation.</small></div>
              <div><span>3</span><b>{channelLabel === 'Website Widget' ? 'Review the conversation' : 'Reply to the customer'}</b><small>{channelLabel === 'Website Widget' ? 'Inbound messages are available in this inbox.' : 'Continue the conversation from your inbox.'}</small></div>
            </>}
          </div>}
          {onManageIntegrations && (
            <button className="omni-empty-action" onClick={onManageIntegrations}>
              <Icon name="key" size={15} /> Integration settings
            </button>
          )}
        </div>
      )}
      {composeOpen && (
        <Modal
          title={channelFilter?.toLowerCase() === 'website' ? 'Contact a customer by email' : 'New email to a customer'}
          onClose={() => setComposeOpen(false)}
          width={560}
        >
          <form className="email-compose-form" onSubmit={startEmail}>
            <label>
              <span>Customer email</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="customer@example.com"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              <span>Subject</span>
              <input
                type="text"
                maxLength={200}
                placeholder="How can we help?"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Message</span>
              <textarea
                rows={6}
                maxLength={20000}
                placeholder="Write your message…"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
              />
            </label>
            <div className="modal-actions">
              <button className="btn-secondary" type="button" onClick={() => setComposeOpen(false)} disabled={composeBusy}>
                Cancel
              </button>
              <button className="btn-primary" type="submit" disabled={composeBusy}>
                <Icon name="send" size={14} /> {composeBusy ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default OmniInboxView;
