// Journal entries, mostly tied to a project still open — reflections on
// finished work read oddly attached to a project that's since closed.
const { iso } = require('./timeline');

function seedJournal(ctx, { projects }) {
  const { db, repos, rng, timeline, world, ev } = ctx;
  const { pick, chance } = rng;
  const { momentOn, workday } = timeline;

  const active = projects.filter((p) => !p.closed);

  for (let i = 0; i < 61; i++) {
    const project = chance(0.6) ? pick(active) : null;
    const client = project ? project.name : 'the studio';
    const createdOffset = workday();
    const createdAt = momentOn(createdOffset);
    const id = repos.journalRepo.createEntry({
      bodyMd: pick(world.JOURNAL_BODIES)({ client, person: pick(world.PEOPLE).name }),
      projectId: project ? project.id : null
    });
    ev('journal_entry', id, 'journal_created', createdAt, {});
    db.prepare('UPDATE journal_entries SET created_at = ?, updated_at = ? WHERE id = ?').run(
      iso(createdAt),
      iso(createdAt),
      id
    );
  }
}

module.exports = { seedJournal };
