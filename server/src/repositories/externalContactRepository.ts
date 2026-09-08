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
         (user_id, channel, external_contact_id, username, first_name, last_name, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        channel,
        String(external_contact_id),
        username || null,
        first_name || null,
        last_name || null,
        metadata === undefined || metadata === null ? null : JSON.stringify(metadata),
      ],
    );
    return result.insertId;
  }

  async findConversationByContact(
    channel: string,
    contactId: number,
  ): Promise<ExternalConversationRow | null> {
    const rows = await this.db.query<ExternalConversationRow[]>(
      'SELECT * FROM external_conversations WHERE channel = ? AND contact_id = ? LIMIT 1',
      [channel, contactId],
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