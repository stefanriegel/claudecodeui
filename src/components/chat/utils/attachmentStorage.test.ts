import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTACHMENT_QUOTA_BYTES,
  deserializeStoredAttachments,
  serializeStoredAttachments,
  type StoredAttachment,
} from './attachmentStorage';

const sample: StoredAttachment[] = [
  { name: 'a.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
];

test('round-trips attachments', () => {
  const raw = serializeStoredAttachments(sample);
  assert.ok(raw);
  assert.deepEqual(deserializeStoredAttachments(raw), sample);
});

test('returns null when over quota', () => {
  const big: StoredAttachment[] = [
    { name: 'big.png', type: 'image/png', dataUrl: 'x'.repeat(ATTACHMENT_QUOTA_BYTES + 1) },
  ];
  assert.equal(serializeStoredAttachments(big), null);
});

test('deserialize is safe on garbage', () => {
  assert.deepEqual(deserializeStoredAttachments(null), []);
  assert.deepEqual(deserializeStoredAttachments('not json'), []);
  assert.deepEqual(deserializeStoredAttachments('{"not":"array"}'), []);
});
