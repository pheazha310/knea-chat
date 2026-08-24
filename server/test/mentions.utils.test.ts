'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractMentionedUserIds, cleanToken } from '../src/utils/mentions.utils';

const MEMBERS = [
  { id: 1, first_name: 'Ann', last_name: 'Admin', email: 'ann@kneachat.com' },
  { id: 2, first_name: 'Maya', last_name: 'Chen', email: 'maya@kneachat.com' },
  { id: 3, first_name: 'Dara', last_name: 'Sok', email: 'dara@kneachat.com' },
  { id: 4, first_name: 'Lina', last_name: 'Kim', email: 'lina@kneachat.com' },
];

describe('extractMentionedUserIds', () => {
  it('returns [] for empty or non-string content', () => {
    assert.deepEqual(extractMentionedUserIds('', MEMBERS), []);
    assert.deepEqual(extractMentionedUserIds('no mentions here', MEMBERS), []);
  });

  it('matches a full name mention', () => {
    assert.deepEqual(extractMentionedUserIds('Hey @Maya Chen!', MEMBERS), [2]);
  });

  it('matches email-style mentions', () => {
    assert.deepEqual(extractMentionedUserIds('Ping @maya@kneachat.com please', MEMBERS), [2]);
  });

  it('matches multiple mentions and returns unique ids', () => {
    const ids = extractMentionedUserIds('@Maya and @Dara and @maya again', MEMBERS);
    assert.deepEqual(ids.sort(), [2, 3]);
  });

  it('ignores unknown names', () => {
    assert.deepEqual(extractMentionedUserIds('@Nobody here', MEMBERS), []);
  });

  it('strips trailing punctuation from the matched token', () => {
    assert.deepEqual(extractMentionedUserIds('@Maya.', MEMBERS), [2]);
  });

  it('cleanToken strips trailing punctuation', () => {
    assert.equal(cleanToken('Maya!'), 'Maya');
    assert.equal(cleanToken('maya@kneachat.com'), 'maya@kneachat.com');
  });
});
