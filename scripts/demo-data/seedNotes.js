// Notes with rich markdown (tables, code, quotes) and occasional pinning.
const { iso } = require('./timeline');

function seedNotes(ctx, { projects }) {
  const { repos, rng, timeline, world, ev } = ctx;
  const { pick, chance, int } = rng;
  const { momentOn, workday, settleDay } = timeline;

  const notes = [];
  for (let i = 0; i < 44; i++) {
    const project = chance(0.85) ? pick(projects) : null;
    const client = project ? project.name : 'the studio';
    const person = pick(world.PEOPLE).name;
    const createdOffset = workday();
    const createdAt = momentOn(createdOffset);
    const body = pick(world.NOTE_BODIES)({ client, person });
    const title = pick([
      `${client} — sync notes`,
      `${client} — integration notes`,
      `${client} — accessibility audit`,
      `${client} — launch checklist`,
      'Decisions worth writing down',
      `${client} — content requirements`
    ]);
    const id = repos.notesRepo.createNote({
      title,
      bodyMd: body,
      source: person,
      sourceType: pick(['email', 'chat', 'manual', 'monday']),
      projectId: project ? project.id : null,
      tags: world.tagSet(),
      pinned: chance(0.18),
      createdAt: iso(createdAt)
    });
    ev('note', id, 'note_created', createdAt, { title });
    for (let k = 0, n = int(0, 2); k < n; k++) {
      const day = settleDay(createdOffset, 1, 20);
      if (day !== null) ev('note', id, 'note_updated', momentOn(day), { fields: ['bodyMd'] });
    }
    notes.push({ id, project, createdAt, title });
  }

  return notes;
}

module.exports = { seedNotes };
