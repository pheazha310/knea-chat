#!/usr/bin/env node
/**
 * KneaChat — Announcements UI browser E2E (drives a real browser via CDP).
 *
 * Exercises the SRS FR-24 announcements flow end to end against a real,
 * seeded backend + client:
 *
 *   Admin session
 *     1. Sidebar navigation to the Announcements view
 *     2. Publish an (unpinned) company announcement → appears with the
 *        "Company" scope chip and "0 / N read" progress
 *     3. Publish a PINNED company announcement → pin icon + amber card,
 *        and after a fresh load it sorts ABOVE older announcements
 *     4. Schedule a future announcement → "Scheduled" badge, no read chip;
 *        a far-future one stays a draft (visible to managers only)
 *     5. Department + team targeted announcements (audience pickers) render
 *        with "Department · X" / "Team · X" chips
 *     6. Edit an announcement (title change persists)
 *     7. Open (read) the pinned announcement → "New" badge clears and the
 *        read chip advances; "Seen by" lists the reader (read confirmation)
 *     8. The short-future scheduled announcement goes LIVE on its own — the
 *        "Scheduled" badge disappears and the read chip appears, delivered
 *        over WebSocket without a reload (server scheduler tick)
 *
 *   Employee session (Maya Chen)
 *     9. No composer (canPublish = false)
 *    10. Sees company-wide + her own department + her own team announcements,
 *        but NOT announcements aimed at other departments/teams, and not the
 *        unpublished scheduled draft
 *    11. Reads the pinned announcement → "Seen by" later shows 2 readers
 *
 *   Admin session #2
 *    12. "Seen by" modal lists Admin + Maya with read timestamps
 *    13. Delete one announcement via the two-step confirm → card disappears
 *
 * Console errors and uncaught page exceptions are collected and reported.
 * Any announcements it created are deleted through the API at the end, so a
 * seeded database stays clean.
 *
 * Requirements: backend on :8080 (seeded demo data), client dev server on
 * :3000, and Google Chrome. No extra npm dependencies (uses Node >= 22
 * built-ins).
 *
 * Usage:
 *   node e2e/announcements-browser.e2e.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080/api';
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9334);
const CDP_BASE = `http://127.0.0.1:${DEBUG_PORT}`;

const ADMIN_LABEL = 'Admin demo';
const EMPLOYEE_LABEL = 'Employee demo';
const ADMIN_EMAIL = 'admin@kneachat.com';
const EMPLOYEE_EMAIL = 'maya@kneachat.com';
const PASSWORD = 'kneachat168';

/** Run-unique suffix so repeated runs never collide. */
const TS = Date.now();
const T = (s) => `[E2E] ${s} ${TS}`;

const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = candidates.find((c) => c && fs.existsSync(c));
if (!CHROME) {
  console.error('✗ Chrome not found — set CHROME_BIN to your Chrome executable.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const ok = (label) => { passed += 1; console.log(`  ✔ ${label}`); };
const bad = (label, err) => {
  const msg = err && err.message ? err.message : String(err);
  failed += 1;
  console.error(`  ✘ ${label}\n      ${msg.slice(0, 500)}`);
};

// ---------------------------------------------------------------------------
// API helpers (data discovery + cleanup)
// ---------------------------------------------------------------------------
async function api(method, urlPath, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status}: ${json?.message || res.statusText}`);
  return json;
}

let adminToken = null;
async function apiLogin(email) {
  const res = await api('POST', '/auth/login', null, { email, password: PASSWORD });
  return res.data.token;
}

// ---------------------------------------------------------------------------
// Launch Chrome + minimal CDP client (same pattern as search-browser.e2e.js)
// ---------------------------------------------------------------------------
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-announce-'));
let chrome;
async function launchChrome() {
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${CDP_BASE}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not open its debugging port');
}

let ws;
const pending = new Map();
const listeners = new Map();
const consoleIssues = [];
const pageErrors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = 1 + Math.floor(Math.random() * 1e9);
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function on(method, fn) {
  if (!listeners.has(method)) listeners.set(method, []);
  listeners.get(method).push(fn);
}

async function connect() {
  const res = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const target = await res.json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error(`ws error: ${e.message || ''}`));
  });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(String(data));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message || 'CDP error'} ${JSON.stringify(m.error.data || '')}`.trim()));
      else resolve(m.result || {});
      return;
    }
    if (m.method && listeners.has(m.method)) {
      for (const fn of listeners.get(m.method)) fn(m.params || {});
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') {
      const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300);
      consoleIssues.push(`[console.${p.type}] ${text}`);
    }
  });
  on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    pageErrors.push((d.exception?.description || d.text || '').slice(0, 600));
  });
  on('Log.entryAdded', (p) => {
    if (p.entry && p.entry.level === 'error') consoleIssues.push(`[log] ${p.entry.text.slice(0, 300)}`);
  });
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(`page eval threw: ${(d.exception?.description || d.text || '').slice(0, 300)}`);
  }
  return r.result && r.result.value;
}

/** Serialize a function with JSON-stringified args into a page expression. */
const run = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);

async function waitFor(expr, { timeout = 20000, label = expr } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(expr)) return;
    } catch { /* expression may not be valid until the DOM is ready */ }
    await sleep(200);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

/**
 * JS (page-side) expression that locates an announcement card by its exact
 * title text. Interpolate into larger expressions.
 */
const cardExpr = (title) =>
  `[...document.querySelectorAll('.view-page article.list-card')].find(x => x.querySelector('h3 span.truncate')?.textContent?.trim() === ${JSON.stringify(title)})`;

/** Wait until a card with `title` exists and passes the `checks` snippet. */
const waitCard = (title, checks, { timeout = 20000, label = title } = {}) =>
  waitFor(`(() => { const c = ${cardExpr(title)}; if (!c) return false; const t = c.innerText; const cls = c.className; ${checks}; })()`,
    { timeout, label });

/** Current state of a card ({ text, cls }) or null. */
const getCard = (title) => evaluate(`(() => { const c = ${cardExpr(title)}; return c ? { text: c.innerText, cls: c.className } : null; })()`);

/** Titles of the announcement cards currently rendered, in DOM order. */
const cardTitles = () => evaluate(
  `[...document.querySelectorAll('.view-page article.list-card')].map(c => c.querySelector('h3 span.truncate')?.textContent?.trim() || null)`);

/** Inner text of every rendered card (used to find the seeded welcome card). */
const allCardsText = () => evaluate(
  `[...document.querySelectorAll('.view-page article.list-card')].map(c => c.innerText)`);

/** Inner text of the "Read confirmation" modal, or null when closed. */
const modalText = () => evaluate(`(() => {
  const o = [...document.querySelectorAll('.fixed')].find(el => el.className.includes('inset-0') && el.textContent.includes('Read confirmation'));
  return o ? o.innerText : null;
})()`);

const waitModal = (checks, { timeout = 20000, label = 'read confirmation modal' } = {}) =>
  waitFor(`(() => { const o = [...document.querySelectorAll('.fixed')].find(el => el.className.includes('inset-0') && el.textContent.includes('Read confirmation')); if (!o) return false; const t = o.innerText; ${checks}; })()`,
    { timeout, label });

const setField = (selector, value) => run((sel, val) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`field not found: ${sel}`);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  if (!setter || !setter.set) throw new Error(`cannot set value on ${sel}`);
  setter.set.call(el, val);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return true;
}, selector, value);

async function clickNav(label, { timeout = 15000 } = {}) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeout) {
    try {
      const done = await run((navLabel) => {
        const btn = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes(navLabel));
        if (!btn) return false;
        btn.click();
        return true;
      }, label);
      if (done) return;
      lastErr = new Error(`nav item not found: ${label}`);
    } catch (e) { lastErr = e; }
    await sleep(300);
  }
  if (DEBUG) {
    dump('nav state', await evaluate(`JSON.stringify({
      path: location.pathname,
      hasShell: !!document.querySelector('.workspace-shell'),
      hasSidebar: !!document.querySelector('.sidebar'),
      onLogin: !!document.querySelector('.auth-demo-btn'),
      navLabels: [...document.querySelectorAll('.nav-item')].slice(0, 12).map(b => b.textContent.trim()),
    })`));
  }
  throw lastErr || new Error(`nav item not found: ${label}`);
}

const clickButtonText = (containerSel, text) => run((sel, t) => {
  const root = sel ? document.querySelector(sel) : document;
  if (sel && !root) throw new Error(`container not found: ${sel}`);
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.trim().includes(t));
  if (!btn) throw new Error(`button not found (${t})`);
  btn.click();
  return true;
}, containerSel, text);

const openAnnouncements = () => clickNav('Announcements');

/** Login through the demo-account buttons and land on the dashboard. */
async function login(label) {
  await send('Page.navigate', { url: `${APP_URL}/login` });
  await waitFor(`!!document.querySelector('.auth-demo-btn')`, { label: 'login demo buttons', timeout: 60000 });
  await run((l) => {
    // Match the account whose label STARTS with the requested one — the demo
    // list has both "Super Admin demo" and "Admin demo", and a plain includes()
    // would grab the super admin for the admin request.
    const b = [...document.querySelectorAll('.auth-demo-btn')].find((x) => x.textContent.trim().startsWith(l));
    if (!b) throw new Error(`demo account button missing: ${l}`);
    b.click();
    return true;
  }, label);
  await waitFor(`location.pathname === '/dashboard' && !!document.querySelector('.workspace-shell')`,
    { label: `dashboard after ${label}`, timeout: 40000 });
}

/** Sign out through the profile popover. */
async function logout() {
  await run(() => {
    const profile = document.querySelector('.profile-button');
    if (!profile) throw new Error('profile button missing');
    profile.click();
    return true;
  });
  await waitFor(`!!document.querySelector('.popover-danger')`, { label: 'profile popover' });
  await run(() => {
    const btn = document.querySelector('.popover-danger');
    if (!btn) throw new Error('sign out missing');
    btn.click();
    return true;
  });
  await waitFor(`location.pathname === '/login' || !!document.querySelector('.auth-demo-btn')`,
    { label: 'return to login', timeout: 30000 });
}

/** Format a Date for <input type="datetime-local"> (local time). */
const localInput = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Compose + submit an announcement through the manager composer.
 * opts: { scope: 'company'|'department'|'team', department?: name, team?: name,
 *         pinned?: bool, scheduleInMs?: number, expectButton }
 */
async function composeAnnouncement(title, content, opts = {}) {
  await clickButtonText(null, 'New announcement');
  await waitFor(`!!document.querySelector('.view-page form')`, { label: 'composer opened' });
  await setField('.view-page form input[placeholder="Title"]', title);
  await setField('.view-page form textarea', content);
  const scope = opts.scope || 'company';
  if (scope !== 'company') {
    await run((s) => {
      const form = document.querySelector('.view-page form');
      const btn = [...form.querySelectorAll('button')].find((b) => b.textContent.trim() === s);
      if (!btn) throw new Error(`scope button missing: ${s}`);
      btn.click();
      return true;
    }, scope === 'department' ? 'Department' : 'Team');
    await waitFor(`!!document.querySelector('.view-page form select')`, { label: `${scope} picker` });
    if (scope === 'department' && opts.department) {
      await setField('.view-page form select', String(opts.department));
    } else if (scope === 'team' && opts.team) {
      await setField('.view-page form select', String(opts.team));
    }
  }
  if (opts.pinned) {
    await run(() => {
      const cb = document.querySelector('.view-page form input[type="checkbox"]');
      if (!cb) throw new Error('pin checkbox missing');
      cb.click();
      return true;
    });
  }
  if (opts.scheduleInMs) {
    await run((v) => {
      const el = document.querySelector('.view-page form input[type="datetime-local"]');
      if (!el) throw new Error('schedule input missing');
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (!setter || !setter.set) throw new Error('cannot set schedule value');
      setter.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, localInput(new Date(Date.now() + opts.scheduleInMs)));
  }
  const expect = opts.expectButton || (opts.scheduleInMs ? 'Schedule' : 'Publish');
  await run((b) => {
    const form = document.querySelector('.view-page form');
    const btn = [...form.querySelectorAll('button')].find((x) => x.textContent.trim() === b);
    if (!btn) throw new Error(`submit button missing: ${b}`);
    if (btn.disabled) throw new Error(`submit button disabled: ${b}`);
    btn.click();
    return true;
  }, expect);
  await waitFor(`!document.querySelector('.view-page form')`, { label: `composer closed after "${title}"`, timeout: 15000 });
}

/** Click a card's action button (Seen by / Edit / Delete) by label text. */
const clickCardAction = (title, label) => run((t, l) => {
  const cards = [...document.querySelectorAll('.view-page article.list-card')];
  const c = cards.find((x) => x.querySelector('h3 span.truncate')?.textContent?.trim() === t);
  if (!c) throw new Error(`card not found: ${t}`);
  const btn = [...c.querySelectorAll('button')].find((b) => b.textContent.trim().includes(l));
  if (!btn) throw new Error(`action button missing on "${t}": ${l}`);
  btn.click();
  return true;
}, title, label);

/** Click a card's body (opens it → marks it read when unread). */
const clickCardBody = (title) => run((t) => {
  const cards = [...document.querySelectorAll('.view-page article.list-card')];
  const c = cards.find((x) => x.querySelector('h3 span.truncate')?.textContent?.trim() === t);
  if (!c) throw new Error(`card not found: ${t}`);
  c.click();
  return true;
}, title);

const closeModal = () => run(() => {
  const overlay = [...document.querySelectorAll('.fixed')].find((el) =>
    el.className.includes('inset-0') && el.textContent.includes('Read confirmation'));
  const close = overlay && overlay.querySelector('button[aria-label="Close"]');
  if (close) close.click();
  return true;
});

// ---- debug dumps (ANN_DEBUG=1) ---------------------------------------------
const DEBUG = !!process.env.ANN_DEBUG;
const dump = (label, payload) => { if (DEBUG) console.error(`\n──── [debug] ${label} ────\n${payload}\n────`); };
const dumpCardHtml = async (title) =>
  dump(`card \"${title}\" outerHTML`, await evaluate(`(() => { const c = ${cardExpr(title)}; return c ? c.outerHTML.slice(0, 1500) : 'CARD NOT FOUND'; })()`));
const dumpCardsSummary = async () =>
  dump('cards summary', JSON.stringify(await evaluate(
    `[...document.querySelectorAll('.view-page article.list-card')].map(c => ({ t: c.querySelector('h3 span.truncate')?.textContent?.trim(), text: c.innerText.slice(0, 180) }))`), null, 1));
const dumpModalHtml = async () =>
  dump('modal outerHTML', await evaluate(`(() => { const o = [...document.querySelectorAll('.fixed')].find(el => el.className.includes('inset-0') && el.textContent.includes('Read confirmation')); return o ? o.outerHTML.slice(0, 2500) : 'MODAL NOT FOUND'; })()`));
const connState = () => evaluate(`(() => { const p = document.querySelector('.connection-pill-label'); return p ? p.textContent.trim() : (document.querySelector('.reconnect-badge') ? 'RECONNECTING' : 'no-indicator'); })()`);

// ---------------------------------------------------------------------------
// Data discovery (direct API, admin token)
// ---------------------------------------------------------------------------
async function discover() {
  adminToken = await apiLogin(ADMIN_EMAIL);
  const usersRes = await api('GET', '/users', adminToken);
  const users = usersRes.data.users || usersRes.data || [];
  const admin = users.find((u) => u.email === ADMIN_EMAIL);
  const maya = users.find((u) => u.email === EMPLOYEE_EMAIL);
  if (!admin || !maya) throw new Error('seeded demo users not found — run npm run db:seed');

  const deptRes = await api('GET', '/departments', adminToken);
  const departments = deptRes.data.departments || deptRes.data || [];
  const teamRes = await api('GET', '/teams', adminToken);
  const teams = teamRes.data.teams || teamRes.data || [];

  // Which team(s) is maya a member of? (admin may read any team's members)
  const membership = {};
  for (const team of teams) {
    const m = await api('GET', `/teams/${team.id}/members`, adminToken);
    const memberList = m.data.members || m.data || [];
    membership[team.id] = memberList.some((u) => Number(u.id) === Number(maya.id));
  }

  const mayaDeptId = maya.department_id != null ? Number(maya.department_id) : null;
  const mayaDept = departments.find((d) => Number(d.id) === mayaDeptId) || null;
  const otherDept = departments.find((d) => Number(d.id) !== mayaDeptId) || null;
  const mayaTeam = teams.find((t) => membership[t.id]) || null;
  const otherTeam = teams.find((t) => !membership[t.id]) || null;

  return { users, admin, maya, departments, teams, mayaDept, otherDept, mayaTeam, otherTeam };
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Using Chrome: ${CHROME}`);
  const ctx = await discover();
  console.log(`App: ${APP_URL}  ·  API: ${API_URL}`);
  const mayaTeams = ctx.teams.filter((t) => ctx.membership?.[t.id]).map((t) => t.name).join(', ');
  console.log(`Context: admin=${ctx.admin.first_name} ${ctx.admin.last_name} (id ${ctx.admin.id}), ` +
    `maya=${ctx.maya.first_name} ${ctx.maya.last_name} (id ${ctx.maya.id}, dept ${ctx.mayaDept ? ctx.mayaDept.name : 'none'}), ` +
    `maya teams: ${mayaTeams || 'none'}\n`);

  await launchChrome();
  await connect();

  const adminName = `${ctx.admin.first_name} ${ctx.admin.last_name}`;
  const mayaName = `${ctx.maya.first_name} ${ctx.maya.last_name}`;

  // Titles created during the run (cleaned up at the end).
  const created = [];
  const titleCompany = T('Company notice');
  const titlePinned = T('Pinned notice');
  // NB: titles must NOT contain the word "Scheduled" — the flip assertion
  // keys on that word disappearing (the badge text, not the title).
  const titleSchedLive = T('Goes live soon');
  const titleSchedDraft = T('Far-future draft');
  const titleDept = T('Dept notice');
  const titleTeam = T('Team notice');
  const titleOtherDept = T('Other-dept notice');
  const titleOtherTeam = T('Other-team notice');

  // ------------------------------------------------------------------ ADMIN 1
  console.log('── Admin session (publish / pin / schedule / target / read) ──');
  try {
    await login(ADMIN_LABEL);
    ok(`Logs in as ${ADMIN_LABEL}`);
  } catch (e) { bad(`Logs in as ${ADMIN_LABEL}`, e); throw e; }

  try {
    await openAnnouncements();
    await waitFor(`!!document.querySelector('.view-page') && document.querySelector('.view-page h1')?.textContent?.trim() === 'Announcements'`,
      { label: 'Announcements view' });
    const hasComposer = await evaluate(
      `[...document.querySelectorAll('.view-page .btn-primary')].some(b => b.textContent.includes('New announcement'))`);
    if (!hasComposer) throw new Error('New announcement button missing for a manager');
    ok('Announcements view opens with the composer for a manager');
  } catch (e) { bad('Announcements view opens for a manager', e); }

  // Total audience size, read off the seeded welcome announcement's chip.
  let audienceTotal = null;
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && audienceTotal === null) {
      const texts = await allCardsText();
      const welcome = texts.find((t) => t.includes('Welcome to KneaChat'));
      const m = welcome && welcome.match(/(\d+) \/ (\d+) read/);
      if (m) audienceTotal = Number(m[2]);
      else await sleep(250);
    }
    if (!audienceTotal || audienceTotal < 1) throw new Error(`could not derive audience size, got ${audienceTotal}`);
    ok(`Seeded welcome announcement shows a read chip — audience size ${audienceTotal}`);
  } catch (e) { bad('Seed welcome announcement read chip', e); }

  // 2. Unpinned company announcement.
  try {
    await composeAnnouncement(titleCompany, `Company-wide body ${TS}`);
    await waitCard(titleCompany, `return true;`, { label: `card "${titleCompany}"` });
    const card = await getCard(titleCompany);
    if (!card.text.includes('Company')) throw new Error(`expected Company scope chip, got: ${card.text.slice(0, 120)}`);
    if (!new RegExp(`0 \\/ ${audienceTotal} read`).test(card.text)) throw new Error(`expected "0 / ${audienceTotal} read", got: ${card.text.slice(0, 160)}`);
    created.push(titleCompany);
    ok(`Publishes an unpinned company announcement (Company chip, "0 / ${audienceTotal} read")`);
  } catch (e) { bad('Publish unpinned company announcement', e); }

  // 3. Pinned announcement + server-side sort on reload.
  try {
    await composeAnnouncement(titlePinned, `Pinned body ${TS}`, { pinned: true });
    await waitCard(titlePinned, `return true;`, { label: `card "${titlePinned}"` });
    let card = await getCard(titlePinned);
    if (!card.cls.includes('amber')) throw new Error('pinned card missing amber border');
    if (!/new/i.test(card.text)) throw new Error('expected "New" badge on an unread pinned announcement');

    ok('Publishes a PINNED announcement (amber card, pin icon, "New" badge)');

    // Sign out + back in → the list is refetched from the server and rendered
    // in server order (pinned first). (A hard page reload proved flaky under
    // CDP, so the session cycle stands in for it.)
    await logout();
    await login(ADMIN_LABEL);
    await openAnnouncements();
    await waitFor(`!!document.querySelector('.view-page')`, { label: 'Announcements view after re-login' });
    await waitCard(titlePinned, `return true;`, { label: 'pinned card after re-login' });
    const titles = await cardTitles();
    if (titles[0] !== titlePinned) throw new Error(`expected pinned card first, got: ${titles.slice(0, 3).join(' | ')}`);
    ok('Pinned announcement sorts to the top on a fresh server load');
  } catch (e) {
    await dumpCardHtml(titlePinned);
    await dumpCardsSummary();
    bad('Pinned announcement + sort-to-top', e);
  }

  // 4. Scheduled announcements: one flips live soon, one stays a draft.
  try {
    // Badge checks are scoped to the h3 badge elements (NOT the card text) —
    // the content body may legitimately contain the word "scheduled".
    const hasSchedBadge = `[...c.querySelectorAll('h3 span')].some(s => /scheduled/i.test(s.textContent))`;
    await composeAnnouncement(titleSchedLive, `Scheduled body ${TS}`, { scheduleInMs: 90 * 1000 });
    await waitCard(titleSchedLive, `return ${hasSchedBadge} && !t.includes('read');`,
      { label: `card "${titleSchedLive}" with Scheduled badge` });
    created.push(titleSchedLive);
    ok('Schedules an announcement (~90s) — shows the Scheduled badge, no read chip');

    await composeAnnouncement(titleSchedDraft, `Draft body ${TS}`, { scheduleInMs: 12 * 60 * 60 * 1000 });
    await waitCard(titleSchedDraft, `return ${hasSchedBadge};`, { label: `card "${titleSchedDraft}"` });
    created.push(titleSchedDraft);
    ok('Schedules a far-future draft — still visible to managers with the Scheduled badge');
  } catch (e) {
    await dumpCardHtml(titleSchedLive);
    await dumpCardHtml(titleSchedDraft);
    await dumpCardsSummary();
    bad('Scheduled announcements', e);
  }

  // 5. Department + team targeting.
  try {
    if (ctx.mayaDept && ctx.otherDept && ctx.mayaTeam && ctx.otherTeam) {
      await composeAnnouncement(titleDept, `Dept body ${TS}`, { scope: 'department', department: ctx.mayaDept.id });
      await waitCard(titleDept, `return t.includes('Department · ${ctx.mayaDept.name}');`,
        { label: `card "${titleDept}" with dept chip` });
      created.push(titleDept);

      await composeAnnouncement(titleTeam, `Team body ${TS}`, { scope: 'team', team: ctx.mayaTeam.id });
      await waitCard(titleTeam, `return t.includes('Team · ${ctx.mayaTeam.name}');`,
        { label: `card "${titleTeam}" with team chip` });
      created.push(titleTeam);

      await composeAnnouncement(titleOtherDept, `Other-dept body ${TS}`, { scope: 'department', department: ctx.otherDept.id });
      await waitCard(titleOtherDept, `return true;`, { label: `card "${titleOtherDept}"` });
      created.push(titleOtherDept);

      await composeAnnouncement(titleOtherTeam, `Other-team body ${TS}`, { scope: 'team', team: ctx.otherTeam.id });
      await waitCard(titleOtherTeam, `return true;`, { label: `card "${titleOtherTeam}"` });
      created.push(titleOtherTeam);
      ok(`Targets announcements (${ctx.mayaDept.name} / ${ctx.mayaTeam.name} / ${ctx.otherDept.name} / ${ctx.otherTeam.name}) with scope chips`);
    } else {
      ok('Skipping department/team targeting — demo data lacks distinct departments/teams');
    }
  } catch (e) { bad('Department/team targeted announcements', e); }

  // 6. Edit an announcement.
  let titleCompanyEdited = null;
  try {
    await clickCardAction(titleCompany, 'Edit');
    await waitFor(`!!document.querySelector('.view-page form')`, { label: 'edit composer' });
    titleCompanyEdited = T('Company notice edited');
    await setField('.view-page form input[placeholder="Title"]', titleCompanyEdited);
    await run(() => {
      const form = document.querySelector('.view-page form');
      const btn = [...form.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save changes');
      if (!btn) throw new Error('Save changes button missing');
      btn.click();
      return true;
    });
    await waitFor(`!document.querySelector('.view-page form')`, { label: 'edit composer closed', timeout: 15000 });
    await waitCard(titleCompanyEdited, `return true;`, { label: `edited card "${titleCompanyEdited}"` });
    created.push(titleCompanyEdited);
    ok('Edits an announcement — the new title persists');
  } catch (e) { bad('Edit announcement', e); }

  // 7. Read confirmation (admin reads the pinned announcement).
  try {
    await clickCardBody(titlePinned);
    await waitCard(titlePinned, `return !/new/i.test(t) && (() => { const m = t.match(/(\\d+) \\/ ${audienceTotal} read/); return m && Number(m[1]) >= 1; })();`,
      { label: `pinned card read by admin (1 / ${audienceTotal})`, timeout: 15000 });
    ok(`Opening the pinned announcement marks it read ("1 / ${audienceTotal} read", "New" badge gone)`);

    await clickCardAction(titlePinned, 'Seen by');
    await waitModal(`return t.includes('have read') && t.includes('1 of') && t.includes(${JSON.stringify(adminName)}) && !t.includes('Loading…');`,
      { label: `"Seen by" shows ${adminName}`, timeout: 15000 });
    ok(`"Seen by" modal shows ${adminName} as a reader (1 of ${audienceTotal})`);
    await closeModal();
    await waitFor(`!document.body.innerText.includes('Read confirmation')`, { label: 'modal closed' });
  } catch (e) {
    await dumpModalHtml();
    await dumpCardHtml(titlePinned);
    await dumpCardsSummary();
    bad('Read confirmation (admin)', e);
  }

  // 8. Scheduled announcement flips live on its own (server scheduler + WS).
  const flipStartedAt = Date.now();
  try {
    await waitCard(titleSchedLive, `return ![...c.querySelectorAll('h3 span')].some(s => /scheduled/i.test(s.textContent)) && t.includes('0 / ${audienceTotal} read');`,
      { label: `"${titleSchedLive}" published live without reload`, timeout: 240000 });
    ok(`Scheduled announcement went live on its own (WebSocket, no reload) — now "0 / ${audienceTotal} read"`);
  } catch (e) {
    await dumpCardHtml(titleSchedLive);
    await dumpCardsSummary();
    dump('connection', await connState());
    const schedElapsed = Math.round((Date.now() - flipStartedAt) / 1000);
    try {
      const listRes = await api('GET', '/announcements', adminToken);
      const row = (listRes.data.announcements || []).find((a) => a.title === titleSchedLive);
      dump('scheduler timing', row
        ? `wait lasted ${schedElapsed}s · scheduled_at=${row.scheduled_at} · published_at=${row.published_at} · now=${new Date().toISOString()}`
        : `row gone? (wait lasted ${schedElapsed}s)`);
    } catch (apiErr) { dump('scheduler timing', `api err: ${apiErr.message}`); }
    bad('Scheduled announcement publishes live via scheduler', e);
  }

  try { await logout(); ok('Admin signs out'); } catch (e) { bad('Admin signs out', e); }

  // ------------------------------------------------------------------- MAYA
  console.log('── Employee session (scoped visibility + read confirmation) ──');
  try {
    await login(EMPLOYEE_LABEL);
    ok(`Logs in as ${EMPLOYEE_LABEL} (${mayaName})`);
  } catch (e) { bad(`Logs in as ${EMPLOYEE_LABEL}`, e); throw e; }

  try {
    await openAnnouncements();
    await waitFor(`!!document.querySelector('.view-page')`, { label: 'Announcements view (employee)' });
    const hasComposer = await evaluate(
      `[...document.querySelectorAll('.view-page .btn-primary')].some(b => b.textContent.includes('New announcement'))`);
    if (hasComposer) throw new Error('employee should not see the New announcement button');
    ok('Employee has no composer (canPublish=false)');
  } catch (e) { bad('Employee composer hidden', e); }

  try {
    // Company-wide ones always exist; department/team ones only when the demo
    // data allowed creating them in the admin session.
    const expectVisible = [titleCompanyEdited, titlePinned];
    if (created.includes(titleDept)) expectVisible.push(titleDept);
    if (created.includes(titleTeam)) expectVisible.push(titleTeam);
    for (const t of expectVisible) {
      await waitCard(t, `return true;`, { label: `employee sees "${t}"` });
    }
    ok('Employee sees company-wide + own-department + own-team announcements');

    // Anything targeted elsewhere must be absent.
    const expectHidden = [titleSchedDraft];
    if (created.includes(titleOtherDept)) expectHidden.push(titleOtherDept);
    if (created.includes(titleOtherTeam)) expectHidden.push(titleOtherTeam);
    for (const t of expectHidden) {
      await sleep(400); // let any late WS event settle before asserting absence
      const card = await getCard(t);
      if (card) throw new Error(`employee should NOT see: ${t}`);
    }
    ok('Employee does NOT see other-department / other-team / unpublished-draft announcements');
  } catch (e) { bad('Employee visibility scoping', e); }

  try {
    // Employee reads the pinned announcement → cross-user read confirmation.
    await clickCardBody(titlePinned);
    await waitCard(titlePinned, `return !/new/i.test(t) && (() => { const m = t.match(/(\\d+) \\/ ${audienceTotal} read/); return m && Number(m[1]) >= 2; })();`,
      { label: `employee read advances chip to 2 / ${audienceTotal}`, timeout: 15000 });
    ok(`Employee reading the announcement advances progress ("2 / ${audienceTotal} read")`);
  } catch (e) { bad('Employee read confirmation', e); }

  try { await logout(); ok('Employee signs out'); } catch (e) { bad('Employee signs out', e); }

  // ---------------------------------------------------------------- ADMIN 2
  console.log('── Admin session #2 (cross-user read ledger + delete) ──');
  try {
    await login(ADMIN_LABEL);
    await openAnnouncements();
    await waitFor(`!!document.querySelector('.view-page')`, { label: 'Announcements view' });
    await waitCard(titlePinned, `return true;`, { label: 'pinned card ready' });
    ok('Admin re-logs in and opens the Announcements view');
  } catch (e) { bad('Admin re-login', e); }

  try {
    await clickCardAction(titlePinned, 'Seen by');
    await waitModal(`return t.includes('2 of') && t.includes(${JSON.stringify(adminName)}) && t.includes(${JSON.stringify(mayaName)}) && !t.includes('Loading…');`,
      { label: `"Seen by" lists ${adminName} + ${mayaName}`, timeout: 15000 });
    ok(`"Seen by" now lists both readers (${adminName} + ${mayaName}, "2 of ${audienceTotal}")`);
    await closeModal();
    await waitFor(`!document.body.innerText.includes('Read confirmation')`, { label: 'modal closed' });
  } catch (e) {
    await dumpModalHtml();
    await dumpCardHtml(titlePinned);
    bad('Cross-user read confirmation ledger', e);
  }

  try {
    // Delete one announcement through the two-step confirm button.
    await clickCardAction(titleCompanyEdited, 'Delete');
    await waitFor(`document.body.innerText.includes('Confirm?')`, { label: 'delete armed' });
    await sleep(300);
    await clickCardAction(titleCompanyEdited, 'Confirm?');
    await waitFor(`!(${cardExpr(titleCompanyEdited)})`, { label: 'deleted card disappears', timeout: 15000 });
    const idx = created.indexOf(titleCompanyEdited);
    if (idx >= 0) created.splice(idx, 1);
    ok('Deletes an announcement via the two-step confirm — card disappears');
  } catch (e) { bad('Delete announcement via UI', e); }

  // ------------------------------------------------------------------ REPORT
  console.log('\n---- Console / page issues ----');
  const realIssues = [...consoleIssues, ...pageErrors].filter((t) =>
    !/favicon/i.test(t) && !/React DevTools/i.test(t) && !/Autofocus processing was blocked/i.test(t) && !/Download the React DevTools/i.test(t));
  if (realIssues.length === 0) console.log('  none');
  else for (const issue of realIssues.slice(0, 30)) console.log(`  • ${issue}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0 && realIssues.length === 0;
}

// ---------------------------------------------------------------------------
// Cleanup + exit
// ---------------------------------------------------------------------------
async function cleanup() {
  try {
    const token = adminToken || await apiLogin(ADMIN_EMAIL);
    const res = await api('GET', '/announcements', token);
    const mine = (res.data.announcements || []).filter((a) => String(a.title || '').startsWith('[E2E]'));
    for (const a of mine) {
      await api('DELETE', `/announcements/${a.id}`, token);
    }
    if (mine.length) console.log(`🧹 Deleted ${mine.length} E2E announcement(s) via API`);
  } catch (e) {
    console.error(`🧹 Cleanup failed (non-fatal): ${e.message}`);
  }
}

main()
  .then(async (allGood) => {
    await cleanup();
    process.exitCode = allGood ? 0 : 1;
  })
  .catch(async (e) => {
    console.error('Announcements browser E2E crashed:', e);
    await cleanup();
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => {
      try { chrome && chrome.kill(); } catch { /* ignore */ }
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }, 500);
  });
