/**
 * KneaChat — Database initializer.
 *
 * Creates the MySQL database (if missing) and applies server/database/schema.sql.
 * Safe to run repeatedly: if the schema is already applied it exits without
 * touching existing data. Use `--force` to drop all tables and re-apply.
 *
 * Usage:
 *   npm run db:init            # create DB + apply schema (no-op if applied)
 *   npm run db:init -- --force # drop all tables and re-apply schema
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'kneachat';

const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');
const FORCE = process.argv.includes('--force');

// Connection used by main(); also closed on failure so the process always exits.
let admin = null;

// Tables that FK-reference users/attendance rows must be dropped BEFORE their
// parents, otherwise --force fails with foreign-key constraint errors.
const TABLES = [
  'system_settings',
  'password_resets',
  'user_sessions',
  'notifications',
  // announcement enhancements (migration 022) — announcement_reads and
  // announcement_reactions (migration 025) reference announcements, so they
  // are dropped first.
  'announcement_reactions',
  'announcement_reads',
  'announcements',
  'attachments',
  'message_reactions',
  'messages',
  'conversation_members',
  'conversations',
  'channel_members',
  'channels',
  // shared files feature (migration 013 + team files 019) — children first:
  // file_shares/file_versions/file_permissions reference shared_files, and
  // shared_files references users, teams and companies.
  'file_shares',
  'file_permissions',
  'file_versions',
  'shared_files',
  'team_members',
  'teams',
  // notifications feature (migration 020) — children before users/companies
  'user_notification_preferences',
  // tasks feature (migrations 020/021) — children before parents (task_comments /
  // task_attachments reference tasks, and tasks.team_id references teams).
  'task_reactions',
  'task_attachments',
  'task_comments',
  'tasks',
  // administration module (migration 023) — audit_logs / company_settings /
  // role_permissions reference companies and users, so they drop first.
  'audit_logs',
  'company_settings',
  'role_permissions',
  // attendance feature (migration 017) — children before parents
  'overtime_records',
  'break_records',
  'attendance_records',
  'work_schedules',
  'leave_requests',
  'holidays',
  'users',
  'departments',
  'companies',
];

async function main() {
  // 1. Connect without a database so we can create it if needed.
  admin = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });

  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  console.log(`✅ Database "${DB_NAME}" ready on ${DB_HOST}:${DB_PORT}`);

  // 2. Check whether the schema is already applied.
  const [rows] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'users'`,
    [DB_NAME],
  );
  const schemaApplied = rows[0].count > 0;

  if (schemaApplied && !FORCE) {
    console.log('ℹ️  Schema already applied — nothing to do.');
    console.log('   (Run with --force to drop all tables and re-apply.)');
    await applyMigrations(admin);
    await admin.end();
    return;
  }

  // 3. Apply the schema.
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  if (FORCE && schemaApplied) {
    const drop = TABLES.map((t) => `DROP TABLE IF EXISTS \`${t}\``).join(';\n');
    await admin.query(`USE \`${DB_NAME}\`; ${drop};`);
    console.log('🧹 Existing tables dropped (--force).');
  }

  // Strip comment lines BEFORE splitting on ';' — a ';' inside a comment
  // (e.g. "; column sizes...") would otherwise turn part of the comment into
  // an executable statement and fail with a SQL syntax error.
  const statements = schema
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await admin.query(`USE \`${DB_NAME}\`; ${statement};`);
  }

  await applyMigrations(admin);

  // 4. Report what was created.
  const [tables] = await admin.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = ? ORDER BY table_name`,
    [DB_NAME],
  );
  console.log(`📦 Schema applied — ${tables.length} table(s):`);
  console.log('   ' + tables.map((t) => t.table_name).join(', '));

  await admin.end();
}

/**
 * Apply lightweight migrations for databases created before a feature
 * shipped. Safe to call on any database: each migration guards on whether
 * its target table/column already exists.
 */
async function applyMigrations(admin) {
  // Migration 002: message pinning (SRS FR-11) — add is_pinned column.
  const [messagesTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'messages'`,
    [DB_NAME],
  );
  if (messagesTables[0].count === 0) return;

  const [pinnedCols] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'messages' AND column_name = 'is_pinned'`,
    [DB_NAME],
  );
  if (pinnedCols[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; ALTER TABLE messages
       ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER reply_to,
       ADD INDEX idx_messages_pinned (conversation_id, is_pinned);`,
    );
    console.log('📌 Added is_pinned column to messages (migration 002).');
  }

  // Migration 003: role-based access control (RBAC) — add the platform-wide
  // `super_admin` role to the users.role enum.
  const [roleCols] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'users' AND column_name = 'role'`,
    [DB_NAME],
  );
  if (roleCols[0].count > 0) {
    const [roleRows] = await admin.query(
      `SELECT COLUMN_TYPE FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'users' AND column_name = 'role'`,
      [DB_NAME],
    );
    const columnType = roleRows[0]?.COLUMN_TYPE || '';
    if (!columnType.includes('super_admin')) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE users
         MODIFY COLUMN role ENUM('super_admin','admin','manager','employee') NOT NULL DEFAULT 'employee';`,
      );
      console.log('🛡️  Added super_admin role to users.role (migration 003).');
    }
  }

  // Migration 004: platform-wide system settings table (Super Admin console).
  const [settingsTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'system_settings'`,
    [DB_NAME],
  );
  if (settingsTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE system_settings (
         id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
         setting_key VARCHAR(100) NOT NULL UNIQUE,
         setting_value VARCHAR(500) NOT NULL DEFAULT '',
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('⚙️  Created system_settings table (migration 004).');
  }

  // Migration 005: team conversations — extend conversations.type with 'team'.
  const [convCols] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'conversations' AND column_name = 'type'`,
    [DB_NAME],
  );
  if (convCols[0].count > 0) {
    const [convRows] = await admin.query(
      `SELECT COLUMN_TYPE FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'conversations' AND column_name = 'type'`,
      [DB_NAME],
    );
    const columnType = convRows[0]?.COLUMN_TYPE || '';
    if (!columnType.includes('team')) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE conversations
         MODIFY COLUMN type ENUM('direct','group','channel','team') NOT NULL;`,
      );
      console.log('👥 Added team to conversations.type (migration 005).');
    }
  }

  // Migration 006: company announcements (SRS FR-24).
  const [announcementTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'announcements'`,
    [DB_NAME],
  );
  if (announcementTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE announcements (
         id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
         company_id BIGINT UNSIGNED NOT NULL,
         title VARCHAR(200) NOT NULL,
         content TEXT NOT NULL,
         created_by BIGINT UNSIGNED NOT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         FOREIGN KEY (company_id) REFERENCES companies(id),
         FOREIGN KEY (created_by) REFERENCES users(id),
         INDEX idx_announcements_company (company_id, created_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('📢 Created announcements table (migration 006).');
  }

  // Migration 007: restrict team conversations to team members + privileged
  // roles. Removes stale conversation_members rows for people who were
  // auto-joined under the old permissive model but are neither team members
  // nor managers/admins — so they stop receiving broadcasts/notifications.
  const [teamConvCols] = await admin.query(
    `SELECT COLUMN_TYPE FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'conversations' AND column_name = 'type'`,
    [DB_NAME],
  );
  if (teamConvCols[0]?.COLUMN_TYPE?.includes('team')) {
    await admin.query(
      `USE \`${DB_NAME}\`; DELETE cm FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       JOIN users u ON u.id = cm.user_id
       WHERE c.type = 'team'
         AND u.role NOT IN ('super_admin', 'admin', 'manager')
         AND NOT EXISTS (
           SELECT 1 FROM teams t
           JOIN team_members tm ON tm.team_id = t.id
           WHERE t.name = c.name AND tm.user_id = u.id AND t.company_id = u.company_id
         );`,
    );
    console.log('🔒 Restricted team conversations to team members + managers/admins (migration 007).');
  }

  // Migration 008: consolidate duplicate channel/team conversations. Before
  // channel conversations were deduplicated on create, every member who
  // opened a channel could get their own conversation row, splitting message
  // history so members couldn't see each other's messages. Each duplicate
  // group (same type + name within one company) is merged into the oldest
  // row: messages, members, and notification conversationIds are moved over,
  // then the duplicate rows are removed. Idempotent: once merged, no groups
  // remain. Groups whose name exists in more than one company are skipped.
  const [convTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'conversations'`,
    [DB_NAME],
  );
  if (convTables[0].count > 0) {
    const mergeConversations = async (convType, resourceTable) => {
      const [groups] = await admin.query(
        `SELECT r.company_id, c.name, MIN(c.id) AS canonical, COUNT(*) AS cnt
         FROM \`${DB_NAME}\`.conversations c
         JOIN \`${DB_NAME}\`.${resourceTable} r ON r.name = c.name
         WHERE c.type = ? AND c.is_active = 1
         GROUP BY r.company_id, c.name
         HAVING cnt > 1`,
        [convType],
      );
      for (const group of groups) {
        const { company_id, name, canonical, cnt } = group;
        // Guard: only merge when the name maps to exactly one company.
        const [nameCompanies] = await admin.query(
          `SELECT COUNT(DISTINCT company_id) AS companies
           FROM \`${DB_NAME}\`.${resourceTable} WHERE name = ?`,
          [name],
        );
        if (Number(nameCompanies[0]?.companies || 0) !== 1) {
          console.log(`⚠️  Skipped merging ${convType} "${name}" (name exists in multiple companies).`);
          continue;
        }
        const scope = `JOIN \`${DB_NAME}\`.${resourceTable} r ON r.name = c.name AND r.company_id = ?`;
        // Move messages to the canonical conversation.
        await admin.query(
          `USE \`${DB_NAME}\`; UPDATE messages m
           JOIN conversations c ON c.id = m.conversation_id
           ${scope}
           SET m.conversation_id = ?
           WHERE c.type = ? AND c.name = ? AND c.id <> ?`,
          [company_id, canonical, convType, name, canonical],
        );
        // Merge members (canonical keeps its own; missing ones are added).
        await admin.query(
          `USE \`${DB_NAME}\`; INSERT IGNORE INTO conversation_members (conversation_id, user_id, role)
           SELECT ?, cm.user_id, 'member'
           FROM conversation_members cm
           JOIN conversations c ON c.id = cm.conversation_id
           ${scope}
           WHERE c.type = ? AND c.name = ? AND c.id <> ?`,
          [canonical, company_id, convType, name, canonical],
        );
        // Point notification data at the canonical conversation (keeps unread
        // badges alive across the merge).
        await admin.query(
          `USE \`${DB_NAME}\`; UPDATE notifications n
           JOIN conversations c
             ON CAST(JSON_UNQUOTE(JSON_EXTRACT(n.data, '$.conversationId')) AS UNSIGNED) = c.id
           ${scope}
           SET n.data = JSON_SET(n.data, '$.conversationId', ?)
           WHERE c.type = ? AND c.name = ? AND c.id <> ?`,
          [company_id, canonical, convType, name, canonical],
        );
        // Drop the duplicate rows (members first to satisfy FKs).
        await admin.query(
          `USE \`${DB_NAME}\`; DELETE cm FROM conversation_members cm
           JOIN conversations c ON c.id = cm.conversation_id
           ${scope}
           WHERE c.type = ? AND c.name = ? AND c.id <> ?`,
          [company_id, convType, name, canonical],
        );
        await admin.query(
          `USE \`${DB_NAME}\`; DELETE c FROM conversations c
           ${scope}
           WHERE c.type = ? AND c.name = ? AND c.id <> ?`,
          [company_id, convType, name, canonical],
        );
        console.log(`🗂️  Merged ${cnt} duplicate ${convType} conversations for "${name}" into #${canonical}.`);
      }
    };

    await mergeConversations('channel', 'channels');
    await mergeConversations('team', 'teams');
  }

  // Migration 009: forwarded messages — add forwarded_from column.
  const [forwardedCols] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'messages' AND column_name = 'forwarded_from'`,
    [DB_NAME],
  );
  if (forwardedCols[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; ALTER TABLE messages
       ADD COLUMN forwarded_from BIGINT UNSIGNED NULL AFTER reply_to,
       ADD INDEX idx_messages_forwarded_from (forwarded_from);`,
    );
    console.log('📨 Added forwarded_from column to messages (migration 009).');
  }

  // Migration 010: message reminders table.
  const [reminderTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'message_reminders'`,
    [DB_NAME],
  );
  if (reminderTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE message_reminders (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        message_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        remind_at DATETIME NOT NULL,
        is_sent TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uq_message_user_reminder (message_id, user_id),
        INDEX idx_reminders_remind_at (remind_at, is_sent)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('⏰ Created message_reminders table (migration 010).');
  }

  // Migration 011: voice message type — add 'voice' to messages.type enum.
  const [typeCols] = await admin.query(
    `SELECT COLUMN_TYPE FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'messages' AND column_name = 'type'`,
    [DB_NAME],
  );
  if (typeCols[0]?.COLUMN_TYPE && !typeCols[0].COLUMN_TYPE.includes('voice')) {
    await admin.query(
      `USE \`${DB_NAME}\`; ALTER TABLE messages
       MODIFY COLUMN type ENUM('text','image','file','voice','system') NOT NULL DEFAULT 'text';`,
    );
    console.log('🎤 Added voice to messages.type (migration 011).');
  }

  // Migration 012: message bookmarks table.
  const [bookmarkTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'message_bookmarks'`,
    [DB_NAME],
  );
  if (bookmarkTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE message_bookmarks (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        message_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uq_message_user_bookmark (message_id, user_id),
        INDEX idx_bookmarks_user (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('🔖 Created message_bookmarks table (migration 012).');
  }

  // Migration 013: shared files, file versions, and file permissions.
  const [sharedFileTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'shared_files'`,
    [DB_NAME],
  );
  if (sharedFileTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE shared_files (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        company_id BIGINT UNSIGNED NOT NULL,
        team_id BIGINT UNSIGNED NULL COMMENT 'Non-null when the file lives in a team file area',
        uploaded_by BIGINT UNSIGNED NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_url VARCHAR(500) NOT NULL,
        file_type VARCHAR(100),
        file_size BIGINT UNSIGNED,
        description TEXT,
        is_public TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
        FOREIGN KEY (uploaded_by) REFERENCES users(id),
        INDEX idx_shared_files_company (company_id),
        INDEX idx_shared_files_team (team_id),
        INDEX idx_shared_files_uploader (uploaded_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE file_versions (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        file_id BIGINT UNSIGNED NOT NULL,
        uploaded_by BIGINT UNSIGNED NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_url VARCHAR(500) NOT NULL,
        file_type VARCHAR(100),
        file_size BIGINT UNSIGNED,
        change_description TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES shared_files(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id),
        INDEX idx_file_versions_file (file_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE file_permissions (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        file_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        permission ENUM('view', 'edit', 'delete', 'manage') NOT NULL DEFAULT 'view',
        granted_by BIGINT UNSIGNED NOT NULL,
        granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES shared_files(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id),
        UNIQUE KEY uq_file_user (file_id, user_id),
        INDEX idx_file_permissions_file (file_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE file_shares (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        file_id BIGINT UNSIGNED NOT NULL,
        target_type ENUM('team', 'conversation') NOT NULL,
        target_id BIGINT UNSIGNED NOT NULL,
        shared_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_file_share_target (file_id, target_type, target_id),
        FOREIGN KEY (file_id) REFERENCES shared_files(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_by) REFERENCES users(id),
        INDEX idx_file_shares_target (target_type, target_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('📁 Created shared_files, file_versions, file_permissions, file_shares tables (migration 013).');
  }

  // Migration 015: meeting enhancements — fix participaints typo, add calendar,
  // recording, and per-user meeting reminders + notes tables.
  const [meetingTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'meetings'`,
    [DB_NAME],
  );
  if (meetingTables[0].count > 0) {
    const [partCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'meetings' AND column_name = 'participants'`,
      [DB_NAME],
    );
    const [badCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'meetings' AND column_name = 'participaints'`,
      [DB_NAME],
    );
    if (partCols[0].count === 0 && badCols[0].count > 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE meetings CHANGE participaints participants JSON NOT NULL COMMENT 'Array of user_id integer';`,
      );
      console.log('📅 Fixed meetings.participaints typo (migration 015).');
    }

    const [statusCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'meetings' AND column_name = 'status'`,
      [DB_NAME],
    );
    if (statusCols[0].count > 0) {
      const [badEnum] = await admin.query(
        `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = ? AND table_name = 'meetings'
         AND column_name = 'status'
         AND column_type LIKE '%schecduled%'`,
        [DB_NAME],
      );
      if (badEnum[0].count > 0) {
        await admin.query(
          `USE \`${DB_NAME}\`; UPDATE meetings SET status = 'scheduled' WHERE status = 'schecduled';`,
        );
        await admin.query(
          `USE \`${DB_NAME}\`; ALTER TABLE meetings MODIFY status ENUM('scheduled', 'completed', 'cancelled') DEFAULT 'scheduled';`,
        );
        console.log('📅 Fixed meetings.status ENUM typo (migration 015).');
      }
    }

    const [recordingUrlCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'meetings' AND column_name = 'recording_url'`,
      [DB_NAME],
    );
    if (recordingUrlCols[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE meetings
         ADD COLUMN recording_url VARCHAR(500) NULL AFTER status,
         ADD COLUMN recording_status ENUM('none','recording','processed','failed') NOT NULL DEFAULT 'none' AFTER recording_url,
         ADD COLUMN calendar_event_id VARCHAR(255) NULL AFTER recording_status,
         ADD COLUMN calendar_provider ENUM('google','outlook','ical') NULL AFTER calendar_event_id,
         ADD COLUMN meeting_link VARCHAR(500) NULL AFTER calendar_provider,
         ADD COLUMN remind_before_minutes INT NOT NULL DEFAULT 15 AFTER meeting_link;`,
      );
      console.log('📅 Added meeting enhancements columns (migration 015).');
    }
    // Migration 015 (file): recurring meetings — add recurrence fields.
    const [recurrenceCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'meetings' AND column_name = 'recurrence_pattern'`,
      [DB_NAME],
    );
    if (recurrenceCols[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE meetings
         ADD COLUMN recurrence_pattern ENUM('none', 'daily', 'weekly', 'monthly') NOT NULL DEFAULT 'none' AFTER remind_before_minutes,
         ADD COLUMN recurrence_interval INT NOT NULL DEFAULT 1 AFTER recurrence_pattern,
         ADD COLUMN recurrence_end_date DATE NULL AFTER recurrence_interval,
         ADD COLUMN recurrence_days JSON NULL COMMENT 'Array of weekday integers for weekly recurrence' AFTER recurrence_end_date;`,
      );
      console.log('🔁 Added recurring meetings columns (migration 015).');
    }

    // Migration 014 (file): meeting attendees (RSVP).
    const [attendeeTables] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.tables
       WHERE table_schema = ? AND table_name = 'meeting_attendees'`,
      [DB_NAME],
    );
    if (attendeeTables[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; CREATE TABLE meeting_attendees (
          id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
          meeting_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          rsvp_status ENUM('pending', 'accepted', 'declined', 'maybe') NOT NULL DEFAULT 'pending',
          responded_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_meeting_user (meeting_id, user_id),
          FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_meeting_attendees_meeting (meeting_id),
          INDEX idx_meeting_attendees_user (user_id),
          INDEX idx_meeting_attendees_status (rsvp_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      );
      console.log('🙋 Created meeting_attendees table (migration 014).');
    }

    // Migration 016 (file): meeting attachments.
    const [meetingAttachmentTables] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.tables
       WHERE table_schema = ? AND table_name = 'meeting_attachments'`,
      [DB_NAME],
    );
    if (meetingAttachmentTables[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; CREATE TABLE meeting_attachments (
          id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
          meeting_id BIGINT UNSIGNED NOT NULL,
          uploaded_by BIGINT UNSIGNED NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_url VARCHAR(500) NOT NULL,
          file_type VARCHAR(100),
          file_size BIGINT UNSIGNED,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
          FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_meeting_attachments_meeting (meeting_id),
          INDEX idx_meeting_attachments_uploader (uploaded_by)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      );
      console.log('📎 Created meeting_attachments table (migration 016).');
    }
  }

  // Migration 017: Employee Working Time & Attendance — work schedules,
  // attendance records, breaks, leave requests, public holidays, overtime.
  const [workScheduleTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'work_schedules'`,
    [DB_NAME],
  );
  if (workScheduleTables[0].count === 0) {
    const attendanceSql = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '017_attendance.sql'),
      'utf8',
    );
    const statements = attendanceSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await admin.query(`USE \`${DB_NAME}\`; ${statement};`);
    }
    console.log('⏱️  Created attendance tables (migration 017).');
  }

  // Migration 018: overtime_records.date — the work date an overtime request
  // belongs to (independent of attendance_id, which may be null when the
  // employee never clocked in that day).
  const [overtimeTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'overtime_records'`,
    [DB_NAME],
  );
  if (overtimeTables[0].count > 0) {
    const [dateCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'overtime_records' AND column_name = 'date'`,
      [DB_NAME],
    );
    if (dateCols[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE overtime_records
         ADD COLUMN date DATE NULL AFTER employee_id,
         ADD INDEX idx_overtime_records_date (date);`,
      );
      console.log('⏱️  Added overtime_records.date (migration 018).');
    }
  }

  // Migration 019: team files + file sharing — shared_files.team_id scopes a
  // file to a team's file area, and file_shares links a file to extra
  // destinations (teams or conversations) whose members may access it.
  const [fileTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'shared_files'`,
    [DB_NAME],
  );
  if (fileTables[0].count > 0) {
    const [teamCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'shared_files' AND column_name = 'team_id'`,
      [DB_NAME],
    );
    if (teamCols[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE shared_files
         ADD COLUMN team_id BIGINT UNSIGNED NULL AFTER company_id,
         ADD INDEX idx_shared_files_team (team_id),
         ADD CONSTRAINT fk_shared_files_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;`,
      );
      console.log('📁 Added shared_files.team_id (migration 019).');
    }

    const [shareTables] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.tables
       WHERE table_schema = ? AND table_name = 'file_shares'`,
      [DB_NAME],
    );
    if (shareTables[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; CREATE TABLE file_shares (
          id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
          file_id BIGINT UNSIGNED NOT NULL,
          target_type ENUM('team', 'conversation') NOT NULL,
          target_id BIGINT UNSIGNED NOT NULL,
          shared_by BIGINT UNSIGNED NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_file_share_target (file_id, target_type, target_id),
          FOREIGN KEY (file_id) REFERENCES shared_files(id) ON DELETE CASCADE,
          FOREIGN KEY (shared_by) REFERENCES users(id),
          INDEX idx_file_shares_target (target_type, target_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      );
      console.log('🔗 Created file_shares table (migration 019).');
    }
  }

  // Migration 020: tasks + per-user notification preferences.
  const [taskTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'tasks'`,
    [DB_NAME],
  );
  if (taskTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE tasks (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        company_id BIGINT UNSIGNED NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        assignee_id BIGINT UNSIGNED NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        due_date DATE NULL,
        priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
        status ENUM('open', 'in_progress', 'completed') NOT NULL DEFAULT 'open',
        completed_at DATETIME NULL,
        deadline_reminded_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_tasks_company (company_id, created_at),
        INDEX idx_tasks_assignee (assignee_id, status),
        INDEX idx_tasks_due (due_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('✅ Created tasks table (migration 020).');
  }

  const [prefTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'user_notification_preferences'`,
    [DB_NAME],
  );
  if (prefTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE user_notification_preferences (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        category VARCHAR(40) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_pref_category (user_id, category),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_prefs_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('🔔 Created user_notification_preferences table (migration 020).');
  }

  // Migration 021: tasks & work management — optional team scope (team tasks),
  // per-task comments and file attachments.
  const [taskCoreTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'tasks'`,
    [DB_NAME],
  );
  if (taskCoreTables[0].count > 0) {
    // 021a: tasks.team_id — scope a task to a team (visible to its members).
    const [teamCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'tasks' AND column_name = 'team_id'`,
      [DB_NAME],
    );
    if (teamCols[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE tasks
         ADD COLUMN team_id BIGINT UNSIGNED NULL AFTER company_id,
         ADD INDEX idx_tasks_team (team_id),
         ADD CONSTRAINT fk_tasks_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;`,
      );
      console.log('👥 Added tasks.team_id (migration 021).');
    }
  }

  const [commentTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'task_comments'`,
    [DB_NAME],
  );
  if (commentTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE task_comments (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        task_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_task_comments_task (task_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('💬 Created task_comments table (migration 021).');
  }

  const [attachmentTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'task_attachments'`,
    [DB_NAME],
  );
  if (attachmentTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE task_attachments (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        task_id BIGINT UNSIGNED NOT NULL,
        uploaded_by BIGINT UNSIGNED NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_url VARCHAR(500) NOT NULL,
        file_type VARCHAR(100),
        file_size BIGINT UNSIGNED,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_task_attachments_task (task_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('📎 Created task_attachments table (migration 021).');
  }

  // Migration 022: announcement enhancements — targeting (department/team),
  // pinning, scheduling, and the read-confirmation ledger.
  const [announcementEnhancementTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'announcements'`,
    [DB_NAME],
  );
  if (announcementEnhancementTables[0].count > 0) {
    const [scopeCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'announcements' AND column_name = 'scope'`,
      [DB_NAME],
    );
    if (scopeCols[0].count === 0) {
      const enhancementSql = fs.readFileSync(
        path.join(__dirname, '..', 'database', 'migrations', '022_announcement_enhancements.sql'),
        'utf8',
      );
      const statements = enhancementSql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const statement of statements) {
        await admin.query(`USE \`${DB_NAME}\`; ${statement};`);
      }
      console.log('📢 Added announcement targeting/pinning/scheduling + announcement_reads (migration 022).');
    }
  }

  // Migration 023: administration module — audit logs, per-company settings,
  // role permission overrides, and subscription plan columns on companies.
  const [planCols] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'companies' AND column_name = 'plan_key'`,
    [DB_NAME],
  );
  if (planCols[0].count === 0) {
    const adminSql = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '023_administration.sql'),
      'utf8',
    );
    const statements = adminSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await admin.query(`USE \`${DB_NAME}\`; ${statement};`);
    }
    console.log('🛠️  Added administration module tables + plan columns (migration 023).');
  }

  // Migration 024: login history + session management. Sessions are now kept
  // after logout (soft sign-out via logged_out_at) instead of being deleted,
  // so the user's login history (device, IP, times) can be surfaced in the UI.
  const [sessionTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'user_sessions'`,
    [DB_NAME],
  );
  if (sessionTables[0].count > 0) {
    const [loggedOutCols] = await admin.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'user_sessions' AND column_name = 'logged_out_at'`,
      [DB_NAME],
    );
    if (loggedOutCols[0].count === 0) {
      await admin.query(
        `USE \`${DB_NAME}\`; ALTER TABLE user_sessions
         ADD COLUMN logged_out_at DATETIME NULL AFTER expires_at,
         ADD INDEX idx_sessions_user_logged_out (user_id, logged_out_at);`,
      );
      console.log('🔐 Added logged_out_at to user_sessions (migration 024).');
    }
  }

  // Migration 025: announcement reactions — emoji reactions on announcements
  // (mirror of message_reactions, surfaced on announcement cards + their
  // notification rows).
  const [announcementReactionTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'announcement_reactions'`,
    [DB_NAME],
  );
  if (announcementReactionTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE announcement_reactions (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        announcement_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        reaction VARCHAR(50) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_announcement_user_reaction (announcement_id, user_id, reaction),
        INDEX idx_announcement_reactions_announcement (announcement_id),
        FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('🙂 Created announcement_reactions table (migration 025).');
  }

  // Migration 026: task reactions — emoji reactions on tasks (mirror of
  // message_reactions, surfaced in the task detail view + notification rows).
  const [taskReactionTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'task_reactions'`,
    [DB_NAME],
  );
  if (taskReactionTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE task_reactions (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        task_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        reaction VARCHAR(50) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_task_user_reaction (task_id, user_id, reaction),
        INDEX idx_task_reactions_task (task_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('🙂 Created task_reactions table (migration 026).');
  }

  // Migration 027: Telegram omni-channel — external contacts, conversations,
  // messages tables + the 'external' user role for shadow contact accounts.
  const [roleColumnType] = await admin.query(
    `SELECT COLUMN_TYPE FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'users' AND column_name = 'role'`,
    [DB_NAME],
  );
  if (roleColumnType[0]?.COLUMN_TYPE && !roleColumnType[0].COLUMN_TYPE.includes('external')) {
    await admin.query(
      `USE \`${DB_NAME}\`; ALTER TABLE users
       MODIFY COLUMN role ENUM('super_admin','admin','manager','employee','external') NOT NULL DEFAULT 'employee';`,
    );
    console.log('🎫 Added external role to users.role (migration 027).');
  }

  // The dedicated company that hosts external-contact shadow users —
  // OmniChannel.service refuses the first inbound message without it
  // (mirrors migration 024 in database/migrations/).
  const [omniCompany] = await admin.query(
    `SELECT id FROM \`${DB_NAME}\`.companies WHERE domain = 'omni-channel.external' LIMIT 1`,
  );
  if (omniCompany.length === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; INSERT INTO companies (name, domain)
       SELECT 'Omni-Channel External', 'omni-channel.external'
       WHERE NOT EXISTS (SELECT 1 FROM companies WHERE domain = 'omni-channel.external');`,
    );
    console.log('🎫 Created Omni-Channel External company (migration 027).');
  }

  const [externalContactTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'external_contacts'`,
    [DB_NAME],
  );
  if (externalContactTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE external_contacts (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        channel VARCHAR(50) NOT NULL,
        external_contact_id VARCHAR(191) NOT NULL,
        username VARCHAR(255) NULL,
        first_name VARCHAR(100) NULL,
        last_name VARCHAR(100) NULL,
        metadata JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_external_contact_channel_id (channel, external_contact_id),
        INDEX idx_external_contacts_channel (channel),
        INDEX idx_external_contacts_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('🎫 Created external_contacts table (migration 027).');
  }

  const [externalConvTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'external_conversations'`,
    [DB_NAME],
  );
  if (externalConvTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE external_conversations (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        conversation_id BIGINT UNSIGNED NOT NULL,
        contact_id BIGINT UNSIGNED NOT NULL,
        channel VARCHAR(50) NOT NULL,
        status ENUM('open','closed') NOT NULL DEFAULT 'open',
        assigned_agent_id BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_external_conversation_contact (contact_id, channel),
        INDEX idx_external_conversations_conversation (conversation_id),
        INDEX idx_external_conversations_channel (channel),
        INDEX idx_external_conversations_agent (assigned_agent_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES external_contacts(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_agent_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('🎫 Created external_conversations table (migration 027).');
  }

  const [externalMsgTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'external_messages'`,
    [DB_NAME],
  );
  if (externalMsgTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE external_messages (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        message_id BIGINT UNSIGNED NOT NULL,
        conversation_id BIGINT UNSIGNED NOT NULL,
        external_message_id VARCHAR(191) NULL,
        channel VARCHAR(50) NOT NULL,
        direction ENUM('inbound','outbound') NOT NULL,
        sender_type ENUM('customer','agent','system') NOT NULL DEFAULT 'customer',
        content TEXT NOT NULL,
        external_timestamp DATETIME NULL,
        metadata JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_external_message_channel_id (channel, external_message_id),
        INDEX idx_external_messages_conversation (conversation_id),
        INDEX idx_external_messages_message (message_id),
        INDEX idx_external_messages_channel (channel),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('🎫 Created external_messages table (migration 027).');
  }

  const [noteTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'meeting_notes'`,
    [DB_NAME],
  );
  if (noteTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE meeting_notes (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        meeting_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_meeting_notes_meeting (meeting_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('📝 Created meeting_notes table (migration 015).');
  }

  const [meetingReminderTables] = await admin.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'meeting_reminders'`,
    [DB_NAME],
  );
  if (meetingReminderTables[0].count === 0) {
    await admin.query(
      `USE \`${DB_NAME}\`; CREATE TABLE meeting_reminders (
        id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
        meeting_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        remind_at DATETIME NOT NULL,
        is_sent TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uq_meeting_user_reminder (meeting_id, user_id),
        INDEX idx_meeting_reminders_remind_at (remind_at, is_sent)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
    console.log('⏰ Created meeting_reminders table (migration 015).');
  }
}

main().catch(async (error) => {
  console.error('❌ Database initialization failed:', error.message);
  process.exitCode = 1;
  // Close the connection so the process exits instead of hanging on an open handle.
  if (admin) {
    await admin.end().catch(() => {});
  }
});
