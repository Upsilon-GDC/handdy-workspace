const id = value => String(value?._id || value || '');
export function commonTaskProject(projects) {
  if (!projects.length) return null;
  return { ...projects[0], teams: (projects[0].teams || []).filter(team => projects.every(project => (project.teams || []).map(id).includes(id(team)))) };
}
export const clientsForTaskProject = (options, projectId) => {
  const project = options.projects.find(project => id(project) === projectId);
  return options.clients.filter(client => (project?.clientIds || []).includes(id(client)));
};
export const selectedCreationClient = (clients, selected) => clients.some(client => id(client) === selected)
  ? selected : clients.length === 1 ? id(clients[0]) : '';
export const creationTeamsForProject = (teams, project) => !project?.teams?.length ? teams
  : teams.filter(team => project.teams.map(id).includes(id(team)));

// No project teams means no automatic company-wide grant. An authorized
// creator must explicitly select a team for a legacy unrestricted project.
export const automaticCreationTeamIds = (teams, project, companyScope) => !project ? [] : companyScope
  ? [...new Set((project.teams || []).map(id))].filter(team => teams.some(item => id(item) === team))
  : teams.map(id);
