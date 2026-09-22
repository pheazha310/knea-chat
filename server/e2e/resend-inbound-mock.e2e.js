#!/usr/bin/env node
/**
 * Integration test — Resend inbound path against a local mock Resend API.
 *
 * Exercises the real code path end-to-end (no module stubs):
 *
 *   email.received event → EmailChannelAdapter.parseInbound()
 *     → SDK GET /emails/receiving/:id            (body, headers, attachment ids)
 *     → media fileRef = resend-attachment://<emailId>/<attachmentId>
 *     → adapter.downloadMedia()
 *     → SDK GET /emails/receiving/:id/attachments/:attId  (signed URL)
 *     → GET <signed URL>                          (attachment bytes)
 *
 * The mock API stands in for api.resend.com (EMAIL_RESEND_API_BASE override),
 * so no real Resend account or network access is needed.
 *
 * Usage:  node e2e/resend-inbound-mock.e2e.js
 * Exit code 0 = all checks passed.
 */

const http = require('http');

const ATTACHMENT_BYTES = Buffer.from('hello');
const EMAIL_ID = 'e2e-received-1';
const ATTACHMENT_ID = 'att_e2e_1';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal stand-in for the Resend Receiving API (just the routes the SDK hits). */
function startMockResend() {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && url === `/emails/receiving/${EMAIL_ID}`) {
      res.end(
        JSON.stringify({
          object: 'email',
          id: EMAIL_ID,
          to: ['support@kneachat.com'],
          from: 'Customer <customer@example.com>',
          created_at: new Date().toISOString(),
          subject: 'Mock inbound with attachment',
          bcc: null,
          cc: null,
          reply_to: null,
          received_for: [],
          html: '<p>Please inspect the attached notes.</p>',
          text: 'Please inspect the attached notes.',
          headers: { 'Message-ID': '<mock-1@example.com>' },
          message_id: '<mock-1@example.com>',
          raw: null,
          attachments: [
            {
              id: ATTACHMENT_ID,
              filename: 'notes.txt',
              size: ATTACHMENT_BYTES.length,
              content_type: 'text/plain',
              content_id: null,
              content_disposition: 'attachment',
            },
          ],
        }),
      );
      return;
    }
    if (req.method === 'GET' && url === `/emails/receiving/${EMAIL_ID}/attachments/${ATTACHMENT_ID}`) {
      res.end(
        JSON.stringify({
          object: 'attachment',
          id: ATTACHMENT_ID,
          filename: 'notes.txt',
          size: ATTACHMENT_BYTES.length,
          content_type: 'text/plain',
          content_disposition: 'attachment',
          // A signed URL that expires — resolved fresh on every download.
          download_url: `http://127.0.0.1:${server.address().port}/files/${ATTACHMENT_ID}`,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
      return;
    }
    if (req.method === 'GET' && url === `/files/${ATTACHMENT_ID}`) {
      res.setHeader('content-type', 'text/plain');
      res.end(ATTACHMENT_BYTES);
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ name: 'not_found', message: `no route: ${url}` }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  console.log('KneaChat integration — Resend inbound (mock Resend API)');
  console.log('  no real Resend account or network access needed\n');

  const server = await startMockResend();
  const base = `http://127.0.0.1:${server.address().port}`;

  process.env.EMAIL_RESEND_API_KEY = 're_mock_key';
  process.env.EMAIL_RESEND_API_BASE = base;

  // Late requires so the env vars above are already set when the singleton
  // service builds its SDK client.
  const { EmailChannelAdapter } = require('../dist/src/integrations/email/email.adapter');
  const { EmailService } = require('../dist/src/integrations/email/email.service');

  const adapter = new EmailChannelAdapter(new EmailService());
  const event = {
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: {
      email_id: EMAIL_ID,
      from: 'Customer <customer@example.com>',
      to: ['support@kneachat.com'],
      subject: 'Mock inbound with attachment',
      attachments: [{ id: ATTACHMENT_ID, filename: 'notes.txt', content_type: 'text/plain', size: ATTACHMENT_BYTES.length }],
    },
  };

  // 1. parseInbound — content fetched through the SDK, attachment id kept.
  const messages = await adapter.parseInbound(event);
  check('event parsed into one inbound message', messages.length === 1, `got ${messages.length}`);
  const message = messages[0];
  check('sender normalized to the email address', message?.externalContactId === 'customer@example.com');
  check('body text fetched via the Receiving API', message?.content === 'Please inspect the attached notes.');
  check(
    'media fileRef encodes (emailId, attachmentId)',
    message?.media?.fileRef === `resend-attachment://${EMAIL_ID}/${ATTACHMENT_ID}`,
    String(message?.media?.fileRef),
  );
  check('media keeps provider filename', message?.media?.fileName === 'notes.txt');
  const metadata = message?.metadata?.email || {};
  check('attachment mirrored in metadata with resend_id', metadata.attachments?.[0]?.resend_id === ATTACHMENT_ID);
  check('threading headers survive the reshape', metadata.messageId === 'mock-1@example.com');

  // 2. downloadMedia — attachment bytes resolved via the signed URL.
  const buffer = await adapter.downloadMedia(message.media);
  check('downloadMedia returned the attachment bytes', !!buffer && buffer.equals(ATTACHMENT_BYTES), `${buffer?.length} bytes`);

  // 3. Failure modes degrade to null, never throw.
  check(
    'unknown attachment downloads as null',
    (await adapter.downloadMedia({ kind: 'file', fileName: 'x', mimeType: null, fileRef: `resend-attachment://${EMAIL_ID}/att_missing` })) === null,
  );
  check(
    'malformed fileRef downloads as null',
    (await adapter.downloadMedia({ kind: 'file', fileName: 'x', mimeType: null, fileRef: 'resend-attachment://broken' })) === null,
  );

  server.close();
  await sleep(50);

  console.log(`\n════════════════════════════════════════════`);
  console.log(`  ${passed}/${passed + failed} checks passed${failed > 0 ? `, ${failed} FAILED` : ' — all good'}`);
  console.log(`════════════════════════════════════════════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('❌ Integration test error:', error);
  process.exit(1);
});
