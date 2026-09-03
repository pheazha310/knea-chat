/**
 * SharedFileRepository — data-access layer for the `shared_files`,
 * `file_versions`, and `file_permissions` tables. Contains SQL only; business
 * logic lives in the services.
 */
import type { Db, ResultSetHeader } from '../database/connection';
import type {
  CreateFilePermissionData,
  CreateFileShareData,
  CreateFileVersionData,
  CreateSharedFileData,
  FilePermissionRow,
  FileShareRow,
  FileVersionRow,
  SharedFileFilters,
  SharedFileRow,
  UpdateSharedFileData,
} from '../types';

/** Roles that may view any file in their own company (used by access checks). */
const PRIVILEGED_ROLES = ['super_admin', 'admin', 'manager'];

export class SharedFileRepository {
  constructor(private db: Db) {}

  // ---------------------------------------------------------------------------
  // shared_files
  // ---------------------------------------------------------------------------

  async create(data: CreateSharedFileData): Promise<number> {
    const { company_id, uploaded_by, file_name, file_url, file_type, file_size, description, is_public } = data;
    const team_id = data.team_id ?? null;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO shared_files (company_id, team_id, uploaded_by, file_name, file_url, file_type, file_size, description, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [company_id, team_id, uploaded_by, file_name, file_url, file_type || null, file_size || null, description || null, is_public ? 1 : 0],
    );
    return result.insertId;
  }

  async findById(id: number): Promise<SharedFileRow | null> {
    const files = await this.db.query<SharedFileRow[]>(
      `SELECT sf.*, t.name AS team_name, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name,
              u.email AS uploader_email, u.profile_picture AS uploader_profile_picture
       FROM shared_files sf
       JOIN users u ON sf.uploaded_by = u.id
       LEFT JOIN teams t ON sf.team_id = t.id
       WHERE sf.id = ?`,
      [id],
    );
    return files[0] || null;
  }

  async findAll(filters: SharedFileFilters): Promise<{ files: SharedFileRow[]; total: number }> {
    const { companyId, userId, search, fileType, isPublic, page = 1, limit = 20 } = filters;
    const offset = (parseInt(String(page)) - 1) * parseInt(String(limit));

    let where = 'WHERE sf.company_id = ?';
    const params: unknown[] = [companyId];

    if (userId) {
      where += ' AND sf.uploaded_by = ?';
      params.push(userId);
    }

    if (search) {
      where += ' AND sf.file_name LIKE ?';
      params.push(`%${search}%`);
    }

    if (fileType) {
      where += ' AND sf.file_type LIKE ?';
      params.push(`%${fileType}%`);
    }

    if (isPublic !== undefined) {
      where += ' AND sf.is_public = ?';
      params.push(isPublic ? 1 : 0);
    }

    const files = await this.db.query<SharedFileRow[]>(
      `SELECT sf.*, t.name AS team_name, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name,
              u.email AS uploader_email, u.profile_picture AS uploader_profile_picture
       FROM shared_files sf
       JOIN users u ON sf.uploaded_by = u.id
       LEFT JOIN teams t ON sf.team_id = t.id
       ${where}
       ORDER BY sf.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(String(limit)), offset],
    );

    const countRows = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM shared_files sf ${where}`,
      params,
    );
    const total = (countRows as Array<{ total: number }>)[0]?.total || 0;

    return { files: files as SharedFileRow[], total };
  }

  async update(id: number, data: UpdateSharedFileData): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.file_name !== undefined) {
      sets.push('file_name = ?');
      params.push(data.file_name);
    }
    if (data.description !== undefined) {
      sets.push('description = ?');
      params.push(data.description);
    }
    if (data.is_public !== undefined) {
      sets.push('is_public = ?');
      params.push(data.is_public ? 1 : 0);
    }

    if (sets.length === 0) return false;

    params.push(id);
    const result = await this.db.query<ResultSetHeader>(
      `UPDATE shared_files SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    return result.affectedRows > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM shared_files WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async exists(id: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>('SELECT id FROM shared_files WHERE id = ?', [id]);
    return !!row;
  }

  async isOwner(fileId: number, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM shared_files WHERE id = ? AND uploaded_by = ?',
      [fileId, userId],
    );
    return !!row;
  }

  /**
   * Whether a user may see a file. Access comes from being public, the
   * uploader, an explicit file_permissions row, membership of the file's home
   * team, or membership of a destination the file was shared to. Managers and
   * admins can access every file in their own company.
   */
  async canAccess(fileId: number, userId: number): Promise<boolean> {
    const [file] = await this.db.query<Array<{ is_public: number; uploaded_by: number; team_id: number | null; company_id: number }>>(
      'SELECT is_public, uploaded_by, team_id, company_id FROM shared_files WHERE id = ?',
      [fileId],
    );
    if (!file) return false;
    if (file.is_public === 1 || file.uploaded_by === userId) return true;

    const user = await this.findUserRole(userId);
    const privileged =
      !!user &&
      user.company_id === file.company_id &&
      PRIVILEGED_ROLES.includes(user.role);

    const [perm] = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM file_permissions WHERE file_id = ? AND user_id = ?',
      [fileId, userId],
    );
    if (perm) return true;

    if (file.team_id && (privileged || (await this.isTeamMember(file.team_id, userId)))) {
      return true;
    }

    return this.hasShareAccess(fileId, userId, privileged);
  }

  /**
   * Files that belong to a team: uploaded into its file area (team_id) or
   * shared to it via file_shares. Callers must validate membership first.
   */
  async findTeamFiles(
    teamId: number,
    companyId: number,
    filters: SharedFileFilters = {},
  ): Promise<{ files: SharedFileRow[]; total: number }> {
    const { search, fileType, page = 1, limit = 20 } = filters;
    const offset = (parseInt(String(page)) - 1) * parseInt(String(limit));

    let where =
      'WHERE sf.company_id = ? AND (sf.team_id = ? OR EXISTS ' +
      "(SELECT 1 FROM file_shares fs WHERE fs.file_id = sf.id AND fs.target_type = 'team' AND fs.target_id = ?))";
    const params: unknown[] = [companyId, teamId, teamId];

    if (search) {
      where += ' AND sf.file_name LIKE ?';
      params.push(`%${search}%`);
    }
    if (fileType) {
      where += ' AND sf.file_type LIKE ?';
      params.push(`%${fileType}%`);
    }

    const files = await this.db.query<SharedFileRow[]>(
      `SELECT sf.*, t.name AS team_name, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name,
              u.email AS uploader_email, u.profile_picture AS uploader_profile_picture
       FROM shared_files sf
       JOIN users u ON sf.uploaded_by = u.id
       LEFT JOIN teams t ON sf.team_id = t.id
       ${where}
       ORDER BY sf.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(String(limit)), offset],
    );

    const countRows = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM shared_files sf ${where}`,
      params,
    );
    const total = (countRows as Array<{ total: number }>)[0]?.total || 0;

    return { files: files as SharedFileRow[], total };
  }

  // ---------------------------------------------------------------------------
  // Teams / conversations / users — membership helpers used by access checks
  // ---------------------------------------------------------------------------

  async findUserRole(userId: number): Promise<{ role: string; company_id: number } | null> {
    const [row] = await this.db.query<Array<{ role: string; company_id: number }>>(
      'SELECT role, company_id FROM users WHERE id = ?',
      [userId],
    );
    return row || null;
  }

  async isTeamMember(teamId: number, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId],
    );
    return !!row;
  }

  async isConversationMember(conversationId: number, userId: number): Promise<boolean> {
    const [row] = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId],
    );
    return !!row;
  }

  async findTeam(teamId: number): Promise<{ id: number; company_id: number; name: string } | null> {
    const [row] = await this.db.query<Array<{ id: number; company_id: number; name: string }>>(
      'SELECT id, company_id, name FROM teams WHERE id = ?',
      [teamId],
    );
    return row || null;
  }

  async findConversation(conversationId: number): Promise<{ id: number; type: string; name: string | null } | null> {
    const [row] = await this.db.query<Array<{ id: number; type: string; name: string | null }>>(
      'SELECT id, type, name FROM conversations WHERE id = ? AND is_active = 1',
      [conversationId],
    );
    return row || null;
  }

  async hasShareAccess(fileId: number, userId: number, privileged: boolean): Promise<boolean> {
    const shares = await this.db.query<Array<{ target_type: string; target_id: number }>>(
      'SELECT target_type, target_id FROM file_shares WHERE file_id = ?',
      [fileId],
    );
    for (const share of shares as Array<{ target_type: string; target_id: number }>) {
      if (privileged) return true;
      if (share.target_type === 'team') {
        if (await this.isTeamMember(share.target_id, userId)) return true;
      } else if (share.target_type === 'conversation') {
        if (await this.isConversationMember(share.target_id, userId)) return true;
      }
    }
    return false;
  }

  async search(companyId: number, search: string, filters: SharedFileFilters = {}): Promise<SharedFileRow[]> {
    const { fileType, page = 1, limit = 20 } = filters;
    const offset = (parseInt(String(page)) - 1) * parseInt(String(limit));

    let sql = `SELECT sf.*, t.name AS team_name, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name,
                      u.email AS uploader_email, u.profile_picture AS uploader_profile_picture
               FROM shared_files sf
               JOIN users u ON sf.uploaded_by = u.id
               LEFT JOIN teams t ON sf.team_id = t.id
               WHERE sf.company_id = ? AND sf.file_name LIKE ?`;
    const params: unknown[] = [companyId, `%${search}%`];

    if (fileType) {
      sql += ' AND sf.file_type LIKE ?';
      params.push(`%${fileType}%`);
    }

    sql += ' ORDER BY sf.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(String(limit)), offset);

    return this.db.query<SharedFileRow[]>(sql, params);
  }

  // ---------------------------------------------------------------------------
  // file_versions
  // ---------------------------------------------------------------------------

  async createVersion(data: CreateFileVersionData): Promise<number> {
    const { file_id, uploaded_by, file_name, file_url, file_type, file_size, change_description } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO file_versions (file_id, uploaded_by, file_name, file_url, file_type, file_size, change_description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [file_id, uploaded_by, file_name, file_url, file_type || null, file_size || null, change_description || null],
    );
    return result.insertId;
  }

  async findVersions(fileId: number): Promise<FileVersionRow[]> {
    return this.db.query<FileVersionRow[]>(
      `SELECT fv.*, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name, u.email AS uploader_email
       FROM file_versions fv
       JOIN users u ON fv.uploaded_by = u.id
       WHERE fv.file_id = ?
       ORDER BY fv.created_at DESC`,
      [fileId],
    );
  }

  async findVersionById(id: number): Promise<FileVersionRow | null> {
    const versions = await this.db.query<FileVersionRow[]>(
      `SELECT fv.*, u.first_name AS uploader_first_name, u.last_name AS uploader_last_name, u.email AS uploader_email
       FROM file_versions fv
       JOIN users u ON fv.uploaded_by = u.id
       WHERE fv.id = ?`,
      [id],
    );
    return versions[0] || null;
  }

  // ---------------------------------------------------------------------------
  // file_permissions
  // ---------------------------------------------------------------------------

  async createPermission(data: CreateFilePermissionData): Promise<number> {
    const { file_id, user_id, permission, granted_by } = data;
    const result = await this.db.query<ResultSetHeader>(
      `INSERT INTO file_permissions (file_id, user_id, permission, granted_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE permission = VALUES(permission), granted_by = VALUES(granted_by), granted_at = CURRENT_TIMESTAMP`,
      [file_id, user_id, permission, granted_by],
    );
    return result.insertId;
  }

  async findPermissions(fileId: number): Promise<FilePermissionRow[]> {
    return this.db.query<FilePermissionRow[]>(
      `SELECT fp.*, u.first_name AS user_first_name, u.last_name AS user_last_name,
              u.email AS user_email, u.profile_picture AS user_profile_picture,
              g.first_name AS granter_first_name, g.last_name AS granter_last_name
       FROM file_permissions fp
       JOIN users u ON fp.user_id = u.id
       JOIN users g ON fp.granted_by = g.id
       WHERE fp.file_id = ?
       ORDER BY fp.granted_at DESC`,
      [fileId],
    );
  }

  async findUserPermission(fileId: number, userId: number): Promise<FilePermissionRow | null> {
    const perms = await this.db.query<FilePermissionRow[]>(
      `SELECT fp.*, u.first_name AS user_first_name, u.last_name AS user_last_name,
              u.email AS user_email, u.profile_picture AS user_profile_picture,
              g.first_name AS granter_first_name, g.last_name AS granter_last_name
       FROM file_permissions fp
       JOIN users u ON fp.user_id = u.id
       JOIN users g ON fp.granted_by = g.id
       WHERE fp.file_id = ? AND fp.user_id = ?`,
      [fileId, userId],
    );
    return perms[0] || null;
  }

  async removePermission(fileId: number, userId: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>(
      'DELETE FROM file_permissions WHERE file_id = ? AND user_id = ?',
      [fileId, userId],
    );
    return result.affectedRows > 0;
  }

  // ---------------------------------------------------------------------------
  // file_shares — destinations (teams / conversations) a file was shared to
  // ---------------------------------------------------------------------------

  async createShare(data: CreateFileShareData): Promise<void> {
    const { file_id, target_type, target_id, shared_by } = data;
    await this.db.query<ResultSetHeader>(
      `INSERT INTO file_shares (file_id, target_type, target_id, shared_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE shared_by = VALUES(shared_by)`,
      [file_id, target_type, target_id, shared_by],
    );
  }

  async findShares(fileId: number): Promise<FileShareRow[]> {
    return this.db.query<FileShareRow[]>(
      `SELECT fs.*, COALESCE(t.name, c.name) AS target_name
       FROM file_shares fs
       LEFT JOIN teams t ON fs.target_type = 'team' AND t.id = fs.target_id
       LEFT JOIN conversations c ON fs.target_type = 'conversation' AND c.id = fs.target_id
       WHERE fs.file_id = ?
       ORDER BY fs.created_at DESC`,
      [fileId],
    );
  }

  async findShareById(id: number): Promise<FileShareRow | null> {
    const shares = await this.db.query<FileShareRow[]>(
      `SELECT fs.*, COALESCE(t.name, c.name) AS target_name
       FROM file_shares fs
       LEFT JOIN teams t ON fs.target_type = 'team' AND t.id = fs.target_id
       LEFT JOIN conversations c ON fs.target_type = 'conversation' AND c.id = fs.target_id
       WHERE fs.id = ?`,
      [id],
    );
    return shares[0] || null;
  }

  async findShareByTarget(
    fileId: number,
    targetType: string,
    targetId: number,
  ): Promise<FileShareRow | null> {
    const shares = await this.db.query<FileShareRow[]>(
      `SELECT fs.*, COALESCE(t.name, c.name) AS target_name
       FROM file_shares fs
       LEFT JOIN teams t ON fs.target_type = 'team' AND t.id = fs.target_id
       LEFT JOIN conversations c ON fs.target_type = 'conversation' AND c.id = fs.target_id
       WHERE fs.file_id = ? AND fs.target_type = ? AND fs.target_id = ?`,
      [fileId, targetType, targetId],
    );
    return shares[0] || null;
  }

  async removeShare(id: number): Promise<boolean> {
    const result = await this.db.query<ResultSetHeader>('DELETE FROM file_shares WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}
