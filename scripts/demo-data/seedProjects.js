// Projects and their contacts. Two of the six are marked closed, so the
// Projects view has both states to show.
const { addHours } = require('./timeline');

function seedProjects(ctx) {
  const { repos, rng, timeline, world, ev } = ctx;
  const { sample, int } = rng;
  const { momentOn } = timeline;

  const projects = world.CLIENTS.map((c, i) => {
    const id = repos.projectsRepo.createProject({ name: c.name });
    const createdOffset = i < 2 ? int(0, 6) : int(0, 20);
    const createdAt = momentOn(createdOffset);
    const closed = c.short === 'FCM' || c.short === 'ABC';
    if (closed) repos.projectsRepo.updateProject(id, { status: 'closed' });
    ev('project', id, 'project_created', createdAt, { name: c.name });
    if (closed) ev('project', id, 'project_updated', momentOn(int(70, 88)), { name: c.name, status: 'closed' });

    for (const person of sample(world.PEOPLE, int(2, 3))) {
      repos.projectsRepo.addContact(id, {
        name: person.name,
        role: person.role,
        org: person.org === 'client' ? c.name : 'Studio',
        email:
          c.domain && person.org === 'client'
            ? `${person.name.split(' ')[0].toLowerCase()}@${c.domain}`
            : `${person.name.split(' ')[0].toLowerCase()}@studio.example`
      });
      ev('project', id, 'project_contact_added', addHours(createdAt, int(1, 40)), {
        name: person.name,
        role: person.role
      });
    }
    return { ...c, id, createdAt, closed };
  });

  return projects;
}

module.exports = { seedProjects };
