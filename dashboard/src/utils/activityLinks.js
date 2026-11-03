export const activityId = value => String(value?._id || value || '');
export const clientIdsForProject = project => [...new Set([...(project?.clients || []), project?.client].filter(Boolean).map(activityId))];

export function tasksForActivityProject(tasks, project) {
  if (!project) return [];
  const projectTeams = (project.teams || []).map(activityId);
  return tasks.filter(task => {
    if (task.project && activityId(task.project) !== activityId(project)) return false;
    const teams = (task.teams?.length ? task.teams : task.team ? [task.team] : []).map(activityId);
    return !projectTeams.length || teams.some(team => projectTeams.includes(team));
  });
}

export function toggleVisibleTasks(selected, visibleIds) {
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.includes(id));
  return allSelected ? selected.filter(id => !visibleIds.includes(id)) : [...new Set([...selected, ...visibleIds])];
}
