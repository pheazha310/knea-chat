#!/usr/bin/env node
/**
 * KneaChat — Team files & sharing feature end-to-end check (no browser).
 *
 * Exercises the file module against a live backend (:8080) with the seeded
 * demo users:
 *
 *   maya (employee)      → company upload (public), team upload (private to
 *                          the team), share a company file with a team, list
 *                          shares, unshare.
 *   second employee      → can open the team file area + read team files.
 *   outsider employee    → blocked from team files entirely.
 *   dara (manager)       → can read any team's files in the company.
 *
 * Sets up its own team + memberships via SQL and cleans everything up,
 * including the uploaded files on disk.
 *
 * Requirements: a running backend (:8080) with seeded demo users, the
 * shared-files tables (migration 013) and team files (migration 019).
 *
 * Usage:
 *   npm run test:e2e:files
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const MARKER = `sf-${process.pid}-${Date.now().toString(36)}`;

const MAYAS_EMAIL = 'maya@kneachat.com'; // employee
const DARAS_EMAIL = 'dara@kneachat.com'; // manager

let passed = 0;
let failed = 0;
const createdFiles = []; // { id, url, disk } for cleanup
let embedConvId = null; // conversation used by the embed check

function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function section(title) {
  console.log(`\n── ${title} ─${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}

async function login(email) {
  const { status, json } = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email} (HTTP ${status}): ${JSON.stringify(json)}`);
  }
  return json.data;
}

/** Upload a small text file (multipart) with optional extra form fields. */
async function upload(token, fields = {}) {
  const form = new FormData();
  form.append('file', new Blob(['kneachat e2e content'], { type: 'text/plain' }), `${MARKER}.txt`);
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  const res = await fetch(`${API_BASE}/api/shared-files/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}

async function main() {
  console.log('KneaChat E2E — team files & sharing');
  console.log(`  API : ${API_BASE}`);
  console.log(`  mark: ${MARKER}`);

  section('Preflight');
  let health;
  try {
    health = await api('/api/health');
  } catch {
    health = { status: 0 };
  }
  if (health.status !== 200) {
    console.log(`  ❌ Cannot reach KneaChat API at ${API_BASE}/api/health`);
    console.log('     Start the backend first: cd server && npm run dev');
    process.exit(1);
  }
  console.log('  ✅ Server is up');

  section('Authentication');
  const maya = await login(MAYAS_EMAIL);
  const dara = await login(DARAS_EMAIL);
  const mayaToken = maya.token;
  const daraToken = dara.token;
  const mayaId = maya.user.id;
  check(`maya logged in (id ${mayaId})`, !!mayaToken);
  check(`dara logged in (id ${dara.user.id})`, !!daraToken);

  // ---------------------------------------------------------------- setup
  section('Setup (SQL)');
  let teamId;
  let secondEmpId = null;
  let outsiderId = null;
  let secondToken = null;
  let outsiderToken = null;
  let secondEmail = null;
  let outsiderEmail = null;
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;

    // Clean up leftovers of previous e2e runs (marker-based).
    await db.query(
      `DELETE fs FROM file_shares fs
       JOIN shared_files sf ON sf.id = fs.file_id
       WHERE sf.file_name LIKE ?`, ['sf-%']);
    await db.query('DELETE FROM shared_files WHERE file_name LIKE ?', ['sf-%']);
    await db.query(
      `DELETE tm FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE t.name LIKE ?`, ['E2E Team %']);
    await db.query('DELETE FROM teams WHERE name LIKE ?', ['E2E Team %']);

    // Fresh team + members for this run.
    const teamInsert = await db.query(
      `INSERT INTO teams (company_id, name, description, created_by)
       VALUES (?, ?, 'e2e team', ?)`,
      [maya.user.company_id, `E2E Team ${MARKER}`, dara.user.id],
    );
    teamId = teamInsert.insertId;

    // Second employee (team member) and an outsider employee.
    const others = await db.query(
      `SELECT id, email FROM users WHERE company_id = ? AND role = 'employee' AND id <> ? LIMIT 2`,
      [maya.user.company_id, mayaId],
    );
    secondEmpId = others[0]?.id || null;
    secondEmail = others[0]?.email || null;
    outsiderId = others[1]?.id || null;
    outsiderEmail = others[1]?.email || null;
    if (secondEmpId) {
      await db.query('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', [teamId, secondEmpId, 'member']);
      secondToken = (await login(secondEmail)).token;
    }
    if (outsiderId) {
      outsiderToken = (await login(outsiderEmail)).token;
    }
    await db.query('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', [teamId, mayaId, 'member']);
    console.log(`  ✅ Team #${teamId} ready (maya=${mayaId}, member=${secondEmpId || 'none'}, outsider=${outsiderId || 'none'})`);
  } catch (error) {
    console.warn(`  ⚠  Setup SQL skipped: ${error.message}`);
  }

  if (!teamId) {
    console.log('  ❌ Cannot create the e2e team — aborting');
    process.exitCode = 1;
    return;
  }

  // ----------------------------------------------------- company upload
  section('Company uploads stay public');
  const companyUpload = await upload(mayaToken, { is_public: 'true' });
  const companyFile = companyUpload.json?.data?.file;
  check('maya uploads a public company file (201)', companyUpload.status === 201 && !!companyFile, `status ${companyUpload.status}`);
  if (companyFile) {
    check('company file has no team', companyFile.team_id === null, `team_id ${companyFile.team_id}`);
    check('company file is public', companyFile.is_public === true || companyFile.is_public === 1, `is_public ${companyFile.is_public}`);
    createdFiles.push({ id: companyFile.id, url: companyFile.file_url, disk: true });
  }

  // ------------------------------------------------------- team upload
  section('Team uploads stay inside the team');
  const strangerTeamUpload = await upload(mayaToken, { team_id: teamId });
  check('maya is a member, so the team upload succeeds', strangerTeamUpload.status === 201, `status ${strangerTeamUpload.status}`);

  // Remove maya from the team to verify the guard, then re-add.
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    await db.query('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, mayaId]);
  } catch (error) {
    console.warn(`  ⚠  SQL skipped: ${error.message}`);
  }
  const nonMemberUpload = await upload(mayaToken, { team_id: teamId });
  check('non-member upload to a team is rejected (400)', nonMemberUpload.status === 400 && /team members/.test(nonMemberUpload.json?.message || ''), `status ${nonMemberUpload.status} — ${nonMemberUpload.json?.message}`);

  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    await db.query('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', [teamId, mayaId, 'member']);
  } catch (error) {
    console.warn(`  ⚠  SQL skipped: ${error.message}`);
  }
  const teamUpload = await upload(mayaToken, { team_id: teamId });
  const teamFile = teamUpload.json?.data?.file;
  check('maya (member) uploads a team file (201)', teamUpload.status === 201 && !!teamFile, `status ${teamUpload.status}`);
  if (teamFile) {
    check('team file is scoped to the team', teamFile.team_id === teamId, `team_id ${teamFile.team_id}`);
    check('team file is NOT public (never leaks company-wide)', !teamFile.is_public, `is_public ${teamFile.is_public}`);
    createdFiles.push({ id: teamFile.id, url: teamFile.file_url, disk: true });
  }

  // ------------------------------------------------- team files listing
  section('Team file area access');
  if (secondEmpId && secondToken) {
    const memberList = await api(`/api/shared-files/team/${teamId}`, { token: secondToken });
    check('team member lists the team files', memberList.status === 200 && (memberList.json?.data?.files || []).some((f) => f.id === teamFile?.id), `status ${memberList.status}`);
    const readTeamFile = await api(`/api/shared-files/${teamFile.id}`, { token: secondToken });
    check('team member can open the private team file', readTeamFile.status === 200 && readTeamFile.json?.data?.file?.id === teamFile?.id, `status ${readTeamFile.status}`);
  } else {
    check('team member lists the team files', false, 'no second employee available');
  }

  if (outsiderId && outsiderToken) {
    const outsiderList = await api(`/api/shared-files/team/${teamId}`, { token: outsiderToken });
    check('outsider employee cannot list team files (400)', outsiderList.status === 400 && /must be a member/.test(outsiderList.json?.message || ''), `status ${outsiderList.status}`);
    const outsiderRead = await api(`/api/shared-files/${teamFile.id}`, { token: outsiderToken });
    check('outsider cannot open the private team file (400)', outsiderRead.status === 400, `status ${outsiderRead.status}`);
  } else {
    check('outsider employee cannot list team files (400)', false, 'no outsider employee available');
  }

  const managerList = await api(`/api/shared-files/team/${teamId}`, { token: daraToken });
  check('manager can list any team\u2019s files', managerList.status === 200 && (managerList.json?.data?.files || []).some((f) => f.id === teamFile?.id), `status ${managerList.status}`);

  // ------------------------------------------------- embed as chat message
  section('Embedding a file into a conversation as a message');
  if (secondEmpId && secondToken) {
    // Find or create a direct conversation maya ↔ second employee.
    let convRes = await api('/api/conversations/direct', {
      method: 'POST',
      token: mayaToken,
      body: { userId: secondEmpId },
    });
    let convId = convRes.json?.data?.conversation?.id || convRes.json?.data?.conversationId;
    if (!convId) {
      try {
        const connection = require('../dist/src/database/connection');
        const db = connection.default || connection;
        const rows = await db.query(
          `SELECT c.id FROM conversations c
           JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
           JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
           WHERE c.type = 'direct' AND c.is_active = 1 LIMIT 1`,
          [mayaId, secondEmpId],
        );
        convId = rows[0]?.id || null;
      } catch (error) {
        console.warn(`  ⚠  Conversation lookup skipped: ${error.message}`);
      }
    }
    if (!convId) {
      check('embed: created/found a direct conversation', false, 'conversation unavailable');
    } else {
      embedConvId = convId;
      check('embed: conversation ready', true, `conv #${convId}`);

      const embed = await api(`/api/shared-files/${companyFile?.id}/embed`, {
        method: 'POST',
        token: mayaToken,
        body: { conversation_id: convId },
      });
      const em = embed.json?.data;
      check('embed returns 201 with a file-type message', embed.status === 201 && em?.message?.type === 'file', `status ${embed.status} — ${embed.json?.message}`);
      check('embedded message carries the file attachment', (em?.message?.attachments || []).some((a) => a.file_url === companyFile?.file_url), `attachments ${(em?.message?.attachments || []).length}`);
      check('embed grants the conversation access (share row)', em?.share?.target_type === 'conversation' && em?.share?.target_id === convId);

      const shareList = await api(`/api/shared-files/${companyFile?.id}/shares`, { token: mayaToken });
      check('share list includes the conversation destination', (shareList.json?.data?.shares || []).some((s) => s.target_type === 'conversation' && s.target_id === convId));

      // Recipient (second employee) sees the message in the conversation.
      const convMessages = await api(`/api/conversations/${convId}/messages`, { token: secondToken });
      const found = (convMessages.json?.data?.messages || []).find((m) => m.id === em?.message?.id);
      check('recipient sees the embedded file message', !!found && (found?.attachments || []).some((a) => a.file_url === companyFile?.file_url), `messages ${(convMessages.json?.data?.messages || []).length}`);
    }
  } else {
    check('embed: created/found a direct conversation', false, 'no second employee available');
  }

  // ----------------------------------------------------------- sharing
  section('Sharing a company file with the team');
  const shareAttempt = await api(`/api/shared-files/${companyFile.id}/shares`, {
    method: 'POST',
    token: mayaToken,
    body: { target_type: 'team', target_id: teamId },
  });
  check('owner shares the file with the team (201)', shareAttempt.status === 201 && shareAttempt.json?.data?.share?.target_id === teamId, `status ${shareAttempt.status}`);

  const shares = await api(`/api/shared-files/${companyFile.id}/shares`, { token: mayaToken });
  const teamShare = (shares.json?.data?.shares || []).find((s) => s.target_type === 'team' && s.target_id === teamId);
  check('share list shows the team destination', shares.status === 200 && !!teamShare, `status ${shares.status}`);
  const shareId = teamShare?.id;

  if (outsiderId && outsiderToken) {
    const outsiderUnshare = await api(`/api/shared-files/${companyFile.id}/shares/${shareId}`, { method: 'DELETE', token: outsiderToken });
    check('outsider cannot unshare (400)', outsiderUnshare.status === 400, `status ${outsiderUnshare.status}`);
  }

  const badType = await api(`/api/shared-files/${companyFile.id}/shares`, {
    method: 'POST',
    token: mayaToken,
    body: { target_type: 'channel', target_id: teamId },
  });
  check('invalid share target type rejected', badType.status === 400 && /target_type/.test(badType.json?.message || ''), `status ${badType.status}`);

  const unshare = await api(`/api/shared-files/${companyFile.id}/shares/${shareId}`, { method: 'DELETE', token: mayaToken });
  check('owner unshares the file', unshare.status === 200, `status ${unshare.status}`);
  const sharesAfter = await api(`/api/shared-files/${companyFile.id}/shares`, { token: mayaToken });
  const stillTeamShared = (sharesAfter.json?.data?.shares || []).some((s) => s.target_type === 'team' && s.target_id === teamId);
  check('team destination removed after unshare', !stillTeamShared);

  // -------------------------------------------------------- permissions
  section('Role scoping');
  const outsiderList2 = outsiderId && outsiderToken
    ? await api(`/api/shared-files/team/${teamId}`, { token: outsiderToken })
    : null;
  check('team files stay scoped for outsiders', !outsiderList2 || outsiderList2.status === 400, `status ${outsiderList2?.status}`);

  console.log(`\n${'═'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 ALL TEAM-FILES & SHARING CHECKS PASSED (${passed} checks)`);
  } else {
    console.log(`❌ ${failed} check(s) failed, ${passed} passed`);
  }
}

async function cleanup() {
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;

    // Remove uploaded files from disk (best effort, before rows are gone).
    for (const file of createdFiles) {
      if (file.disk && file.url) {
        const diskPath = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads', path.basename(file.url));
        fs.unlink(diskPath, () => {});
      }
    }
    await db.query('DELETE FROM shared_files WHERE file_name LIKE ?', ['sf-%']);
    // Messages embedded by e2e runs + their notifications (attachments FK
    // first, then messages, then notifications pointing at the conversation).
    await db.query(
      `DELETE a FROM attachments a
       JOIN messages m ON m.id = a.message_id
       WHERE m.content LIKE ?`, ['sf-%']);
    await db.query('DELETE FROM notifications WHERE message LIKE ?', ['sf-%']);
    await db.query('DELETE FROM messages WHERE content LIKE ?', ['sf-%']);
    if (embedConvId) {
      await db.query('DELETE FROM notifications WHERE CAST(JSON_UNQUOTE(JSON_EXTRACT(data, \'$.conversationId\')) AS UNSIGNED) = ?', [embedConvId]);
      await db.query('DELETE FROM conversation_members WHERE conversation_id = ?', [embedConvId]);
      await db.query('DELETE FROM conversations WHERE id = ?', [embedConvId]);
    }
    await db.query(
      `DELETE tm FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE t.name LIKE ?`, ['E2E Team %']);
    await db.query('DELETE FROM teams WHERE name LIKE ?', ['E2E Team %']);
    await db.pool.end().catch(() => {});
    console.log('  🧹 Cleaned up all team-file/sharing test rows');
  } catch (error) {
    console.warn(`  ⚠  SQL cleanup skipped: ${error.message}`);
  }
}

main()
  .catch((error) => {
    console.error('\n❌ E2E script error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    process.exit(process.exitCode || (passed > 0 && failed === 0 ? 0 : 1));
  });
