/**
 * ConversationRepository — data-access layer for the `conversations` and
 * `conversation_members` tables. Contains SQL only; business logic lives in
 * the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type {
  ConversationFilters,
  ConversationMember,
  ConversationRow,
  CreateConversationData,
} from '../types';

export class ConversationRepository {
  constructor(private db: Db) {}

  async findAll(filters: ConversationFilters): Promise<ConversationRow[]> {
    const { userId, page = 1, limit = 20, type = '' } = filters;
    let sql = `SELECT c.*,
               (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) as member_count,
               (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND deleted_at IS NULL) as message_count,
               (SELECT content FROM messages WHERE conversation_id = c.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) as last_message_content,
               (SELECT created_at FROM messages WHERE conversation_id = c.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) as last_message_at
               FROM conversations c
               JOIN conversation_members cm ON c.id = cm.conversation_id
               WHERE cm.user_id = ? AND c.is_active = 1`;
    const params: unknown[] = [userId];

    if (type) {
      sql += ' AND c.type = ?';
      params.push(type);
    }

    sql += ' ORDER BY COALESCE(last_message_at, c.created_at) DESC LIMIT ? OFFSET ?';
    params.push(parseInt(String(limit)), (parseInt(String(page)) - 1) * parseInt(String(limit)));

    return this.db.query<ConversationRow[]>(sql, params);
  }

  async findById(id: number): Promise<ConversationRow | null> {
    const conversations = await this.db.query<ConversationRow[]>('SELECT * FROM conversations WHERE id = ?', [id]);
    return conversations[0] || null;
  }

  async create(data: CreateConversationData): Promise<number> {
    const { type, created_by, name, description } = data;
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO conversations (type, created_by, name, description) VALUES (?, ?, ?, ?)',
      [type, created_by, name || null, description || null],
    );
    return result.insertId;
  }

  async findMemberIds(conversationId: number): Promise<number[]> {
    const rows = await this.db.query<Array<{ user_id: number }>>(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [conversationId],
    );
    return rows.map((row) => row.user_id);
  }

  async findMembers(conversationId: number): Promise<ConversationMember[]> {
    return this.db.query<ConversationMember[]>(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.job_title, u.status, u.profile_picture, cm.role as conv_role, cm.joined_at
       FROM conversation_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.conversation_id = ?
       ORDER BY cm.joined_at ASC`,
      [conversationId],
    );
  }

  async isMember(conversationId: number, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>('SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conversationId, userId]);
    return !!row;
  }

  async addMember(conversationId: number, userId: number, role = 'member'): Promise<number> {
    const result = await this.db.query<ResultSetHeader>(
      'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
      [conversationId, userId, role],
    );
    return result.insertId;
  }

  async removeMember(conversationId: number, userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conversationId, userId]);
    return result.affectedRows > 0;
  }

  /**
   * Find the conversation backing a channel (matched the same way the client
   * resolves it: type 'channel' + the channel's name). Scoped to the channel's
   * company so a same-named channel in another company can never be matched.
   */
  async findChannelConversation(
    channelName: string,
    companyId?: number,
  ): Promise<ConversationRow | null> {
    const [conv] = await this.db.query<ConversationRow[]>(
      `SELECT c.* FROM conversations c
       WHERE c.type = 'channel' AND c.name = ? AND c.is_active = 1
         AND (${companyId ? 'EXISTS (SELECT 1 FROM channels ch WHERE ch.name = c.name AND ch.company_id = ?)' : '1 = 1'})
       LIMIT 1`,
      companyId ? [channelName, companyId] : [channelName],
    );
    return conv || null;
  }

  /**
   * Find the conversation backing a team (matched the same way the client
   * resolves it: type 'team' + the team's name). Scoped to the team's company
   * so a same-named team in another company can never be matched.
   */
  async findTeamConversation(
    teamName: string,
    companyId?: number,
  ): Promise<ConversationRow | null> {
    const [conv] = await this.db.query<ConversationRow[]>(
      `SELECT c.* FROM conversations c
       WHERE c.type = 'team' AND c.name = ? AND c.is_active = 1
         AND (${companyId ? 'EXISTS (SELECT 1 FROM teams t WHERE t.name = c.name AND t.company_id = ?)' : '1 = 1'})
       LIMIT 1`,
      companyId ? [teamName, companyId] : [teamName],
    );
    return conv || null;
  }

  /**
   * Whether a user may access a team conversation. Team conversations are
   * restricted to team members plus privileged roles (super_admin / admin /
   * manager). The team is resolved by conversation name inside the user's own
   * company, so a user can never gain access through a same-named team in
   * another company.
   */
  async canAccessTeamConversation(teamName: string, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ ok: number }>>(
      `SELECT EXISTS(
         SELECT 1 FROM users u
         WHERE u.id = ?
           AND (u.role IN ('super_admin', 'admin', 'manager')
                OR EXISTS (
                  SELECT 1 FROM teams t
                  JOIN team_members tm ON tm.team_id = t.id
                  WHERE t.name = ? AND tm.user_id = u.id AND t.company_id = u.company_id
                ))
       ) as ok`,
      [userId, teamName],
    );
    return !!row?.ok;
  }

  async findDirectConversation(userId1: number, userId2: number): Promise<number | null> {
    const [conv] = await this.db.query<Array<{ id: number }>>(
      `SELECT c.id FROM conversations c
       JOIN conversation_members cm1 ON c.id = cm1.conversation_id
       JOIN conversation_members cm2 ON c.id = cm2.conversation_id
       WHERE c.type = 'direct' AND cm1.user_id = ? AND cm2.user_id = ?
       LIMIT 1`,
      [userId1, userId2],
    );
    return conv ? conv.id : null;
  }
}
