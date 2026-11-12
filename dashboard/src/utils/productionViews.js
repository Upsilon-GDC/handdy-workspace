export const productionViews = {
  overview: { title: 'Production at a glance', hint: 'See overall production and target progress for the period.', fields: ['team'],
    cards: ['production', 'expected', 'achievement', 'remaining'],
    columns: ['expectedSeconds', 'actualSeconds', 'productionSeconds', 'remainingSeconds', 'achievementPercent'] },
  employee: { title: 'Find employee production', hint: 'Choose a team to compare its members, or choose one employee to see their progress.', fields: ['team', 'employee'],
    cards: ['employees', 'production', 'achievement', 'remaining'],
    columns: ['expectedSeconds', 'productionSeconds', 'remainingSeconds', 'achievementPercent'] },
  team: { title: 'Compare team production', hint: 'Compare team totals, then open a team to see its employees.', fields: ['team'],
    cards: ['teams', 'employees', 'production', 'achievement'],
    columns: ['employeeCount', 'expectedSeconds', 'productionSeconds', 'remainingSeconds', 'achievementPercent'] },
  client: { title: 'Explore client and project work', hint: 'Choose a client or project to see where productive work is being completed.', fields: ['client', 'project'],
    cards: ['clientProjects', 'production', 'eligible', 'nonBillable'],
    columns: ['employeeCount', 'actualSeconds', 'productionSeconds'] },
  task: { title: 'Review task activity', hint: 'Choose a task or project to compare productive work, training and Break / Idle.', fields: ['task', 'project'],
    cards: ['tasks', 'production', 'training', 'breakIdle'],
    columns: ['employeeCount', 'actualSeconds', 'productionSeconds', 'trainingSeconds', 'breakIdleSeconds'] },
  details: { title: 'Explore employee work', hint: 'Review one employee’s daily work by client, project and task.', fields: ['employee', 'client', 'project', 'task'],
    cards: ['tracked', 'production', 'training', 'breakIdle'] },
  saved: { fields: ['team', 'employee'] },
};
export const productionColumnLabels = { employeeCount: 'Employees', expectedSeconds: 'Expected', actualSeconds: 'Tracked', productionSeconds: 'Production',
  remainingSeconds: 'Remaining', achievementPercent: 'Achievement', trainingSeconds: 'Training', breakIdleSeconds: 'Break / Idle' };
export const productionReportView = type => ({ daily: 'overview', weekly: 'overview', monthly: 'overview' })[type] || type;
