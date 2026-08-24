#!/usr/bin/env node
/**
 * KneaChat — E2E browser test: chat file upload.
 *
 * Logs in via the real UI, navigates to #general, triggers a file upload
 * through the hidden <input type=file>, and verifies the file appears in chat.
 *
 * Requirements: backend on :8080, client on :3000, Chrome installed.
 * Usage: node e2e/chat-upload.e2e.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API = process.env.API_BASE || 'http://localhost:8080';
const CLIENT = process.env.CLIENT_BASE || 'http://localhost:3000';
const CDP_PORT = 9335;
const EMAIL = process.env.TEST_EMAIL || 'admin@kneachat.com';
const PASSWORD = process.env.TEST_PASSWORD || 'kneachat168';

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? (passed++, console.log(`  ✅ ${name}`)) : (failed++, console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)); };
const section = (t) => console.log(`\n── ${t} ─${'─'.repeat(Math.max(0, 56 - t.length))}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 20000, interval = 200) {
  const start = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - start > timeout) return null; await sleep(interval); }
}

// ── CDP ──────────────────────────────────────────────────────────────────────
class CDP {
  constructor(ws) { this.ws = ws; this.id = 1; this.pending = new Map(); ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id !== undefined) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } }); }
  static connect(url) { return new Promise((ok, fail) => { const ws = new WebSocket(url); ws.on('open', () => ok(new CDP(ws))); ws.on('error', fail); }); }
  send(method, params = {}) { const id = this.id++; return new Promise((ok, fail) => { this.pending.set(id, { resolve: ok, reject: fail }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`Eval: ${JSON.stringify(r.exceptionDetails).slice(0, 200)}`); return r.result?.value; }
}

function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  return c.find((p) => { try { fs.accessSync(p); return true; } catch { return false; } });
}

// ── Test PNG (8×8 red) ──────────────────────────────────────────────────────
const zlib = require('zlib');
const crc32 = ((t) => { const tb = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c; } return (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = tb[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
const pngChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'ascii'); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
function makePng() {
  const w = 8, h = 8, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 3); row[0] = 0; for (let x = 0; x < w; x++) { row[1+x*3]=255; row[2+x*3]=50; row[3+x*3]=50; } rows.push(row); }
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── Main ─────────────────────────────────────────────────────────────────────
let chrome = null, chromeDir = null, page = null;

async function main() {
  console.log('KneaChat E2E — chat file upload (real browser)\n');

  // Preflight
  section('Preflight');
  let ok; try { ok = (await fetch(`${API}/api/health`)).ok; } catch { ok = false; }
  check('Backend reachable', ok); if (!ok) process.exit(1);
  try { ok = (await fetch(CLIENT)).ok; } catch { ok = false; }
  check('Client reachable', ok); if (!ok) process.exit(1);
  const chromePath = findChrome();
  check('Chrome found', !!chromePath); if (!chromePath) process.exit(1);

  // Write test file to disk (needed for DOM.setFileInputFiles)
  const tmpFile = path.join(os.tmpdir(), `chat-upload-test-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, makePng());

  // Launch Chrome
  section('Launch Chrome');
  chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kneachat-upload-'));
  chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--remote-allow-origins=*', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${chromeDir}`, '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); const list = await r.json(); target = list.find(t => t.type === 'page'); if (target) break; } catch {} await sleep(250);
  }
  check('CDP target found', !!target);
  if (!target) { cleanup(); process.exit(1); }

  page = await CDP.connect(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('DOM.enable');
  check('CDP session attached', true);

  // Login
  section('Login');
  await page.send('Page.navigate', { url: `${CLIENT}/login` });
  const formReady = await waitFor(() => page.eval(`!!document.querySelector('input[type=email]')`));
  check('Login form rendered', !!formReady);

  // Type credentials (React 19 needs real keystrokes)
  const type = async (sel, txt) => {
    await page.eval(`document.querySelector(${JSON.stringify(sel)}).focus()`);
    await page.send('Input.insertText', { text: txt });
  };
  await type('input[type=email]', EMAIL);
  await type('input[type=password]', PASSWORD);
  await sleep(300);

  const filled = await waitFor(() => page.eval(`(() => {
    const e = document.querySelector('input[type=email]');
    const p = document.querySelector('input[type=password]');
    return e?.value && p?.value ? true : null;
  })()`));
  check('Credentials typed', !!filled);

  await waitFor(() => page.eval(`(() => {
    const btn = document.querySelector('form button[type=submit]');
    return btn && !btn.disabled;
  })()`));
  await page.eval(`document.querySelector('form button[type=submit]').click()`);

  const dashReady = await waitFor(() => page.eval(`(() => {
    return !!document.querySelector('textarea, .composer, .sidebar');
  })()`), 10000);
  check('Dashboard loaded after login', !!dashReady);

  // Navigate to #general
  section('Navigate to #general');
  await sleep(1000);
  await page.eval(`(() => {
    const items = document.querySelectorAll('.sidebar li, .sidebar button, .sidebar a, [class*=channel]');
    const gen = [...items].find(el => el.textContent.includes('general'));
    if (gen) gen.click();
    return !!gen;
  })()`);
  await sleep(2000);

  const channelReady = await waitFor(() => page.eval(`(() => {
    const ta = document.querySelector('textarea');
    return ta && ta.placeholder && (ta.placeholder.includes('#') || ta.placeholder.includes('Message'));
  })()`));
  check('In #general channel (textarea visible)', !!channelReady);

  // Upload file
  section('File upload via paperclip');

  // Set up network interception to capture the upload response
  const uploadCapture = new Promise((resolve) => {
    let resolved = false;
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'Network.responseReceived' && msg.params?.response?.url?.includes('/messages/upload')) {
          if (!resolved) { resolved = true; page.ws.removeListener('message', handler); resolve({ status: msg.params.response.status, url: msg.params.response.url }); }
        }
      } catch {}
    };
    page.ws.on('message', handler);
    setTimeout(() => { if (!resolved) { resolved = true; page.ws.removeListener('message', handler); resolve(null); } }, 20000);
  });

  // Find the hidden file input and set a file on it
  const fileInput = await page.send('DOM.querySelector', { nodeId: (await page.send('DOM.getDocument')).root.nodeId, selector: 'input[type=file]' });
  check('File input element found', !!fileInput.nodeId);

  if (fileInput.nodeId) {
    await page.send('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [tmpFile] });
    // Trigger the React change event
    await page.eval(`(() => {
      const input = document.querySelector('input[type=file]');
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    console.log('  ℹ️  File set on input, upload in flight…');
  }

  // Wait for the upload response
  const result = await uploadCapture;
  check('Upload request completed', !!result);
  if (result) {
    check('Upload returned 201 Created', result.status === 201, `got ${result.status}`);
  }

  // Verify the file appears in the chat
  await sleep(2000);
  const fileVisible = await page.eval(`(() => {
    const all = document.querySelectorAll('[class*=attachment], [class*=Attachment], img[src*=uploads], a[href*=uploads], [class*=file], audio');
    return all.length;
  })()`);
  check('File attachment visible in chat', fileVisible > 0, `found ${fileVisible} element(s)`);

  // Also check for the filename text
  const filenameVisible = await page.eval(`(() => {
    return document.body.textContent.includes('chat-upload-test') || document.body.textContent.includes('upload-test');
  })()`);
  check('Upload filename appears in chat', !!filenameVisible);

  // Cleanup
  section('Cleanup');
  fs.unlinkSync(tmpFile);
  cleanup();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Total: ${passed + failed}  |  ✅ ${passed}  |  ❌ ${failed}`);
  console.log(`${'='.repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

function cleanup() {
  if (chrome) chrome.kill('SIGTERM');
  if (chromeDir) fs.rmSync(chromeDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err.message || err);
  cleanup();
  process.exit(1);
});
