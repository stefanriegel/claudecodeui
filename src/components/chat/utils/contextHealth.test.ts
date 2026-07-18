import assert from 'node:assert/strict';
import test from 'node:test';

import { computeContextHealth } from './contextHealth';

test('returns null when total is non-positive', () => {
  assert.equal(computeContextHealth(100, 0), null);
  assert.equal(computeContextHealth(100, -5), null);
});

test('buckets levels by percent', () => {
  assert.deepEqual(computeContextHealth(0, 200000), { percent: 0, level: 'ok' });
  assert.deepEqual(computeContextHealth(139999, 200000).level, 'ok'); // ~70% boundary below
  assert.equal(computeContextHealth(150000, 200000).level, 'warn');
  assert.equal(computeContextHealth(190000, 200000).level, 'critical');
});

test('clamps percent to 100', () => {
  assert.equal(computeContextHealth(300000, 200000).percent, 100);
});
