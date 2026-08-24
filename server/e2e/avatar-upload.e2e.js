#!/usr/bin/env node
/**
 * KneaChat — End-to-end browser test: profile picture (avatar) upload.
 *
 * Regression guard for the avatar flow: picking a photo on the Profile page
 * must upload the image as a file (multipart → POST /api/users/:id/avatar)
 * and display the stored /uploads URL. It must NOT send a base64 data URL
 * through PATCH /users/:id — the users.profile_picture column is VARCHAR(500),
 * so a data URL is rejected with HTTP 400 ("Data too long") and the avatar
 * never renders.
 *
 * Drives real headless Chrome over the Chrome DevTools Protocol (CDP). The
 * `ws` package (already a backend dependency) speaks CDP, so no new packages
 * and no browser automation library are required.
 *
 * Requirements:
 *   • Backend running (REST + WS on :8080 by default) — `cd server && npm run dev`
 *   • Client dev server running (:3000 by default) — `npm run client`
 *   • A Chrome/Chromium binary — override with CHROME_PATH if not detected
 *     automatically (macOS app bundle, linux google-chrome/chromium, Windows).
 *
 * Usage:
 *   npm run test:e2e:avatar
 *   API_BASE=http://host:8080 CLIENT_BASE=http://host:3000 npm run test:e2e:avatar
 *   CHROME_PATH=/usr/bin/chromium npm run test:e2e:avatar
 *
 * The test creates its own throwaway user (admin API), exercises the browser
 * flow for that user, then deletes the user + uploaded file. Exit code 0 = all
 * checks passed.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const WebSocket = require('ws');

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const CLIENT_BASE = process.env.CLIENT_BASE || 'http://localhost:3000';
const CDP_PORT = Number(process.env.CDP_PORT || 9333);

const ADMIN_EMAIL = process.env.E2E_SENDER_EMAIL || 'admin@kneachat.com';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const MARKER = `e2e-${process.pid}-${Date.now()}`;
const TEST_EMAIL = `avatar-${MARKER}@example.com`;
const TEST_USER = { first_name: 'Avatar', last_name: 'E2E', email: TEST_EMAIL, password: PASSWORD };

// ---------------------------------------------------------------------------
// Tiny test harness (same style as notifications.e2e.js)
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

function section(title) {
  console.log(`\n── ${title} ─${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn()` until it returns a truthy value or the timeout elapses. */
async function waitFor(fn, timeoutMs = 15000, intervalMs = 150) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) return null;
    await sleep(intervalMs);
  }
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

// ---------------------------------------------------------------------------
// Chrome DevTools Protocol client (over the `ws` package — no new deps)
// ---------------------------------------------------------------------------
class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
        }
      } else {
        this.events.push(msg);
      }
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.on('open', () => resolve(new CDP(socket)));
      socket.on('error', reject);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `Page evaluation failed: ${JSON.stringify(res.exceptionDetails).slice(0, 300)}`,
      );
    }
    return res.result ? res.result.value : undefined;
  }
}

/** First usable Chrome/Chromium binary, honouring CHROME_PATH. */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((c) => {
    try {
      fs.accessSync(c);
      return true;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Realistic test photo — a 240×240 vertical-gradient PNG generated at runtime
// (zlib + CRC32, no dependencies). Real dimensions + real file bytes exercise
// the same multer path a phone photo would.
// ---------------------------------------------------------------------------
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
};

/** 8-bit truecolor PNG with a vertical gradient between two RGB colours. */
function makePhotoPng(width, height, top, bottom) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolor
  const scanlines = [];
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = Math.round(top[0] + (bottom[0] - top[0]) * t);
      row[2 + x * 3] = Math.round(top[1] + (bottom[1] - top[1]) * t);
      row[3 + x * 3] = Math.round(top[2] + (bottom[2] - top[2]) * t);
    }
    scanlines.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(scanlines))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 240×240 "photo" (indigo→purple) — ~10 KB once compressed. */
const PHOTO_PNG = makePhotoPng(240, 240, [99, 102, 241], [139, 92, 246]);

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
let chrome = null;
let chromeProfileDir = null;
let page = null;
let avatarPath = null;
let uploadedFileName = null;
let adminToken = null;
let testUserId = null;

async function main() {
  console.log('KneaChat E2E — profile picture upload (real browser)');
  console.log(`  API   : ${API_BASE}`);
  console.log(`  Client: ${CLIENT_BASE}`);
  console.log(`  mark  : ${MARKER}`);

  // 0. Preflight — both servers + a Chrome binary must be available.
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
  console.log('  ✅ Backend is up');

  let clientUp = false;
  try {
    const res = await fetch(CLIENT_BASE);
    clientUp = res.status === 200;
  } catch {
    clientUp = false;
  }
  if (!clientUp) {
    console.log(`  ❌ Cannot reach the client dev server at ${CLIENT_BASE}`);
    console.log('     Start it first: npm run client (react-scripts on :3000)');
    process.exit(1);
  }
  console.log('  ✅ Client dev server is up');

  const chromePath = findChrome();
  if (!chromePath) {
    console.log('  ❌ No Chrome/Chromium binary found.');
    console.log('     Set CHROME_PATH to your browser executable and re-run.');
    process.exit(1);
  }
  console.log(`  ✅ Chrome: ${chromePath}`);

  // 1. Create a throwaway user (so the real admin's avatar is never touched).
  section('Test user');
  const admin = await login(ADMIN_EMAIL);
  adminToken = admin.token;
  const created = await api('/api/users', {
    method: 'POST',
    token: adminToken,
    body: TEST_USER,
  });
  if (created.status !== 201) {
    throw new Error(`Could not create test user (HTTP ${created.status}): ${JSON.stringify(created.json)}`);
  }
  testUserId = created.json?.data?.user?.id;
  check(`throwaway user created (id ${testUserId})`, Number.isFinite(Number(testUserId)));

  // 2. Launch headless Chrome and attach over CDP.
  section('Launch browser');
  chromeProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kneachat-e2e-chrome-'));
  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeProfileDir}`,
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      target = (list || []).find((t) => t.type === 'page');
      if (target) break;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  if (!target) throw new Error('Headless Chrome did not expose a page target');
  page = await CDP.connect(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('DOM.enable');
  await page.send('Network.enable');
  await page.send('Log.enable');
  console.log('  ✅ CDP session attached');

  // 3. Log in as the throwaway user through the real login form.
  //    React 19 no longer reacts to programmatic value sets, so type real
  //    keystrokes over CDP (Input.insertText) — the same way a human would.
  section('Browser login');
  await page.send('Page.navigate', { url: `${CLIENT_BASE}/login` });
  const loginFormReady = await waitFor(() =>
    page.eval(`!!document.querySelector('input[type=email]')`),
  );
  check('login form rendered', !!loginFormReady);

  const typeInto = async (selector, text) => {
    await page.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await page.send('Input.insertText', { text });
  };
  await typeInto('input[type=email]', TEST_EMAIL);
  await typeInto('input[type=password]', PASSWORD);

  const filled = await waitFor(() =>
    page.eval(`(() => {
      const e = document.querySelector('input[type=email]');
      const p = document.querySelector('input[type=password]');
      return e && p && e.value && p.value ? { email: e.value, pw: p.value } : null;
    })()`),
  );
  check(
    'login form fields typed',
    !!filled && filled.email === TEST_EMAIL && filled.pw === PASSWORD,
    JSON.stringify(filled),
  );

  // Wait until React re-renders the submit button enabled — clicking a still-
  // disabled button is a silent no-op that leaves the app on /login.
  const btnReady = await waitFor(() =>
    page.eval(`(() => {
      const btn = document.querySelector('form button[type=submit]');
      return btn && !btn.disabled;
    })()`),
  );
  check('submit button enabled after typing', !!btnReady);
  await page.eval(`document.querySelector('form button[type=submit]').click()`);
  const redirected = await waitFor(
    () => page.eval(`location.pathname === '/dashboard' ? '/dashboard' : null`),
    20000,
  );
  if (redirected !== '/dashboard') {
    const loginError = await page.eval(`document.querySelector('.auth-error')?.textContent || ''`);
    check('login redirects into the app', false, `path=${redirected} error="${loginError}"`);
  } else {
    check('login redirects into the app', true, 'path=/dashboard');
  }

  // 4. Open /profile and pick a photo (same file input "Change photo" uses).
  section('Upload avatar');
  await page.send('Page.navigate', { url: `${CLIENT_BASE}/profile` });
  const profileReady = await waitFor(() => page.eval(`!!document.querySelector('input[type=file]')`));
  check('profile page rendered with the avatar file input', !!profileReady);

  avatarPath = path.join(os.tmpdir(), `kneachat-avatar-${MARKER}.png`);
  fs.writeFileSync(avatarPath, PHOTO_PNG);
  console.log(`  ℹ️  test photo: ${PHOTO_PNG.length} bytes, 240×240 PNG`);

  const doc = await page.send('DOM.getDocument');
  const inputNode = await page.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[type=file]',
  });
  await page.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [avatarPath] });
  console.log('  ℹ️  avatar file set on the input — upload in flight');

  // 5. Assert the browser-side outcome: img src → /uploads URL, image loads,
  // and localStorage carries the new profile_picture.
  section('Browser state');
  const imgInfo = await waitFor(() =>
    page.eval(`(() => {
      const img = [...document.querySelectorAll('img')].find((i) => i.src.includes('/uploads/avatar-'));
      if (!img) return null;
      return { src: img.src, loaded: img.complete && img.naturalWidth > 0 };
    })()`),
  );
  check(
    'avatar <img> points at the uploaded file',
    !!imgInfo && imgInfo.src.startsWith(`${API_BASE}/uploads/avatar-`),
    imgInfo && imgInfo.src,
  );
  check(
    'avatar image actually loaded (naturalWidth > 0)',
    !!imgInfo && imgInfo.loaded,
  );
  const stored = await waitFor(() =>
    page.eval(`(() => {
      try {
        const u = JSON.parse(localStorage.getItem('kneachat_user') || 'null');
        return u && u.profile_picture ? u.profile_picture : null;
      } catch { return null; }
    })()`),
  );
  check(
    'localStorage user has the new profile_picture URL',
    typeof stored === 'string' && stored.startsWith('/uploads/avatar-'),
    String(stored),
  );

  uploadedFileName = imgInfo
    ? path.basename(new URL(imgInfo.src).pathname)
    : stored
      ? path.basename(stored)
      : null;

  // 6. Ground truth on the server: profile_picture persisted + file is served.
  section('Server ground truth');
  const userNow = await api(`/api/users/${testUserId}`, { token: adminToken });
  const storedUrl = userNow.json?.data?.user?.profile_picture;
  check(
    'PATCH-less avatar flow persisted profile_picture = /uploads URL',
    typeof storedUrl === 'string' && storedUrl.startsWith('/uploads/avatar-'),
    String(storedUrl),
  );
  if (storedUrl) {
    const fileRes = await fetch(`${API_BASE}${storedUrl}`);
    check(
      'uploaded avatar is served over HTTP',
      fileRes.status === 200 && (fileRes.headers.get('content-type') || '').startsWith('image/'),
      `HTTP ${fileRes.status} ${fileRes.headers.get('content-type')}`,
    );
  }

  // 7. Regression guard: no 4xx/5xx responses may have been emitted by the
  // app during the whole flow (a base64 data-URL regression would 400 here).
  section('Regression guard: no failed requests');
  const noisy = (url) =>
    !url ||
    url.includes('sockjs-node') ||
    url.includes('hot-update') ||
    url.includes('.map') ||
    url.includes('favicon');
  const badResponses = page.events
    .filter((e) => e.method === 'Network.responseReceived')
    .map((e) => e.params.response)
    .filter((r) => r && r.status >= 400 && !noisy(r.url));
  const failedLoads = page.events
    .filter((e) => e.method === 'Network.loadingFailed')
    .map((e) => e.params)
    .filter((p) => p && p.type === 'XHR' && !noisy(p.requestId));
  const consoleErrors = page.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
    .map((e) => (e.params.args || []).map((a) => a.value || a.description || '').join(' '))
    .filter((t) => !t.includes('favicon'));
  check('no HTTP 4xx/5xx responses during the flow', badResponses.length === 0,
    badResponses.map((r) => `${r.status} ${r.url}`).join(' | '));
  check('no failed XHR/fetch requests', failedLoads.length === 0,
    failedLoads.map((p) => `${p.errorText} (${p.blockedReason || ''})`).join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

  // 8. Cleanup — remove the uploaded file and the throwaway user.
  section('Cleanup');
  await cleanup();

  console.log(`\n${'═'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 ALL CHECKS PASSED (${passed} passed)`);
  } else {
    console.log(`❌ ${failed} check(s) failed, ${passed} passed`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

async function cleanup() {
  try {
    if (adminToken && testUserId && uploadedFileName) {
      // Unlink the uploaded file (works whether or not the user row still points at it).
      const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
      fs.unlink(path.join(uploadDir, uploadedFileName), () => {});
      console.log(`  🧹 Removed uploaded file ${uploadedFileName}`);
    }
    if (adminToken && testUserId) {
      const del = await api(`/api/users/${testUserId}`, { method: 'DELETE', token: adminToken });
      console.log(`  🧹 Deleted throwaway user (HTTP ${del.status})`);
    }
  } catch (error) {
    console.warn(`  ⚠  Cleanup failed: ${error.message}`);
  }
  if (avatarPath) {
    fs.unlink(avatarPath, () => {});
  }
  if (chrome) {
    chrome.kill();
  }
  if (chromeProfileDir) {
    fs.rmSync(chromeProfileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\n❌ E2E script error:', error.message);
  return cleanup().finally(() => process.exit(1));
});
