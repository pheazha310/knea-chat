/**
 * ExternalContactRepository — data-access layer for the omni-channel tables
 * (`external_contacts`, `external_conversations`, `external_messages`).
 * Contains SQL only; business logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type {
  ExternalContactRow,
  ExternalConversationRow,
  ExternalConversationWithContact,
  ExternalMessageRow,
} from '../types';

export interface CreateExternalContactData {
  user_id: number;
  channel: string;
  external_contact_id: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  metadata?: unknown | null;
}

export interface CreateExternalConversationData {
  conversation_id: number;
  contact_id: number;
  channel: string;
  status?: 'open' | 'closed';
  assigned_agent_id?: number | null;
}

export interface CreateExternalMessageData {
  message_id: number;
  conversation_id: number;
  external_message_id: string | null;
  channel: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'agent' | 'system';
  content: string;
  external_timestamp?: Date | string | null;
  metadata?: unknown | null;
}

export class ExternalContactRepository {
  constructor(private db: Db) {}

  async findByChannelAndExternalId(
    channel: string,
    externalContactId: string,
  ): Promise<ExternalContactRow | null> {
    const rows = await this.db.query<ExternalContactRow[]>(
      'SELECT * FROM external_contacts WHERE channel = ? AND external_contact_id = ? LIMIT 1',
      [channel, String(externalContactId)],
    );
    return rows[0] || null;
  }

  async findByEmailAddress(emailAddress: string): Promise<ExternalContactRow | null> {
    const rows = await this.db.query<ExternalContactRow[]>(
      'SELECT * FROM external_contacts WHERE channel = ? AND email_address = ? LIMIT 1',
      ['email', emailAddress.toLowerCase()],
    );
    return rows[0] || null;
  }

  async findByUserId(userId: number): Promise<ExternalContactRow | null> {
    const rows = await this.db.query<ExternalContactRow[]>(
      'SELECT * FROM external_contacts WHERE user_id = ? LIMIT 1',
      [userId],
    );
    return rows[0] || null;
  }

  async createContact(data: CreateExternalContactData): Promise<number> {
    const { user_id, channel, external_contact_id, username, first_name, last_name, metadata } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO external_contacts
         (user_id, channel, external_contact_id, username, first_name, last_name, metadata, email_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        channel,
        String(external_contact_id),
        username || null,
        first_name || null,
        last_name || null,
        metadata === undefined || metadata === null ? null : JSON.stringify(metadata),
        channel === 'email' ? String(external_contact_id).toLowerCase() : null,
      ],
    );
    return result.insertId;
  }

  async findConversationByContact(
    channel: string,
    contactId: number,
  ): Promise<ExternalConversationRow | null> {
    const rows = await this.db.query<ExternalConversationRow[]>(
      'SELECT * FROM external_conversations WHERE channel = ? AND contact_id = ? ORDER BY id DESC LIMIT 1',
      [channel, contactId],
    );
    return rows[0] || null;
  }

  /**
   * Find the contact's open conversation whose subject-named thread matches
   * the given name (email threads are named after their subject when created).
   * Used by header-less inbound email (a provider that strips RFC 5322
   * threading headers) to rejoin its thread by subject instead of falling
   * back to the contact's most recent conversation, which would glue every
   * new topic onto one thread. Closed conversations never match — a reply to
   * a closed thread arrives with In-Reply-To/References and reopens it there.
   */
  async findOpenConversationByContactAndName(
    channel: string,
    contactId: number,
    name: string,
  ): Promise<ExternalConversationRow | null> {
    const rows = await this.db.query<ExternalConversationRow[]>(
      `SELECT ec.*
       FROM external_conversations ec
       JOIN conversations c ON c.id = ec.conversation_id
       WHERE ec.channel = ? AND ec.contact_id = ? AND ec.status = 'open' AND c.name = ?
       ORDER BY ec.id DESC
       LIMIT 1`,
      [channel, contactId, name],
    );
    return rows[0] || null;
  }

  /**
   * Resolve the conversation an email thread belongs to: find the newest
   * inbound ledger message whose referenced Message-ID chain (stored in
   * metadata by the adapter) or own external_message_id matches one of the
   * supplied ids, and return that message's conversation.
   *
   * Matches against both `metadata.email.messageId` (JSON) and
   * `external_message_id` because some providers store Message-IDs in
   * different forms. The metadata key is indexed by nothing, so this is a
   * scan over the channel's inbound rows — bounded by conversation volume and
   * only executed for emails that carry In-Reply-To/References headers.
   */
  async findConversationByThreadMessageIds(
    channel: string,
    messageIds: string[],
  ): Promise<ExternalConversationRow | null> {
    const ids = [...new Set(messageIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (ids.length === 0) return null;
    const placeholders = ids.map(() => '?').join(',');
    const normalizedJsonIds = ids.map((id) => JSON.stringify(id));
    const jsonPlaceholders = normalizedJsonIds.map(() => '?').join(',');
    const rows = await this.db.query<ExternalConversationRow[]>(
      `SELECT ec.*
       FROM external_conversations ec
       JOIN external_messages em ON em.conversation_id = ec.conversation_id
       WHERE ec.channel = ?
         AND em.channel = ?
         AND em.direction = 'inbound'
         AND (
           em.external_message_id IN (${placeholders})
           OR JSON_UNQUOTE(JSON_EXTRACT(em.metadata, '$.email.messageId')) IN (${jsonPlaceholders})
         )
       ORDER BY em.id DESC
       LIMIT 1`,
      [channel, channel, ...ids, ...normalizedJsonIds],
    );
    return rows[0] || null;
  }

  async findByConversationId(
    conversationId: number,
  ): Promise<ExternalConversationRow | null> {
    const rows = await this.db.query<ExternalConversationRow[]>(
      'SELECT * FROM external_conversations WHERE conversation_id = ? LIMIT 1',
      [conversationId],
    );
    return rows[0] || null;
  }

  /** Find external conversations for a set of conversation ids (inbox tagging). */
  async findByConversationIds(conversationIds: number[]): Promise<ExternalConversationRow[]> {
    if (conversationIds.length === 0) return [];
    const placeholders = conversationIds.map(() => '?').join(',');
    return this.db.query<ExternalConversationRow[]>(
      `SELECT * FROM external_conversations WHERE conversation_id IN (${placeholders})`,
      conversationIds,
    );
  }

  /**
   * External conversation joined with its contact — used by the agent reply
   * path to resolve the provider chat id WITHOUT trusting client input.
   */
  async findConversationWithContact(
    conversationId: number,
  ): Promise<ExternalConversationWithContact | null> {
    const rows = await this.db.query<ExternalConversationWithContact[]>(
      `SELECT ec.*, ext.external_contact_id, ext.username, ext.first_name, ext.last_name
       FROM external_conversations ec
       JOIN external_contacts ext ON ext.id = ec.contact_id
       WHERE ec.conversation_id = ? LIMIT 1`,
      [conversationId],
    );
    return rows[0] || null;
  }

  async createConversation(data: CreateExternalConversationData): Promise<number> {
    const { conversation_id, contact_id, channel, status, assigned_agent_id } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO external_conversations
         (conversation_id, contact_id, channel, status, assigned_agent_id)
       VALUES (?, ?, ?, ?, ?)`,
      [conversation_id, contact_id, channel, status || 'open', assigned_agent_id || null],
    );
    return result.insertId;
  }

  async updateConversationStatus(
    conversationId: number,
    status: 'open' | 'closed',
  ): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE external_conversations SET status = ? WHERE conversation_id = ?',
      [status, conversationId],
    );
    return result.affectedRows > 0;
  }

  /** Assign (or unassign, with null) an agent to an external conversation. */
  async updateAssignedAgent(
    conversationId: number,
    agentId: number | null,
  ): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'UPDATE external_conversations SET assigned_agent_id = ? WHERE conversation_id = ?',
      [agentId, conversationId],
    );
    return result.affectedRows > 0;
  }

  /**
   * Record a failed agent reply: increment the consecutive-failure counter
   * and remember the provider's error (migration 028 delivery health).
   */
  async recordDeliveryFailure(conversationId: number, description: string): Promise<void> {
    await this.db.query(
      `UPDATE external_conversations
       SET delivery_fail_count = delivery_fail_count + 1,
           last_delivery_error = ?,
           last_delivery_failure_at = NOW()
       WHERE conversation_id = ?`,
      [String(description || 'Channel delivery failed').slice(0, 255), conversationId],
    );
  }

  /** Clear the delivery-failure state after a successful send. */
  async clearDeliveryFailure(conversationId: number): Promise<void> {
    await this.db.query(
      `UPDATE external_conversations
       SET delivery_fail_count = 0,
           last_delivery_error = NULL,
           last_delivery_failure_at = NULL
       WHERE conversation_id = ? AND delivery_fail_count <> 0`,
      [conversationId],
    );
  }

  /** Reset the failure counter when the conversation reopens on new traffic. */
  async clearDeliveryFailureOnReopen(conversationId: number): Promise<void> {
    await this.db.query(
      `UPDATE external_conversations
       SET delivery_fail_count = 0,
           last_delivery_error = NULL,
           last_delivery_failure_at = NULL
       WHERE conversation_id = ?`,
      [conversationId],
    );
  }

  /** Find the external ledger entry for an internal message id (reply mapping). */
  async findByMessageId(messageId: number): Promise<ExternalMessageRow | null> {
    const rows = await this.db.query<ExternalMessageRow[]>(
      'SELECT * FROM external_messages WHERE message_id = ? LIMIT 1',
      [messageId],
    );
    return rows[0] || null;
  }

  async findMessageByExternalId(
    channel: string,
    externalMessageId: string,
  ): Promise<ExternalMessageRow | null> {
    const rows = await this.db.query<ExternalMessageRow[]>(
      'SELECT * FROM external_messages WHERE channel = ? AND external_message_id = ? LIMIT 1',
      [channel, String(externalMessageId)],
    );
    return rows[0] || null;
  }

  /**
   * Most recent inbound message of a conversation's channel — used by the
   * reply path to derive email threading headers (subject / Message-ID
   * chain) from the customer's last email.
   */
  async findLatestInboundMessage(
    conversationId: number,
    channel: string,
  ): Promise<ExternalMessageRow | null> {
    const rows = await this.db.query<ExternalMessageRow[]>(
      `SELECT * FROM external_messages
       WHERE conversation_id = ? AND channel = ? AND direction = 'inbound'
       ORDER BY id DESC LIMIT 1`,
      [conversationId, channel],
    );
    return rows[0] || null;
  }

  async createMessage(data: CreateExternalMessageData): Promise<number> {
    const {
      message_id,
      conversation_id,
      external_message_id,
      channel,
      direction,
      sender_type,
      content,
      external_timestamp,
      metadata,
    } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO external_messages
         (message_id, conversation_id, external_message_id, channel, direction,
          sender_type, content, external_timestamp, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message_id,
        conversation_id,
        external_message_id || null,
        channel,
        direction,
        sender_type,
        content,
        external_timestamp || null,
        metadata === undefined || metadata === null ? null : JSON.stringify(metadata),
      ],
    );
    return result.insertId;
  }
}