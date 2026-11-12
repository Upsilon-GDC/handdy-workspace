export const billingBlockerMessages = {
  'hours-only-team': 'Enable billing for this team and period in Settings.',
  'no-billable-work': 'No billable work was found for this period.',
  'missing-or-mismatched-rate': 'Check the employee project rates and team currency.',
  'billing-configuration-needs-review': 'Ask a billing reviewer to check the billing configuration.',
  'running-timer': 'Stop the active timer, then prepare this report again.',
  'unverified-team-allocation': 'A billing reviewer must verify the team assignments.',
  'needs-team-allocation': 'Review which team the work belongs to.',
  'needs-activity-classification': 'Classify the tasks in Settings for the dates worked, then prepare again.',
  'overlapping-work-needs-review': 'Review overlapping time entries.',
  'future-period': 'Choose a period ending today or earlier.',
  'invalid-pause': 'Review the pause records in the time entries.',
  'invalid-or-empty-interval': 'Review time entries with missing or invalid start/end times.',
};

export function preparationIssues(batch) {
  // Assignment verification is the next preparation step. All other blockers
  // need attention first; in particular, running totals cannot be submitted.
  return (batch.snapshot.blockers || [])
    .filter(code => code !== 'unverified-team-allocation')
    .map(code => billingBlockerMessages[code] || code);
}
