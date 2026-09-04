/**
 * KneaChat — Real company data importer.
 *
 * Creates a NEW company (separate from the demo data) with your real
 * departments, users, teams and channels. Demo accounts are left untouched.
 *
 * JSON format (full import):
 *   node import-company.js path/to/company.json
 *
 * CSV format (users only; create teams/channels in the Admin UI):
 *   node import-company.js path/to/users.csv --company "Acme Inc."
 *
 * Every created user gets the password you provide per person. If a password
 * is missing, a random one is generated — a summary of all emails + passwords
 * is printed at the end so you can hand out credentials.
 *
 * Idempotent: safe to run repeatedly; existing companies/users/teams/channels
 * are matched by domain / email / (company, name) and never duplicated.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connection = require('../dist/src/database/connection');
const { query } = connection.default || connection;

const VALID_ROLES = ['super_admin', 'admin', 'manager', 'employee'];

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith('--'));
const companyNameArg = argValue(args, '--company') || argValue(args, '--company-name');
const domainArg = argValue(args, '--domain');

function argValue(argsList, flag) {
  const i = argsList.indexOf(flag);
  return i > -1 && argsList[i + 1] ? argsList[i + 1] : null;
}

async function findOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

function randomPassword() {
  return `Knea!${crypto.randomBytes(4).toString('hex')}`;
}

async function ensureCompany(name, domain) {
  let company = await findOne('SELECT id, name FROM companies WHERE domain = ? LIMIT 1', [domain]);
  if (!company) {
    // Imported companies get the Enterprise plan so real workloads are never
    // capped by the Free-plan seat limit (Administration module).
    const result = await query(
      "INSERT INTO companies (name, domain, plan_key) VALUES (?, ?, 'enterprise')",
      [name, domain],
    );
    company = { id: result.insertId, name };
    console.log(`🏢 Created company "${name}" (${domain}) — Enterprise plan`);
  } else {
    console.log(`🏢 Using existing company "${company.name}" (${domain})`);
  }
  return company;
}

async function ensureDepartment(companyId, name) {
  let dept = await findOne(
    'SELECT id FROM departments WHERE company_id = ? AND name = ? LIMIT 1',
    [companyId, name],
  );
  if (!dept) {
    const result = await query(
      'INSERT INTO departments (company_id, name, description) VALUES (?, ?, ?)',
      [companyId, name, `${name} department`],
    );
    dept = { id: result.insertId };
    console.log(`🗂  Created department "${name}"`);
  }
  return dept.id;
}

async function main() {
  if (!fileArg) {
    console.error(
      'Usage:\n  node import-company.js company.json\n  node import-company.js users.csv --company "Acme Inc."',
    );
    process.exitCode = 1;
    return;
  }

  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const isCsv = filePath.toLowerCase().endsWith('.csv');

  // ---- Load input ----------------------------------------------------------
  let data;
  if (isCsv) {
    if (!companyNameArg) {
      console.error('❌ CSV import requires --company "Your Company Name"');
      process.exitCode = 1;
      return;
    }
    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const headers = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
      const row = {};
      headers.forEach((h, i) => (row[h] = cells[i] ?? ''));
      return row;
    });
    const firstEmail = rows.find((r) => r.email)?.email || '';
    data = {
      company: { name: companyNameArg, domain: domainArg || firstEmail.split('@')[1] || 'company.com' },
      users: rows.map((r) => ({
        first_name: r.first_name || r.firstname,
        last_name: r.last_name || r.lastname,
        email: r.email,
        password: r.password || '',
        role: r.role || 'employee',
        department: r.department || r.dept || '',
        job_title: r.job_title || r.jobtitle || '',
      })),
      teams: [],
      channels: [],
    };
  } else {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  const companyData = data.company || {};
  const companyName = companyData.name || companyNameArg || 'My Company';
  const companyDomain = companyData.domain || domainArg || 'company.com';

  const rawUsers = Array.isArray(data.users) ? data.users : [];
  const teams = Array.isArray(data.teams) ? data.teams : [];
  const channels = Array.isArray(data.channels) ? data.channels : [];

  if (rawUsers.length === 0) {
    console.error('❌ No users provided in the data file.');
    process.exitCode = 1;
    return;
  }

  // ---- Company + departments ----------------------------------------------
  const company = await ensureCompany(companyName, companyDomain);
  const departmentNames = [...new Set(rawUsers.map((u) => u.department).filter(Boolean))];
  const departments = {};
  for (const name of departmentNames) {
    departments[name] = await ensureDepartment(company.id, name);
  }

  // ---- Users ---------------------------------------------------------------
  const userIds = {};
  const credentials = [];
  for (const u of rawUsers) {
    if (!u.email) {
      console.warn(`⚠️  Skipping a user without an email: ${JSON.stringify(u)}`);
      continue;
    }
    const email = u.email.trim().toLowerCase();
    const role = VALID_ROLES.includes(u.role) ? u.role : 'employee';
    if (u.role && !VALID_ROLES.includes(u.role)) {
      console.warn(`⚠️  "${email}": unknown role "${u.role}" — using "employee"`);
    }

    let user = await findOne('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (!user) {
      const password = u.password || randomPassword();
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await query(
        `INSERT INTO users (company_id, department_id, first_name, last_name, email, password, role, job_title, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offline', 1)`,
        [
          company.id,
          u.department && departments[u.department] ? departments[u.department] : null,
          u.first_name,
          u.last_name,
          email,
          passwordHash,
          role,
          u.job_title || null,
        ],
      );
      user = { id: result.insertId };
      console.log(`👤 Created user ${email} (${role})`);
      credentials.push({ email, password, name: `${u.first_name} ${u.last_name}`.trim() });
    } else {
      console.log(`👤 ${email} already exists — skipped`);
    }
    userIds[email] = user.id;
  }

  if (credentials.length === 0) {
    console.log('ℹ️  No new users were created (all emails already existed).');
  }

  // ---- Teams ---------------------------------------------------------------
  const teamIds = {};
  for (const t of teams) {
    const name = t.name;
    if (!name) continue;
    const managerEmail = (t.manager || '').toLowerCase();
    const creatorId = userIds[managerEmail] || Object.values(userIds)[0];

    let team = await findOne(
      'SELECT id FROM teams WHERE company_id = ? AND name = ? LIMIT 1',
      [company.id, name],
    );
    if (!team) {
      const result = await query(
        'INSERT INTO teams (company_id, department_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)',
        [
          company.id,
          t.department && departments[t.department] ? departments[t.department] : null,
          name,
          t.description || `${name} team`,
          creatorId,
        ],
      );
      team = { id: result.insertId };
      console.log(`👥 Created team "${name}"`);
    }
    teamIds[name] = team.id;

    const memberEmails = [...new Set([managerEmail, ...(t.members || [])].filter(Boolean))].map((e) => e.toLowerCase());
    for (const email of memberEmails) {
      if (!userIds[email]) {
        console.warn(`⚠️  Team "${name}": member ${email} is not in the user list — skipped`);
        continue;
      }
      const role = email === managerEmail ? 'leader' : 'member';
      await query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role)`,
        [team.id, userIds[email], role],
      );
    }
  }

  // ---- Channels ------------------------------------------------------------
  const channelIds = {};
  for (const c of channels) {
    const name = (c.name || '').toLowerCase().replace(/\s+/g, '-');
    if (!name) continue;
    const creatorEmail = (c.creator || rawUsers[0]?.email || '').toLowerCase();
    const creatorId = userIds[creatorEmail] || Object.values(userIds)[0];

    let channel = await findOne(
      'SELECT id FROM channels WHERE company_id = ? AND name = ? LIMIT 1',
      [company.id, name],
    );
    if (!channel) {
      const result = await query(
        'INSERT INTO channels (company_id, team_id, name, description, type, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [
          company.id,
          c.team && teamIds[c.team] ? teamIds[c.team] : null,
          name,
          c.description || '',
          c.type === 'private' ? 'private' : 'public',
          creatorId,
        ],
      );
      channel = { id: result.insertId };
      console.log(`📢 Created channel #${name}`);
    }
    channelIds[name] = channel.id;

    await query(
      `INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, 'admin')
       ON DUPLICATE KEY UPDATE role = 'admin'`,
      [channel.id, creatorId],
    );
    const joiners =
      c.members === 'all'
        ? Object.keys(userIds)
        : Array.isArray(c.members)
          ? c.members.map((e) => e.toLowerCase()).filter((e) => userIds[e])
          : c.team && teamIds[c.team]
            ? (
                await query('SELECT user_id FROM team_members WHERE team_id = ?', [teamIds[c.team]])
              ).map((r) => r.user_id)
            : [];
    for (const emailOrId of joiners) {
      const uid = typeof emailOrId === 'number' ? emailOrId : userIds[emailOrId];
      if (!uid) continue;
      await query('INSERT IGNORE INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)', [
        channel.id,
        uid,
        'member',
      ]);
    }
  }

  // ---- Team conversations (one shared room per team) -----------------------
  for (const t of teams) {
    const name = t.name;
    if (!name || !teamIds[name]) continue;
    const memberEmails = [...new Set([(t.manager || '').toLowerCase(), ...(t.members || []).map((e) => e.toLowerCase())].filter(Boolean))]
      .filter((e) => userIds[e]);
    if (memberEmails.length === 0) continue;

    let conv = await findOne(
      'SELECT id FROM conversations WHERE type = ? AND name = ? LIMIT 1',
      ['team', name],
    );
    if (!conv) {
      const result = await query(
        'INSERT INTO conversations (type, created_by, name, description) VALUES (?, ?, ?, ?)',
        ['team', userIds[memberEmails[0]], name, `${name} conversation`],
      );
      conv = { id: result.insertId };
      console.log(`💬 Created team conversation "${name}"`);
    }
    for (const email of memberEmails) {
      await query(
        'INSERT IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
        [conv.id, userIds[email], email === memberEmails[0] ? 'admin' : 'member'],
      );
    }
  }

  // ---- Summary -------------------------------------------------------------
  console.log('');
  console.log('✅ Import complete!');
  console.log(`   Company: ${companyName} (${companyDomain}) — id ${company.id}`);
  console.log(`   Users created: ${credentials.length} | Departments: ${departmentNames.length} | Teams: ${teams.length} | Channels: ${channels.length}`);
  if (credentials.length > 0) {
    console.log('');
    console.log('   Credentials to distribute (email / password):');
    for (const c of credentials) {
      console.log(`   • ${c.email}  /  ${c.password}${c.name ? `   (${c.name})` : ''}`);
    }
    console.log('');
    console.log('   ⚠️  Share these privately — users should change their password after first login.');
  }
  if (rawUsers.some((u) => u.role === 'admin') || rawUsers.some((u) => u.role === 'super_admin')) {
    console.log('   Admins can log in and manage everything from the "Admin" console.');
  }
}

main()
  .catch((error) => {
    console.error('❌ Import failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const connection = require('../dist/src/database/connection');
    const { pool } = connection.default || connection;
    await pool.end();
  });
