// Inbox items across every stage — new, active, resolved, archived, and a
// handful held/deactivated. Age decides the outcome: old items are mostly
// settled, recent ones are still open, which is what makes the inbox read
// as a real queue rather than a pile. This workspace belongs to someone who
// keeps on top of things, so almost everything older than a week has been
// dealt with — see the demo's design note in index.js.
const { addHours, iso } = require('./timeline');

function seedInbox(ctx, { projects }) {
  const { repos, rng, timeline, world, ev } = ctx;
  const { pick, chance } = rng;
  const { DAYS, dayStart, momentOn, workday, settleDay, closeMoment } = timeline;

  const inboxItems = [];
  for (let i = 0; i < 86; i++) {
    const project = chance(0.85) ? pick(projects) : null;
    const client = project ? project.name : 'the studio';
    const sourceType = pick(world.SOURCE_TYPES);
    const ref = world.sourceRefFor(sourceType);
    const createdOffset = workday();
    const createdAt = momentOn(createdOffset);
    const title = pick(world.INBOX_TITLES);
    const person = pick(world.PEOPLE).name;

    const id = repos.inboxRepo.createInboxItem({
      title,
      bodyMd: `**${client}** — raised by ${person}.\n\n${pick([
        'Came in over the weekly call; capturing it here so it does not get lost.',
        'Forwarded on from the client with a request for a rough estimate.',
        'Spotted while testing something unrelated. Reproducible on staging.',
        'Follow-up on a thread that had gone quiet for a week.'
      ])}\n\n- Raised: ${dayStart(createdOffset).toDateString()}\n- Needs: ${pick([
        'a decision',
        'an estimate',
        'a reply',
        'triage into tasks'
      ])}`,
      source: person,
      sourceType,
      sourceUrl: world.sourceUrlFor(sourceType, ref),
      projectId: project ? project.id : null,
      tags: world.tagSet(),
      createdAt: iso(createdAt)
    });
    ev('inbox_item', id, 'inbox_created', createdAt, { title, source: person, sourceType });

    if (ref) {
      repos.inboxRepo.updateFields(id, {
        sourceRef: ref,
        detailsMd: `## Description\n\n${title}.\n\n## Acceptance criteria\n\n- The reported behaviour no longer occurs\n- No regression at mobile or desktop breakpoints`,
        sourceMeta: world.sourceMetaFor(sourceType, client)
      });
    }

    const age = DAYS - createdOffset;
    const roll = rng.rnd();
    let stage = 'active';
    let closedAt = null;
    if (age > 6 && roll < 0.84) {
      stage = 'resolved';
      closedAt = closeMoment(createdOffset, createdAt);
    } else if (age > 20 && roll < 0.95) {
      stage = 'archived';
      closedAt = closeMoment(createdOffset, createdAt);
    } else if (age < 3 && roll < 0.4) {
      stage = 'new';
    }
    // A close that would land after today means the item is still in flight.
    if (closedAt === null && stage !== 'new') stage = 'active';

    if (stage === 'resolved') {
      repos.inboxRepo.resolveWithOutcome(
        id,
        pick([
          'Resolved — turned into tasks and shipped in the following sprint.',
          'Answered directly; no work needed.',
          'Confirmed fixed on staging and signed off by the client.',
          'Superseded by a later request covering the same ground.'
        ])
      );
      ev('inbox_item', id, 'inbox_resolved', closedAt, {});
    } else if (stage === 'archived') {
      repos.inboxRepo.archiveItem(id);
      ev('inbox_item', id, 'inbox_archived', closedAt, {});
    } else if (stage === 'new') {
      repos.inboxRepo.setStage(id, 'new');
    } else {
      repos.inboxRepo.setStage(id, 'active');
      ev('inbox_item', id, 'inbox_stage_changed', addHours(createdAt, rng.int(2, 30)), {
        from: 'new',
        to: 'active'
      });
    }

    // A couple parked on hold, so the inactive treatment is visible.
    let heldAt = null;
    const heldDay = stage === 'active' && chance(0.14) ? settleDay(createdOffset, 2, 8) : null;
    if (heldDay !== null) {
      repos.inboxRepo.deactivateItem(id);
      heldAt = momentOn(heldDay);
      ev('inbox_item', id, 'inbox_deactivated', heldAt, {});
    }

    inboxItems.push({ id, project, createdAt, stage, closedAt, heldAt, title });
  }

  return inboxItems;
}

module.exports = { seedInbox };
