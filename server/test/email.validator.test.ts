'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isValidEmailAddress, validateEmailSendBody } from '../src/integrations/email/email.validator';

describe('isValidEmailAddress', () => {
  it('accepts ordinary addresses', () => {
    for (const ok of ['customer@gmail.com', 'first.last+tag@mail.example.co.uk', 'a@b.io']) {
      assert.equal(isValidEmailAddress(ok), true, ok);
    }
  });

  it('rejects malformed, oversized and header-injection input', () => {
    for (const bad of [
      '', 'plainaddress', '@example.com', 'user@', 'user@localhost', 'two@@example.com',
      'Name <user@example.com>', 'user@exa mple.com', 'user@example..com',
      'user@example.com\r\nBcc: victim@example.com',
      `${'a'.repeat(65)}@example.com`, `user@${'d'.repeat(250)}.com`,
      null, 42,
    ]) {
      assert.equal(isValidEmailAddress(bad), false, String(bad));
    }
  });
});

describe('validateEmailSendBody', () => {
  it('returns the normalized input for a valid body', () => {
    assert.deepEqual(validateEmailSendBody({ conversationId: '148', text: '  Hello  ' }), {
      ok: true,
      value: { conversationId: 148, text: 'Hello', replyToMessageId: null },
    });
  });

  it('reports every invalid field', () => {
    const result = validateEmailSendBody({ conversationId: -1, text: ' ', replyToMessageId: 'x' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(Object.keys(result.errors).sort(), ['conversationId', 'replyToMessageId', 'text']);
    }
  });

  it('rejects over-long text and a client-supplied recipient', () => {
    const result = validateEmailSendBody({ conversationId: 1, text: 'x'.repeat(20001), to: 'attacker@evil.com' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.text);
      assert.ok(result.errors.to, 'the recipient always comes from the stored contact');
    }
  });
});
