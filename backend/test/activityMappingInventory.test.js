const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeActivityMappings } = require('../scripts/auditActivityMappings');
const fixture = () => ({
  projects: [{ _id: 'p', projectName: 'Project', status: 'Active', clients: ['c'], teams: ['team'] }],
  clients: [{ _id: 'c', clientName: 'Client', status: 'Active' }],
  tasks: [{ _id: 't', taskName: 'Review', project: 'p', teams: ['team'], isActive: true }],
  teams: [{ _id: 'team', isActive: true }], employees: [], history: [],
});
test('only an explicit unambiguous active relationship becomes a candidate; input stays unchanged', () => {
  const data = fixture(); const original = JSON.stringify(data);
  const report = analyzeActivityMappings(data);
  assert.equal(report.summary.automaticLinkCandidates, 1);
  assert.deepEqual(report.tasks[0].proposedMapping, { project: 'p', client: 'c', task: 't' });
  assert.equal(JSON.stringify(data), original);
});
test('multiple clients cannot be inferred from one observed historical combination', () => {
  const data = fixture(); data.projects[0].clients.push('c2');
  data.clients.push({ _id: 'c2', status: 'Active' });
  data.history.push({ _id: { task: 't', project: 'p', client: 'c' }, count: 2 });
  const report = analyzeActivityMappings(data);
  assert.equal(report.summary.automaticLinkCandidates, 0);
  assert.ok(report.tasks[0].issues.includes('multiple-project-clients-task-client-unconfirmed'));
});
test('shared/projectless tasks are reviewed even when only one active project exists', () => {
  const data = fixture(); data.tasks[0].project = null;
  const report = analyzeActivityMappings(data);
  assert.equal(report.tasks[0].disposition, 'review-required');
  assert.deepEqual(report.tasks[0].candidateProjectIdsForReview, ['p']);
  assert.equal(report.tasks[0].proposedMapping, null);
});
test('inactive client, missing assignee and conflicting primary client block automatic proposals', () => {
  const data = fixture(); data.clients[0].status = 'Inactive'; data.tasks[0].assignedTo = ['missing'];
  data.projects[0].client = 'missing-client';
  const report = analyzeActivityMappings(data);
  assert.equal(report.summary.automaticLinkCandidates, 0);
  for (const issue of ['inactive-client-reference', 'missing-or-inactive-assignee', 'primary-client-not-in-clients']) {
    assert.ok(report.tasks[0].issues.includes(issue), issue);
  }
});
test('historical orphan and null-client records are reported without replacing IDs', () => {
  const data = fixture(); data.history = [{ _id: { task: 'old', project: 'gone', client: null }, count: 9 }];
  const report = analyzeActivityMappings(data);
  assert.equal(report.summary.timeEntries, 9);
  assert.deepEqual(report.historicalIssues[0].reasons, ['missing-task', 'missing-project', 'no-recorded-client-do-not-infer']);
  assert.equal(report.historicalIssues[0]._id.task, 'old');
});
test('duplicate names and inactive defaults are reported rather than merged or reactivated', () => {
  const data = fixture(); data.projects.push({ _id: 'old', projectName: ' Project ', status: 'Completed' });
  data.tasks.push({ _id: 'old-task', taskName: 'Idle Break', isActive: false, taskType: 'work' });
  const report = analyzeActivityMappings(data);
  assert.equal(report.summary.inactiveTasksRetained, 1);
  assert.equal(report.duplicateNames.length, 1);
  assert.deepEqual(report.defaultRecordCandidates.tasks, [{ id: 'old-task', active: false, taskType: 'work' }]);
});
