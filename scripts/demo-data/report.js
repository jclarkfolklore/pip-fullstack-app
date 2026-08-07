// A quick summary printed after seeding, so a run can be eyeballed for
// realism (counts, span, active days) without opening the database.
function report(db, outPath) {
  const counts = {
    projects: db.prepare('SELECT COUNT(*) n FROM projects').get().n,
    inbox: db.prepare('SELECT COUNT(*) n FROM inbox_items').get().n,
    tasks: db.prepare('SELECT COUNT(*) n FROM tasks').get().n,
    notes: db.prepare('SELECT COUNT(*) n FROM notes').get().n,
    journal: db.prepare('SELECT COUNT(*) n FROM journal_entries').get().n,
    contacts: db.prepare('SELECT COUNT(*) n FROM project_contacts').get().n,
    attachments: db.prepare('SELECT COUNT(*) n FROM attachments').get().n,
    tags: db.prepare('SELECT COUNT(*) n FROM tags').get().n,
    events: db.prepare('SELECT COUNT(*) n FROM activity_log').get().n
  };
  const span = db.prepare('SELECT MIN(occurred_at) a, MAX(occurred_at) b FROM activity_log').get();
  const activeDays = db.prepare("SELECT COUNT(DISTINCT date(occurred_at,'localtime')) n FROM activity_log").get().n;

  console.log(`demo database: ${outPath}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log(`  ${'span'.padEnd(12)} ${span.a.slice(0, 10)} -> ${span.b.slice(0, 10)} (${activeDays} active days)`);
}

module.exports = { report };
