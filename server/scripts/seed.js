/**
 * KneaChat — Demo data seeder.
 *
 * Populates the database with a realistic workplace: company, departments,
 * users (admin / manager / employee), teams, channels, direct + group
 * conversations, messages, reactions and notifications.
 *
 * Idempotent: safe to run repeatedly; it will not duplicate existing rows.
 *
 * Demo accounts (password for every account: kneachat168):
 *   super@kneachat.com      — Platform Super Admin (super_admin)
 *   admin@kneachat.com      — KneaChat Admin (admin)
 *   dara@kneachat.com       — Dara Sok (manager)
 *   maya@kneachat.com       — Maya Chen (employee)
 *   sopheap@kneachat.com    — Sopheak Phal (employee)
 *   nimol@kneachat.com      — Nimol Chea (manager)
 *   lina@kneachat.com       — Lina Kim (employee)
 *
 * Usage: npm run db:seed
 */

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connection = require('../dist/src/database/connection');
const { query } = connection.default || connection;

const PASSWORD = 'kneachat168';

// ---------------------------------------------------------------------------
// Demo avatars — gradient + initials SVGs written to /uploads (SRS FR-17).
// Real image files stored on disk; profile_picture just holds the URL.
// ---------------------------------------------------------------------------
const AVATAR_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const AVATAR_GRADIENTS = [
  ['#6366f1', '#8b5cf6'],
  ['#0ea5e9', '#6366f1'],
  ['#14b8a6', '#22c55e'],
  ['#f59e0b', '#ef4444'],
  ['#ec4899', '#f97316'],
  ['#06b6d4', '#10b981'],
];

/** Write a demo avatar SVG for a user and return its /uploads URL. */
function demoAvatar(email, firstName, lastName, index) {
  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
  const [c1, c2] = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
  const filename = `demo-${email.split('@')[0]}.svg`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="200" height="200" rx="48" fill="url(#g)"/>` +
    `<text x="100" y="134" font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" ` +
    `font-size="76" font-weight="700" fill="rgba(255,255,255,0.92)" text-anchor="middle">${initials}</text>` +
    `</svg>`;
  fs.writeFileSync(path.join(AVATAR_DIR, filename), svg);
  return `/uploads/${filename}`;
}

async function findOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ---- Company -------------------------------------------------------------
  let [company] = await query(
    'SELECT id FROM companies WHERE domain = ? LIMIT 1',
    ['kneachat.com'],
  );
  if (!company) {
    const result = await query(
      'INSERT INTO companies (name, domain) VALUES (?, ?)',
      ['KneaChat', 'kneachat.com'],
    );
    company = { id: result.insertId };
  }
  console.log(`🏢 Company ready (id=${company.id})`);

  // ---- Departments ----------------------------------------------------------
  const departmentNames = ['Administration', 'Engineering', 'Design & UX'];
  const departments = {};
  for (const name of departmentNames) {
    let dept = await findOne(
      'SELECT id FROM departments WHERE company_id = ? AND name = ? LIMIT 1',
      [company.id, name],
    );
    if (!dept) {
      const result = await query(
        'INSERT INTO departments (company_id, name, description) VALUES (?, ?, ?)',
        [company.id, name, `${name} department`],
      );
      dept = { id: result.insertId };
    }
    departments[name] = dept.id;
  }

  // ---- Users ---------------------------------------------------------------
  const users = [
    { email: 'super@kneachat.com', first_name: 'Platform', last_name: 'Super Admin', role: 'super_admin', job_title: 'Platform Administrator', dept: 'Administration' },
    { email: 'admin@kneachat.com', first_name: 'KneaChat', last_name: 'Admin', role: 'admin', job_title: 'System Administrator', dept: 'Administration' },
    { email: 'dara@kneachat.com', first_name: 'Dara', last_name: 'Sok', role: 'manager', job_title: 'Engineering Manager', dept: 'Engineering' },
    { email: 'maya@kneachat.com', first_name: 'Maya', last_name: 'Chen', role: 'employee', job_title: 'Senior Engineer', dept: 'Engineering' },
    { email: 'sopheap@kneachat.com', first_name: 'Sopheak', last_name: 'Phal', role: 'employee', job_title: 'Frontend Engineer', dept: 'Engineering' },
    { email: 'nimol@kneachat.com', first_name: 'Nimol', last_name: 'Chea', role: 'manager', job_title: 'Design Lead', dept: 'Design & UX' },
    { email: 'lina@kneachat.com', first_name: 'Lina', last_name: 'Kim', role: 'employee', job_title: 'Product Designer', dept: 'Design & UX' },
  ];

  const userIds = {};
  for (const [index, u] of users.entries()) {
    let user = await findOne(
      'SELECT id, profile_picture FROM users WHERE email = ? LIMIT 1',
      [u.email],
    );
    if (!user) {
      const result = await query(
        `INSERT INTO users (company_id, department_id, first_name, last_name, email, password, role, job_title, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offline', 1)`,
        [company.id, departments[u.dept], u.first_name, u.last_name, u.email, passwordHash, u.role, u.job_title],
      );
      user = { id: result.insertId };
      console.log(`👤 Created user ${u.email}`);
    }
    // Give demo users a real avatar image — without overwriting a photo the
    // user may have uploaded themselves since the last seed.
    const avatarUrl = demoAvatar(u.email, u.first_name, u.last_name, index);
    if (!user.profile_picture || user.profile_picture === avatarUrl) {
      await query('UPDATE users SET profile_picture = ? WHERE id = ?', [avatarUrl, user.id]);
    }
    userIds[u.email] = user.id;
  }

  // ---- Teams ---------------------------------------------------------------
  const teams = [
    { name: 'Product Engineering', dept: 'Engineering', manager: 'dara@kneachat.com' },
    { name: 'Design Guild', dept: 'Design & UX', manager: 'nimol@kneachat.com' },
  ];
  const teamIds = {};
  for (const t of teams) {
    let team = await findOne(
      'SELECT id FROM teams WHERE company_id = ? AND name = ? LIMIT 1',
      [company.id, t.name],
    );
    if (!team) {
      const result = await query(
        'INSERT INTO teams (company_id, department_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)',
        [company.id, departments[t.dept], t.name, `${t.name} team`, userIds[t.manager]],
      );
      team = { id: result.insertId };
      console.log(`👥 Created team ${t.name}`);
    }
    teamIds[t.name] = team.id;

    // Team leader
    await query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'leader')
       ON DUPLICATE KEY UPDATE role = 'leader'`,
      [team.id, userIds[t.manager]],
    );
  }

  const teamMemberships = {
    'Product Engineering': ['dara@kneachat.com', 'maya@kneachat.com', 'sopheap@kneachat.com'],
    'Design Guild': ['nimol@kneachat.com', 'lina@kneachat.com'],
  };
  for (const [teamName, emails] of Object.entries(teamMemberships)) {
    for (const email of emails) {
      await query(
        'INSERT IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)',
        [teamIds[teamName], userIds[email], 'member'],
      );
    }
  }

  // ---- Channels ------------------------------------------------------------
  const channels = [
    { name: 'general', description: 'Company-wide announcements and conversation', team: null, creator: 'admin@kneachat.com' },
    { name: 'announcements', description: 'Important workplace announcements', team: null, creator: 'admin@kneachat.com' },
    { name: 'engineering', description: 'Engineering discussions and standups', team: 'Product Engineering', creator: 'dara@kneachat.com' },
    { name: 'design', description: 'Design reviews and feedback', team: 'Design Guild', creator: 'nimol@kneachat.com' },
  ];
  const channelIds = {};
  for (const c of channels) {
    let channel = await findOne(
      'SELECT id FROM channels WHERE company_id = ? AND name = ? LIMIT 1',
      [company.id, c.name],
    );
    if (!channel) {
      const result = await query(
        'INSERT INTO channels (company_id, team_id, name, description, type, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [company.id, c.team ? teamIds[c.team] : null, c.name, c.description, 'public', userIds[c.creator]],
      );
      channel = { id: result.insertId };
      console.log(`📢 Created channel #${c.name}`);
    }
    channelIds[c.name] = channel.id;

    // Channel membership: creator is admin; everyone else joins company-wide channels.
    await query(
      `INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, 'admin')
       ON DUPLICATE KEY UPDATE role = 'admin'`,
      [channel.id, userIds[c.creator]],
    );
    const joiners = c.team
      ? teamMemberships[c.team]
      : users.map((u) => u.email);
    for (const email of joiners) {
      await query(
        'INSERT IGNORE INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)',
        [channel.id, userIds[email], 'member'],
      );
    }
  }

  // ---- Conversations -------------------------------------------------------
  const addConversation = async (type, name, description, createdByEmail, memberEmails) => {
    let conv = await findOne(
      'SELECT id FROM conversations WHERE type = ? AND name = ? LIMIT 1',
      [type, name],
    );
    if (!conv) {
      const result = await query(
        'INSERT INTO conversations (type, created_by, name, description) VALUES (?, ?, ?, ?)',
        [type, userIds[createdByEmail], name, description],
      );
      conv = { id: result.insertId };
      console.log(`💬 Created ${type} conversation "${name}"`);
    }
    const members = [createdByEmail, ...memberEmails];
    for (const email of members) {
      await query(
        'INSERT IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
        [conv.id, userIds[email], email === createdByEmail ? 'admin' : 'member'],
      );
    }
    return conv.id;
  };

  const convAdminMaya = await addConversation('direct', 'KneaChat Admin - Maya Chen', 'Direct conversation', 'admin@kneachat.com', ['maya@kneachat.com']);
  const convAdminDara = await addConversation('direct', 'KneaChat Admin - Dara Sok', 'Direct conversation', 'admin@kneachat.com', ['dara@kneachat.com']);
  const convDesign = await addConversation('group', 'Design Guild', 'Design team collaboration', 'nimol@kneachat.com', ['lina@kneachat.com', 'admin@kneachat.com', 'maya@kneachat.com']);

  // Team conversations — one shared room per team, opened by every team member.
  for (const [teamName, emails] of Object.entries(teamMemberships)) {
    await addConversation('team', teamName, `${teamName} conversation`, emails[0], emails.slice(1));
  }

  // ---- Messages ------------------------------------------------------------
  const addMessage = async (conversationId, senderEmail, content, minutesAgo, replyTo = null) => {
    const result = await query(
      `INSERT INTO messages (conversation_id, sender_id, content, type, reply_to, created_at)
       VALUES (?, ?, ?, 'text', ?, DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
      [conversationId, userIds[senderEmail], content, replyTo, minutesAgo],
    );
    return result.insertId;
  };

  const hasMessages = async (conversationId) => {
    const [row] = await query(
      'SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?',
      [conversationId],
    );
    return parseInt(row.count, 10) > 0;
  };

  if (!(await hasMessages(convAdminMaya))) {
    const m1 = await addMessage(convAdminMaya, 'maya@kneachat.com', 'Hi! I finished the chat UI refactor — the message list now renders real conversation data.', 45);
    await addMessage(convAdminMaya, 'admin@kneachat.com', 'Nice work, Maya. Does it handle typing indicators too?', 40);
    await addMessage(convAdminMaya, 'maya@kneachat.com', 'Yes — typing, presence dots and the connection status are all wired to WebSocket events now.', 35);
    await query(
      'INSERT INTO message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reaction = reaction',
      [m1, userIds['admin@kneachat.com'], '👍'],
    );
    // Demonstrate message pinning (SRS FR-11).
    await query('UPDATE messages SET is_pinned = 1 WHERE id = ?', [m1]);
    console.log(`✉️  Seeded messages for "${convAdminMaya}" (one pinned)`);
  }

  if (!(await hasMessages(convAdminDara))) {
    await addMessage(convAdminDara, 'dara@kneachat.com', 'Morning! The team shipped the dashboard improvements. Want a quick walkthrough?', 300);
    await addMessage(convAdminDara, 'admin@kneachat.com', 'Sounds great — 2 PM in #engineering?', 290);
    await addMessage(convAdminDara, 'dara@kneachat.com', 'Perfect, see you there.', 285);
    console.log(`✉️  Seeded messages for "${convAdminDara}"`);
  }

  if (!(await hasMessages(convDesign))) {
    await addMessage(convDesign, 'nimol@kneachat.com', 'Design review moved to 2:00 PM today — updated the project board.', 120);
    await addMessage(convDesign, 'lina@kneachat.com', 'Thanks! I added the latest prototype to the shared folder.', 100);
    await addMessage(convDesign, 'maya@kneachat.com', 'I will review it before our meeting and drop feedback in #design.', 60);
    await addMessage(convDesign, 'admin@kneachat.com', 'Great collaboration, everyone — keep it up! 🎉', 30);
    console.log(`✉️  Seeded messages for "${convDesign}"`);
  }

  // ---- Announcements (SRS FR-24) -------------------------------------------
  const existingAnnouncement = await findOne(
    'SELECT id FROM announcements WHERE company_id = ? LIMIT 1',
    [company.id],
  );
  if (!existingAnnouncement) {
    await query(
      'INSERT INTO announcements (company_id, title, content, created_by) VALUES (?, ?, ?, ?)',
      [
        company.id,
        'Welcome to KneaChat 👋',
        'This is the workspace hub. Managers and admins can publish company-wide announcements from the Announcements view — everyone gets notified instantly.',
        userIds['admin@kneachat.com'],
      ],
    );
    console.log('📢 Seeded a welcome announcement');
  }

  // ---- Notifications (a couple of unread so the bell shows activity) -------
  const unreadNotifications = [
    { user: 'admin@kneachat.com', actor: 'maya@kneachat.com', type: 'new_message', title: 'Maya Chen', message: 'Yes — typing, presence dots and the connection status are all wired to WebSocket events now.' },
    { user: 'admin@kneachat.com', actor: 'dara@kneachat.com', type: 'new_message', title: 'Dara Sok', message: 'Morning! The team shipped the dashboard improvements. Want a quick walkthrough?' },
    { user: 'maya@kneachat.com', actor: 'admin@kneachat.com', type: 'new_message', title: 'KneaChat Admin', message: 'Nice work, Maya. Does it handle typing indicators too?' },
  ];
  for (const n of unreadNotifications) {
    await query(
      `INSERT INTO notifications (user_id, actor_id, type, title, message, is_read)
       SELECT ?, ?, ?, ?, ?, 0
       WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ? AND title = ? AND is_read = 0 LIMIT 1)`,
      [userIds[n.user], userIds[n.actor], n.type, n.title, n.message, userIds[n.user], n.title],
    );
  }

  console.log('');
  console.log('✅ Seed complete!');
  console.log('   Demo login (any account):');
  console.log('   • super@kneachat.com  / kneachat168  (Super Admin — /platform)');
  console.log('   • admin@kneachat.com  / kneachat168');
  console.log('   • dara@kneachat.com   / kneachat168');
  console.log('   • maya@kneachat.com   / kneachat168');
}

main()
  .catch((error) => {
    console.error('❌ Seeding failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const connection = require('../dist/src/database/connection');
    const { pool } = connection.default || connection;
    await pool.end();
  });
