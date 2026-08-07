// Image attachments placed inline on a few tasks (the way a synced ticket
// does it), document attachments on a few notes, and one reference link —
// enough to exercise every branch of the attachment viewer.
const { addHours } = require('./timeline');
const { makePng, makePdf } = require('./assets');

async function seedAttachments(ctx, { tasks, notes }) {
  const { repos, rng, ev } = ctx;
  const { pick, sample } = rng;

  const shots = [
    { title: 'Booking drawer with focus ring visible on the close button', hue: [0.95, 1.0, 0.92] },
    { title: 'Timetable at 375px — columns overflow the viewport', hue: [1.0, 0.96, 0.9] },
    { title: 'Contrast checker showing 2.9:1 on the footer links', hue: [0.92, 0.94, 1.0] },
    { title: 'Lighthouse run before the image compression pass', hue: [1.0, 0.9, 0.9] },
    { title: 'Fare calculator mid-update, no announcement to screen readers', hue: [0.94, 1.0, 0.98] },
    { title: 'Nav collapsed one breakpoint early at 900px', hue: [0.98, 0.98, 0.94] }
  ];
  const shotTargets = sample(tasks, shots.length);
  for (const [i, shot] of shots.entries()) {
    const target = shotTargets[i];
    const buf = makePng(220, 132, shot.hue);
    const res = await repos.attachmentsRepo.addAttachment({
      entityType: 'task',
      entityId: target.id,
      kind: 'image',
      data: buf.toString('base64'),
      mime: 'image/png',
      title: shot.title,
      source: 'demo'
    });
    // Placed inline, the way a synced ticket does it, so the detail modal
    // shows the image in position rather than as a gallery afterthought.
    const current = repos.tasksRepo.getTask(target.id);
    repos.tasksRepo.updateFields(target.id, {
      detailsMd: `${current.details_md || `## Description\n\n${target.title}.`}\n\n![${shot.title}](/api/attachments/${res.attachment.id}/raw)\n\n*${shot.title}*\n`
    });
    ev('task', target.id, 'task_updated', addHours(target.createdAt, rng.int(2, 24)), { fields: ['attachment'] });
  }

  const docTargets = sample(notes, 2);
  const docs = [
    {
      title: 'Accessibility audit — full findings',
      file: makePdf('Accessibility audit - full findings', [
        '23 issues across the booking and timetable flows.',
        '6 blockers, listed below, agreed as in scope for this phase.',
        '',
        '1. Focus lost when the booking drawer closes.',
        '2. Table headers not associated with their cells.',
        '3. Footer link contrast measured at 2.9:1.',
        '4. Fare calculator updates without an aria-live region.',
        '5. Skip-to-content link missing.',
        '6. Date picker cannot be operated by keyboard.',
        '',
        'Remaining 17 issues are advisory and tracked on the board.'
      ]),
      mime: 'application/pdf'
    },
    {
      title: 'Launch checklist — sign-off sheet',
      file: makePdf('Launch checklist - sign-off sheet', [
        'Content freeze .................... complete',
        'Redirect map verified ............. complete',
        'Analytics events firing ........... complete',
        'Accessibility blockers cleared .... complete',
        'Load test at 3x expected peak ..... complete',
        'Rollback plan documented .......... complete',
        '',
        'Signed off by the product owner ahead of the release window.'
      ]),
      mime: 'application/pdf'
    }
  ];
  for (const [i, doc] of docs.entries()) {
    const target = docTargets[i];
    await repos.attachmentsRepo.addAttachment({
      entityType: 'note',
      entityId: target.id,
      kind: 'file',
      data: doc.file.toString('base64'),
      mime: doc.mime,
      title: doc.title,
      source: 'demo'
    });
    ev('note', target.id, 'note_updated', addHours(target.createdAt, rng.int(2, 30)), { fields: ['attachment'] });
  }

  // A reference link too, so the links section of the detail modal is used.
  const linkTarget = pick(notes);
  await repos.attachmentsRepo.addAttachment({
    entityType: 'note',
    entityId: linkTarget.id,
    kind: 'link',
    rel: 'design',
    url: 'https://example.com/design/booking-flow',
    title: 'Booking flow — design file',
    source: 'demo'
  });
}

module.exports = { seedAttachments };
