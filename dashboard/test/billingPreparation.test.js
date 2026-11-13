import test from 'node:test';
import assert from 'node:assert/strict';
import { preparationIssues } from '../src/utils/billingPreparation.js';

test('assignment-only draft can proceed to verification', () => {
  assert.deepEqual(preparationIssues({ snapshot: { blockers: ['unverified-team-allocation'] } }), []);
});
test('running timer and classification blockers require attention before verification', () => {
  const issues = preparationIssues({ snapshot: { blockers: ['running-timer', 'unverified-team-allocation', 'needs-activity-classification'] } });
  assert.equal(issues.length, 2);
  assert.match(issues[0], /Stop the active timer/);
  assert.match(issues[1], /dates worked/);
});
test('unknown blockers are preserved instead of allowing submission', () => {
  assert.deepEqual(preparationIssues({ snapshot: { blockers: ['new-blocker'] } }), ['new-blocker']);
});
