// The repos stamped "now" on every row and every event, which is correct for
// the app and useless here. This rewrites both to the planned timeline, in
// one transaction, so the demo can never be left half-retimed.
const { iso } = require('./timeline');

function retime(ctx, world) {
  const { db, timeline, eventLog } = ctx;
  const { momentOn, workday } = timeline;

  const tx = db.transaction(() => {
    for (const item of world.inboxItems) {
      const changed = item.closedAt || item.heldAt || item.createdAt;
      db.prepare('UPDATE inbox_items SET created_at = ?, stage_changed_at = ?, deactivated_at = ? WHERE id = ?').run(
        iso(item.createdAt),
        iso(changed),
        item.heldAt ? iso(item.heldAt) : null,
        item.id
      );
    }
    for (const task of world.tasks) {
      db.prepare('UPDATE tasks SET created_at = ?, completed_at = ? WHERE id = ?').run(
        iso(task.createdAt),
        task.doneAt ? iso(task.doneAt) : null,
        task.id
      );
    }
    for (const note of world.notes) {
      db.prepare('UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?').run(
        iso(note.createdAt),
        iso(note.createdAt),
        note.id
      );
    }
    for (const project of world.projects) {
      db.prepare('UPDATE projects SET created_at = ? WHERE id = ?').run(iso(project.createdAt), project.id);
    }
    db.prepare('UPDATE project_contacts SET created_at = ?').run(iso(momentOn(ctx.rng.int(1, 20))));

    // Attachments were all created "now"; spread them over the window so the
    // activity feed does not show a wall of identical timestamps.
    for (const row of db.prepare('SELECT id FROM attachments').all()) {
      db.prepare('UPDATE attachments SET created_at = ? WHERE id = ?').run(iso(momentOn(workday())), row.id);
    }

    // The log is rebuilt rather than patched: the repos wrote a "now" event
    // for every call above, and those are exactly what must not survive.
    db.prepare('DELETE FROM activity_log').run();
    const insert = db.prepare(
      'INSERT INTO activity_log (id, entity_type, entity_id, event_type, detail_json, occurred_at) VALUES (?,?,?,?,?,?)'
    );
    const events = eventLog.all().slice();
    events.sort((a, b) => (a.when < b.when ? -1 : 1));
    events.forEach((e, i) => {
      insert.run(
        `demo-ev-${String(i).padStart(5, '0')}`,
        e.entityType,
        e.entityId,
        e.eventType,
        JSON.stringify(e.detail),
        e.when
      );
    });
  });
  tx();
}

module.exports = { retime };
