#!/usr/bin/env node
/**
 * KneaChat — Global Search UI smoke test (drives a real browser via CDP).
 *
 * Logs in with a seeded demo account (SMOKE_ACCOUNT_LABEL, default "Admin"),
 * opens the Search view and exercises the SRS US-17 / FR-16 flows:
 *   1. Sidebar navigation to the Search view
 *   2. Debounced text query ("hello") → grouped overview with hit counts
 *   3. Expanding a scope tab and jumping into a message conversation
 *   4. A multi-scope query ("design") — opening a team chat the user may
 *      read, or confirming a non-member is blocked with the access toast
 *   5. Filter-only search (Person, then Person + File type)
 *   6. "Clear filters" returning to the intro state
 *
 * Console errors and uncaught page exceptions are collected and reported.
 *
 * Requirements: backend on :8080 (seeded), client dev server on :3000,
 * and Google Chrome. No extra npm dependencies (uses Node >= 22 built-ins).
 *
 * Usage:
 *   node e2e/search-browser.e2e.js
 *   SMOKE_ACCOUNT_LABEL='Employee demo' node e2e/search-browser.e2e.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9333);
const CDP_BASE = `http://127.0.0.1:${DEBUG_PORT}`;
/** Which seeded demo account to log in as (button label on the login page). */
const ACCOUNT_LABEL = process.env.SMOKE_ACCOUNT_LABEL || 'Admin demo';

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
  console.error(`  ✘ ${label}\n      ${msg.slice(0, 400)}`);
};

// ---------------------------------------------------------------------------
// Launch Chrome + minimal CDP client
// ---------------------------------------------------------------------------
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-search-'));
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

const consoleIssues = [];
const pageErrors = [];

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
// Helpers
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

const clickNav = (label) => run((navLabel) => {
  const btn = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes(navLabel));
  if (!btn) throw new Error(`nav item not found: ${navLabel}`);
  btn.click();
  return true;
}, label);

const setField = (selector, value) => run((sel, val) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`field not found: ${sel}`);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  if (!setter || !setter.set) throw new Error(`cannot set value on ${sel}`);
  setter.set.call(el, val);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return true;
}, selector, value);

const overviewSummary = () => run(() => ({
  error: document.querySelector('.gs-error')?.textContent?.trim() || null,
  tabs: [...document.querySelectorAll('.gs-tab')].map((t) => t.textContent.trim()),
  sections: [...document.querySelectorAll('.gs-section')].map((s) => ({
    scope: s.querySelector('h3')?.textContent?.trim() || null,
    count: s.querySelector('.gs-count')?.textContent?.trim() || null,
    rows: s.querySelectorAll('.gs-row').length,
  })),
  intro: !!document.querySelector('.gs-intro'),
}));

const waitResults = (label) => waitFor(
  `!document.querySelector('.gs-spinner') && (document.querySelectorAll('.gs-section').length > 0 || !!document.querySelector('.gs-no-results') || !!document.querySelector('.gs-intro'))`,
  { label, timeout: 20000 },
);

/** Wait until ANY of [expression, label] pairs becomes true; returns its label. */
async function waitAny(entries, { timeout = 20000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const [expr, label] of entries) {
      try {
        if (await evaluate(expr)) return label;
      } catch { /* expression may not be valid until the DOM is ready */ }
    }
    await sleep(200);
  }
  throw new Error(`timeout waiting for any of: ${entries.map(([, l]) => l).join(' | ')}`);
}

// ---------------------------------------------------------------------------
// Smoke flow
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Using Chrome: ${CHROME}`);
  await launchChrome();
  await connect();
  console.log(`App: ${APP_URL}  ·  account: ${ACCOUNT_LABEL}\n`);

  // ---- 1. Login ----------------------------------------------------------
  await send('Page.navigate', { url: `${APP_URL}/login` });
  try {
    await waitFor(`!!document.querySelector('.auth-demo-btn')`, { label: 'login page demo buttons', timeout: 60000 });
    ok('Login page renders');
  } catch (e) { bad('Login page renders', e); }

  try {
    await evaluate(`(() => {
      const label = ${JSON.stringify(ACCOUNT_LABEL)};
      const b = [...document.querySelectorAll('.auth-demo-btn')].find((x) => x.textContent.includes(label));
      if (!b) throw new Error('demo account button missing: ' + label);
      b.click();
      return true;
    })()`);
    await waitFor(`location.pathname === '/dashboard' && !!document.querySelector('.workspace-shell')`, { label: 'dashboard after login', timeout: 30000 });
    ok(`Logs in as ${ACCOUNT_LABEL} and reaches the dashboard`);
  } catch (e) { bad(`Logs in as ${ACCOUNT_LABEL} and reaches the dashboard`, e); }

  // ---- 2. Open the Search view ------------------------------------------
  try {
    await clickNav('Search');
    await waitFor(`!!document.querySelector('.gs-view')`, { label: 'Search view rendered' });
    const h1 = await evaluate(`document.querySelector('.gs-view h1')?.textContent?.trim()`);
    if (h1 !== 'Search') throw new Error(`expected heading "Search", got "${h1}"`);
    ok('Search view opens from the sidebar (heading "Search")');
  } catch (e) { bad('Search view opens from the sidebar', e); }

  // ---- 3. Text query → grouped overview ----------------------------------
  try {
    await setField('.gs-search input', 'hello');
    await waitResults('overview results for "hello"');
    const summary = await overviewSummary();
    if (summary.error) throw new Error(`search error shown: ${summary.error}`);
    const msg = summary.sections.find((s) => s.scope === 'Messages');
    if (!msg || Number(msg.count) < 1) throw new Error(`expected message hits, got ${JSON.stringify(summary.sections)}`);
    ok(`Query "hello" → grouped overview: ${summary.sections.map((s) => `${s.scope}=${s.count}`).join(', ')}`);
  } catch (e) { bad('Query "hello" → grouped overview', e); }

  // ---- 4. Scope tab + jump into a conversation ---------------------------
  try {
    await run(() => {
      const tab = [...document.querySelectorAll('.gs-tab')].find((t) => t.textContent.includes('Messages'));
      if (!tab) throw new Error('Messages tab not shown');
      tab.click();
      return true;
    });
    await waitFor(`document.querySelectorAll('.gs-section .gs-row').length > 0`, { label: 'expanded Messages rows' });
    ok('Expanding the Messages tab lists paginated results');
    const convBefore = await evaluate(`document.querySelector('.gs-section .gs-row-title em')?.textContent?.trim() || null`);
    await evaluate(`document.querySelector('.gs-section .gs-row')?.click()`);
    await waitFor(`!!document.querySelector('.chat-header h3')`, { label: 'conversation opened from a message result', timeout: 30000 });
    const conv = await evaluate(`document.querySelector('.chat-header h3')?.textContent?.trim()`);
    ok(`Message result jumps into the conversation (${JSON.stringify(conv || convBefore)})`);
  } catch (e) { bad('Message result jumps into a conversation', e); }

  // ---- 5. Multi-scope query + team result --------------------------------
  try {
    await clickNav('Search');
    await waitFor(`!!document.querySelector('.gs-view')`);
    await setField('.gs-search input', 'design');
    await waitResults('overview results for "design"');
    const summary = await overviewSummary();
    if (summary.error) throw new Error(`search error shown: ${summary.error}`);
    ok(`Query "design" → ${summary.sections.map((s) => `${s.scope}=${s.count}`).join(', ') || 'no hits'}`);

    const teamSection = summary.sections.find((s) => s.scope === 'Teams');
    if (teamSection && Number(teamSection.count) > 0) {
      await run(() => {
        const tab = [...document.querySelectorAll('.gs-tab')].find((t) => t.textContent.includes('Teams'));
        if (!tab) throw new Error('Teams tab not shown');
        tab.click();
        return true;
      });
      await waitFor(`document.querySelectorAll('.gs-section .gs-row').length > 0`, { label: 'team rows' });
      const teamName = await evaluate(`document.querySelector('.gs-section .gs-row .gs-row-title b')?.textContent?.trim() || null`);
      await evaluate(`document.querySelector('.gs-section .gs-row')?.click()`);
      // Members (and managers+) land in the team chat; non-members stay on
      // the Search view with the access-restriction toast.
      const outcome = await waitAny([
        [`!!document.querySelector('.chat-header h3')`, 'opened'],
        [`document.body.innerText.includes('must be a member')`, 'blocked'],
      ], { timeout: 30000 });
      if (outcome === 'opened') {
        const conv = await evaluate(`document.querySelector('.chat-header h3')?.textContent?.trim() || null`);
        ok(`Team result opens its chat (${JSON.stringify(conv || teamName)})`);
      } else {
        ok(`Non-member team result is blocked with the access toast (team: ${JSON.stringify(teamName)})`);
      }
    } else {
      ok('Team scope had no hits for "design" — team jump skipped');
    }
  } catch (e) { bad('Multi-scope query + team result', e); }

  // ---- 6. Filter-only search ---------------------------------------------
  try {
    await clickNav('Search');
    await waitFor(`!!document.querySelector('.gs-view')`);
    await run(() => {
      const sel = document.querySelector('.gs-filters select[aria-label="Filter by person"]');
      if (!sel) throw new Error('person filter missing');
      const option = [...sel.options].find((o) => o.value !== '' && (o.textContent.includes('Maya') || o.textContent.includes('Dara')))
        || sel.options[1];
      if (!option) throw new Error('no person options');
      sel.value = option.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    await waitResults('person-filter results');
    const summary = await overviewSummary();
    if (summary.error) throw new Error(`person-filter error: ${summary.error}`);
    ok(`Person filter alone returns: ${summary.sections.map((s) => `${s.scope}=${s.count}`).join(', ') || 'no hits'}`);

    await run(() => {
      const sel = document.querySelector('.gs-filters select[aria-label="Filter by file type"]');
      if (!sel) throw new Error('file-type filter missing');
      sel.value = 'image';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    await waitFor(`!!document.querySelector('.gs-clear-filters')`, { label: 'clear-filters button appears' });
    await waitResults('person + file-type results');
    const after = await overviewSummary();
    if (after.error) throw new Error(`person+file-type error: ${after.error}`);
    ok('Person + File-type filters applied without errors');
  } catch (e) { bad('Filter-only search (Person / File type)', e); }

  // ---- 7. Clear filters → intro ------------------------------------------
  try {
    await run(() => {
      const btn = document.querySelector('.gs-clear-filters');
      if (!btn) throw new Error('clear-filters button missing');
      btn.click();
      return true;
    });
    await waitFor(`!!document.querySelector('.gs-intro')`, { label: 'intro after clearing filters' });
    ok('"Clear filters" resets to the intro state');
  } catch (e) { bad('Clear filters resets to the intro state', e); }

  // ---- Report -------------------------------------------------------------
  console.log('\n---- Console / page issues ----');
  const realIssues = [...consoleIssues, ...pageErrors].filter((t) =>
    !/favicon/i.test(t) && !/React DevTools/i.test(t) && !/Autofocus processing was blocked/i.test(t) && !/Download the React DevTools/i.test(t));
  if (realIssues.length === 0) console.log('  none');
  else for (const issue of realIssues.slice(0, 30)) console.log(`  • ${issue}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error('Smoke run crashed:', e); process.exitCode = 1; })
  .finally(() => {
    setTimeout(() => {
      try { chrome && chrome.kill(); } catch { /* ignore */ }
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }, 500);
  });
