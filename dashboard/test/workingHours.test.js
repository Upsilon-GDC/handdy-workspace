import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursPreview, workingDuration } from '../src/utils/workingHours.js';
import { navigationForRole } from '../src/components/layout/workspaceNavigation.js';
test('working hour durations display decimal fractions correctly including seconds', () => {
  assert.equal(hoursPreview('7.8'), '7h 48m'); assert.equal(hoursPreview('7.5'), '7h 30m');
  assert.equal(hoursPreview('8.5'), '8h 30m'); assert.equal(hoursPreview('7.83'), '7h 49m 48s');
  assert.equal(workingDuration(-5), '0h 0m'); assert.match(hoursPreview('24.1'), /0–24/);
});
test('working hours settings navigation is available only for Admin and Alpha', () => {
  for (const role of ['admin', 'alpha', 'manager', 'hr', 'team_lead', 'employee']) {
    assert.equal(navigationForRole(role, () => true).some(row => row.path === '/admin/working-hours'), ['admin', 'alpha'].includes(role));
  }
});
