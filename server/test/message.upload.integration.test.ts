'use strict';

/**
 * KneaChat — Integration test: POST /api/messages/upload
 *
 * Exercises the full HTTP path: auth middleware → multer multipart parsing →
 * file-type / MIME validation → MessageService → database.  Requires a running
 * server (cd server && npm run dev) and a seeded database (npm run db:setup).
 *
 * Run:  npm run test   (compiles + runs all dist/test/*.test.js)
 *       or:  npx ts-node --esm server/test/message.upload.integration.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Configuration — mirrors the e2e helper pattern
// ---------------------------------------------------------------------------
const API = process.env.API_BASE || 'http://localhost:8080';
const EMAIL = process.env.TEST_EMAIL || 'admin@kneachat.com';
const PASSWORD = process.env.TEST_PASSWORD || 'kneachat168';
const CONVERSATION_ID = process.env.TEST_CONVERSATION_ID || '5'; // general channel

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Authenticated JSON fetch. */
async function api(
  pathname: string,
  { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

/**
 * Build a multipart/form-data request body with a file + text field, using
 * Node's built-in http module — no external dependencies.
 *
 * This is critical: we deliberately let Node set the Content-Type header
 * (including the boundary) rather than hardcoding it, which is the correct
 * way and mirrors what the fixed axios client does.
 */
function buildMultipartBody(
  fields: Record<string, string>,
  file: { fieldName: string; filename: string; contentType: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----TestBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  // Text fields
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  // File field
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.data,
    Buffer.from('\r\n'),
  );

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Make a raw HTTP request with a custom Content-Type. */
function rawPost(
  url: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json: any = null;
          try {
            json = JSON.parse(data);
          } catch {
            /* non-JSON */
          }
          resolve({ status: res.statusCode!, json });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Setup: login and grab a JWT
// ---------------------------------------------------------------------------
const SUPER_EMAIL = process.env.SUPER_EMAIL || 'super@kneachat.com';
let token = '';
let superToken = '';

before(async () => {
  try {
    const { status, json } = await api('/api/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
    });
    assert.equal(status, 200, `Login failed: ${JSON.stringify(json)}`);
    token = json.data.token;
    assert.ok(token, 'Expected a JWT token');

    // Login as super_admin for settings manipulation tests.
    const superRes = await api('/api/auth/login', {
      method: 'POST',
      body: { email: SUPER_EMAIL, password: PASSWORD },
    });
    if (superRes.status === 200 && superRes.json?.data?.token) {
      superToken = superRes.json.data.token;
    }
  } catch (err: any) {
    throw new Error(
      `Skipping integration tests: server not reachable at ${API} (${err?.message || err}). ` +
      'Start the server first: cd server && npm run dev',
    );
  }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // 8-byte PNG magic
const WEBM_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // 4-byte WebM magic
const M4A_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]); // 8-byte ftyp box (MP4/M4A)
const FAKE_PDF = Buffer.from('%PDF-1.4 fake content');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/messages/upload — integration', () => {
  // ---- happy paths --------------------------------------------------------

  it('uploads a PNG image and returns 201 with attachment metadata', async () => {
    const { body, contentType } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      { fieldName: 'file', filename: 'photo.png', contentType: 'image/png', data: PNG_HEADER },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    );

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.equal(json.data.message.type, 'file');
    assert.equal(json.data.message.content, 'photo.png');
    assert.ok(json.data.message.attachments?.length >= 1, 'Expected at least one attachment');
    assert.equal(json.data.message.attachments[0].file_name, 'photo.png');
    assert.equal(json.data.message.attachments[0].file_type, 'image/png');
    assert.ok(json.data.message.attachments[0].file_url?.startsWith('/uploads/'));
  });

  it('uploads a .webm voice message (audio/webm) and returns 201', async () => {
    const { body, contentType } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      {
        fieldName: 'file',
        filename: 'voice-1234567890.webm',
        contentType: 'audio/webm',
        data: WEBM_HEADER,
      },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    );

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.equal(json.data.message.type, 'voice');
    assert.equal(json.data.message.attachments[0].file_type, 'audio/webm');
  });

  it('uploads a Safari voice message (audio/mp4 → .m4a) and returns 201', async () => {
    const { body, contentType } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      {
        fieldName: 'file',
        filename: 'voice-1234567890.m4a',
        contentType: 'audio/mp4',
        data: M4A_HEADER,
      },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    );

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.equal(json.data.message.type, 'voice');
    assert.equal(json.data.message.attachments[0].file_name, 'voice-1234567890.m4a');
    assert.equal(json.data.message.attachments[0].file_type, 'audio/mp4');
  });

  it('uploads a Chrome/Firefox voice message (audio/webm;codecs=opus) and returns 201', async () => {
    const { body, contentType } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      {
        fieldName: 'file',
        filename: 'voice-1234567890.webm',
        contentType: 'audio/webm;codecs=opus',
        data: WEBM_HEADER,
      },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    );

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.equal(json.data.message.type, 'voice');
    assert.equal(json.data.message.attachments[0].file_name, 'voice-1234567890.webm');
    // multer normalizes the MIME type, stripping codec parameters
    assert.equal(json.data.message.attachments[0].file_type, 'audio/webm');
  });

  it('uploads a PDF document and returns 201', async () => {
    const { body, contentType } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      { fieldName: 'file', filename: 'report.pdf', contentType: 'application/pdf', data: FAKE_PDF },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    );

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(json)}`);
    assert.equal(json.data.message.attachments[0].file_name, 'report.pdf');
    assert.equal(json.data.message.attachments[0].file_type, 'application/pdf');
  });

  // ---- validation / error paths -------------------------------------------

  it('rejects upload when conversation_id is missing → 400', async () => {
    const { body, contentType } = buildMultipartBody(
      {}, // no conversation_id
      { fieldName: 'file', filename: 'photo.png', contentType: 'image/png', data: PNG_HEADER },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    );

    assert.equal(status, 400);
    assert.equal(json.success, false);
    assert.ok(json.message?.toLowerCase().includes('conversation'), json.message);
  });

  it('rejects upload when no file is attached → 400', async () => {
    const boundary = `----TestBoundary${Date.now()}`;
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="conversation_id"\r\n\r\n${CONVERSATION_ID}\r\n--${boundary}--\r\n`,
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    );

    assert.equal(status, 400);
    assert.equal(json.success, false);
    assert.ok(json.message?.toLowerCase().includes('file'), json.message);
  });

  it('rejects upload when file type is not allowed → 400', async () => {
    const { body, contentType } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      {
        fieldName: 'file',
        filename: 'malware.exe',
        contentType: 'application/x-executable',
        data: Buffer.from('MZ'),
      },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    );

    assert.equal(status, 400);
    assert.equal(json.success, false);
    assert.ok(
      json.message?.includes('.exe') || json.message?.includes('not allowed'),
      `Expected file-type rejection, got: ${json.message}`,
    );
  });

  it('rejects upload when MIME type is disallowed → 400', async () => {
    // .png extension is allowed, but MIME is application/x-msdownload (not in allowlist)
    const { body, contentType } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      {
        fieldName: 'file',
        filename: 'suspicious.png',
        contentType: 'application/x-msdownload',
        data: PNG_HEADER,
      },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    );

    assert.equal(status, 400);
    assert.equal(json.success, false);
    assert.ok(
      json.message?.includes('content type') || json.message?.includes('not allowed'),
      `Expected MIME rejection, got: ${json.message}`,
    );
  });

  it('rejects upload without auth → 401', async () => {
    const { body, contentType } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      { fieldName: 'file', filename: 'photo.png', contentType: 'image/png', data: PNG_HEADER },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      { 'Content-Type': contentType }, // no Authorization header
      body,
    );

    assert.equal(status, 401);
    assert.equal(json.success, false);
  });

  // ---- file size limit ----------------------------------------------------

  it('rejects files exceeding the platform max_upload_size_mb limit → 400', async () => {
    if (!superToken) {
      // Cannot test platform limit without super_admin access.
      return;
    }

    // 1. Save current platform upload size setting.
    const settingsRes = await api('/api/settings', { token: superToken });
    const originalLimit = settingsRes.json?.data?.settings?.max_upload_size_mb ?? 10;

    // 2. Lower the limit to 1 MB so the test file (2 MB) exceeds it.
    await api('/api/settings', {
      method: 'PATCH',
      token: superToken,
      body: { max_upload_size_mb: 1 },
    });

    try {
      // 3. Send a 2 MB file — well above the 1 MB platform limit.
      const bigFile = Buffer.alloc(2 * 1024 * 1024, 0x41); // 2 MB of 'A's
      const { body, contentType } = buildMultipartBody(
        { conversation_id: CONVERSATION_ID },
        { fieldName: 'file', filename: 'big-image.png', contentType: 'image/png', data: bigFile },
      );

      const { status, json } = await rawPost(
        `${API}/api/messages/upload`,
        { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        body,
      );

      assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(json)}`);
      assert.equal(json.success, false);
      assert.ok(
        json.message?.includes('limit') || json.message?.includes('exceeds'),
        `Expected size-limit error, got: ${json.message}`,
      );
      assert.equal(json.errors?.file, 'File too large', 'errors.file should say "File too large"');
    } finally {
      // 4. Restore original setting regardless of test outcome.
      await api('/api/settings', {
        method: 'PATCH',
        token: superToken,
        body: { max_upload_size_mb: originalLimit },
      });
    }
  });

  // ---- the exact bug scenario: multipart without boundary ------------------

  it('rejects request with Content-Type: multipart/form-data but no boundary → 400', async () => {
    // This reproduces the original bug: the client sets Content-Type manually
    // without including the boundary parameter, so multer cannot parse the body.
    const { body } = buildMultipartBody(
      { conversation_id: CONVERSATION_ID },
      { fieldName: 'file', filename: 'photo.png', contentType: 'image/png', data: PNG_HEADER },
    );

    const { status, json } = await rawPost(
      `${API}/api/messages/upload`,
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data', // deliberately omitting boundary
      },
      body,
    );

    assert.equal(status, 400);
    assert.equal(json.success, false);
    assert.ok(
      json.message?.includes('Boundary') || json.message?.includes('boundary'),
      `Expected boundary error, got: ${json.message}`,
    );
  });
});
