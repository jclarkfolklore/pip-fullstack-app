// Tasks in every status, some traceable back to the inbox item that spawned
// them, with due dates that mostly line up with reality. See index.js for
// why work-in-progress is kept deliberately small.
const { addHours, iso } = require('./timeline');

function seedTasks(ctx, { projects, inboxItems }) {
  const { repos, rng, timeline, world, ev } = ctx;
  const { pick, chance, int } = rng;
  const { DAYS, TODAY, momentOn, workday, settleDay, closeMoment } = timeline;

  const resolvedInbox = inboxItems.filter((i) => i.stage === 'resolved');
  const tasks = [];
  for (let i = 0; i < 235; i++) {
    const parent = chance(0.3) && resolvedInbox.length ? pick(resolvedInbox) : null;
    const project = parent ? parent.project : chance(0.9) ? pick(projects) : null;
    const client = project ? project.name : 'internal';
    const sourceType = parent ? 'manual' : pick(world.SOURCE_TYPES);
    const ref = world.sourceRefFor(sourceType);
    const createdOffset = parent
      ? Math.min(DAYS - 1, DAYS - Math.round((TODAY - parent.createdAt) / 864e5) + int(0, 3))
      : workday();
    const createdAt = momentOn(Math.max(0, Math.min(DAYS - 1, createdOffset)));
    const title = pick(world.TASK_TITLES);

    // Outcome is decided before the row is written, because the due date and
    // the status have to agree — a deadline is only meaningful relative to
    // whether the work actually landed.
    //
    // Work-in-progress has to stay small and the pile has to stay short. The
    // obvious formulation — "old tasks are usually done, everything else is
    // in progress" — left every recent task in `doing` and reported 51
    // things underway at once, which nobody has, least of all someone on top
    // of their work.
    const age = DAYS - createdOffset;
    const roll = rng.rnd();
    let status;
    if (age > 5) status = roll < 0.93 ? 'done' : roll < 0.96 ? 'doing' : 'open';
    else status = roll < 0.42 ? 'done' : roll < 0.6 ? 'doing' : 'open';

    const startedAt = status === 'open' ? null : addHours(createdAt, int(2, 40));
    const doneAt = status === 'done' ? closeMoment(createdOffset, createdAt) : null;
    // Same rule as the inbox: a completion that would fall after today
    // hasn't happened, so the task is still underway rather than finished.
    if (status === 'done' && doneAt === null) status = 'doing';

    // Deadlines that were met, or that are still ahead — bar the odd one that
    // genuinely slipped, because a board with zero overdue work looks staged.
    let dueDate = null;
    if (chance(0.5)) {
      if (status === 'done') {
        dueDate = iso(addHours(doneAt, int(-30, 60)));
      } else {
        const d = new Date(TODAY);
        d.setDate(d.getDate() + (chance(0.9) ? int(1, 21) : -int(1, 4)));
        dueDate = iso(d);
      }
    }

    const id = repos.tasksRepo.createTask({
      title,
      notesMd: chance(0.4)
        ? pick([
            'Reproduced on staging before starting.',
            'Blocked until the design token update lands.',
            'Smaller than it looked — the fix is one line plus a test.',
            'Needs a QA pass on a real device, not just the emulator.'
          ])
        : '',
      projectId: project ? project.id : null,
      dueAt: dueDate,
      fromInboxItemId: parent ? parent.id : null,
      tags: world.tagSet()
    });
    ev('task', id, 'task_created', createdAt, { title, fromInboxItemId: parent ? parent.id : null });

    if (ref) {
      repos.tasksRepo.updateFields(id, {
        sourceType,
        sourceRef: ref,
        sourceUrl: world.sourceUrlFor(sourceType, ref),
        detailsMd: `## Description\n\n${title}. Reported against ${client}.\n\n## Acceptance criteria\n\n- Behaviour corrected at all supported breakpoints\n- Covered by a regression test where practical`,
        sourceMeta: world.sourceMetaFor(sourceType, client)
      });
    }

    if (status !== 'open') {
      repos.tasksRepo.setTaskStatus(id, 'doing');
      ev('task', id, 'task_status_changed', startedAt, { status: 'doing' });
    }
    if (status === 'done') {
      repos.tasksRepo.setTaskStatus(id, 'done');
      ev('task', id, 'task_completed', doneAt, {});
    }
    // Most real records are touched more than once between opening and
    // closing; without this the log is one event per row and the activity
    // feed reads like an import rather than a history.
    for (let k = 0, n = int(0, 3); k < n; k++) {
      const day = settleDay(createdOffset, 0, 10);
      if (day === null) continue;
      ev('task', id, 'task_updated', momentOn(day), {
        fields: [pick(['notesMd', 'dueAt', 'detailsMd', 'projectId'])]
      });
    }

    tasks.push({ id, project, createdAt, status, doneAt, title });
  }

  return tasks;
}

module.exports = { seedTasks };
