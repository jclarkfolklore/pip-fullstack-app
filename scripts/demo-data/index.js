#!/usr/bin/env node
// Builds a throwaway database of entirely fictional data, for the shareable
// static snapshot.
//
// WHY THIS EXISTS. The snapshot captures whatever the API returns, so pointed
// at the real database it would publish real client work. This writes a
// separate file from scratch and never opens data/pip.sqlite, so the sharing
// pipeline has no path to real data at all — the safety is structural, not a
// matter of remembering to scrub something.
//
// WHAT IT AIMS FOR. Not "some rows" — a workspace that looks like it has been
// lived in for three months, because the parts of PIP worth showing only
// appear with history behind them: the contribution calendar, throughput,
// time-to-close, the tag network, per-project small multiples. So every
// feature gets exercised deliberately (see FEATURE COVERAGE below) rather
// than incidentally.
//
// HOW THE TIMELINE WORKS. The repos stamp "now" on everything they write,
// which is correct for the app and useless here. So seeding runs in two
// passes: build the records through the real repos (getting real schema,
// tags, links and validation — see seed*.js), then retime.js rewrites each
// row's dates and replaces activity_log wholesale with a backdated history
// whose events match the rows they describe. Deriving the log from the same
// plan that set the row dates is what keeps "current state" and "history"
// agreeing.
//
// DETERMINISTIC. Fixed seed (rng.js), and the only clock reading is "today"
// (timeline.js), so the same command produces the same workspace. A demo
// that reshuffles every build is impossible to review or to speak to.
//
// WHY IT'S A DIRECTORY, NOT ONE FILE. This started as a single ~1100-line
// script. It's meant to be revisited every time the data model changes (see
// freshnessCheck.js) or the demo needs new realism tuning, so it's split by
// concern instead:
//
//   rng.js               seeded PRNG — self-contained, no shared state
//   timeline.js           the calendar: offsets, work hours, holidays,
//                         sprint rhythm, close-time distribution
//   world.js              fictional clients/people/tags/copy
//   assets.js              generated PNG/PDF bytes for attachments
//   eventLog.js            collects the planned activity_log as seeding runs
//   seedProjects.js         one seed*.js per entity type — each takes the
//   seedInbox.js            shared `ctx` (db, repos, rng, timeline, world,
//   seedTasks.js            ev) plus whatever earlier entities it needs
//   seedNotes.js            (e.g. seedTasks needs the inbox items it can
//   seedJournal.js          spawn from), and returns what it created so a
//   seedAttachments.js      later stage can reference it
//   seedWeather.js           fabricated forecast — see its header for why
//                            this one is faked rather than fetched
//   retime.js               the second pass described above
//   report.js               prints counts + span after a run
//   freshnessCheck.js       "has the real schema moved past what this
//                           module was reviewed against?" — see its header
//
// FEATURE COVERAGE: projects (open + closed) with contacts; inbox across
// every stage including held; tasks in every status with due dates, overdue
// work, and inbox->task provenance; notes with rich markdown (tables, code,
// quotes, inline images) and pinning; journal entries tied to projects;
// tags that genuinely co-occur so the network has clusters; image AND
// document attachments; synced-source metadata (monday/ADO refs, links,
// source_meta_json) so the ticket modal has something to render.
//
// Usage:  node scripts/demo-data/index.js [outFile]
//         npm run seed:demo

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'data', 'demo.sqlite'));

if (path.basename(OUT) === 'pip.sqlite') {
  console.error('refusing to seed over pip.sqlite — this script only writes throwaway databases');
  process.exit(1);
}

// Start clean; a re-run should replace the demo, not accumulate on top of it.
for (const suffix of ['', '-wal', '-shm']) {
  const f = OUT + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
process.env.PIP_DB_PATH = OUT;

const { db } = require(path.join(ROOT, 'server/db.js'));
const repos = {
  projectsRepo: require(path.join(ROOT, 'server/repo/projectsRepo.js')),
  inboxRepo: require(path.join(ROOT, 'server/repo/inboxRepo.js')),
  tasksRepo: require(path.join(ROOT, 'server/repo/tasksRepo.js')),
  notesRepo: require(path.join(ROOT, 'server/repo/notesRepo.js')),
  journalRepo: require(path.join(ROOT, 'server/repo/journalRepo.js')),
  attachmentsRepo: require(path.join(ROOT, 'server/repo/attachmentsRepo.js'))
};

const { createRng } = require('./rng');
const { createTimeline } = require('./timeline');
const { createWorld } = require('./world');
const { createEventLog } = require('./eventLog');
const { seedProjects } = require('./seedProjects');
const { seedInbox } = require('./seedInbox');
const { seedTasks } = require('./seedTasks');
const { seedNotes } = require('./seedNotes');
const { seedJournal } = require('./seedJournal');
const { seedAttachments } = require('./seedAttachments');
const { seedWeather } = require('./seedWeather');
const { retime } = require('./retime');
const { report } = require('./report');
const { checkSchemaVersion } = require('./freshnessCheck');

async function main() {
  // Fail before writing anything if the module hasn't been reviewed against
  // the current schema — see freshnessCheck.js. A demo that silently drifts
  // out of sync with the real data model is worse than one that refuses to
  // build, because drift doesn't throw: it just stops exercising whatever
  // changed.
  const versionCheck = checkSchemaVersion();
  if (!versionCheck.ok) {
    console.error(versionCheck.message);
    process.exit(1);
  }

  const rng = createRng();
  const timeline = createTimeline(rng);
  const world = createWorld(rng);
  const eventLog = createEventLog();
  const ctx = { db, repos, rng, timeline, world, ev: eventLog.ev, eventLog };

  const projects = seedProjects(ctx);
  const inboxItems = seedInbox(ctx, { projects });
  const tasks = seedTasks(ctx, { projects, inboxItems });
  const notes = seedNotes(ctx, { projects });
  seedJournal(ctx, { projects });
  await seedAttachments(ctx, { tasks, notes });

  retime(ctx, { projects, inboxItems, tasks, notes });

  // Weather is faked rather than fetched — see seedWeather.js for why. Clu3
  // gets no scripted line at all: currentState() (server/repo/clu3Repo.js)
  // computes its state live from whatever's in the database, so leaving it
  // alone means the demo shows the same rules engine reacting to the same
  // kind of realistic signals it would react to for real — a genuinely
  // representative state instead of a canned one. The banner already carries
  // the "none of this is real" disclaimer; Clu3 doesn't need to repeat it.
  seedWeather(ctx);

  // Mark the database itself as fictional, rather than passing a --demo flag
  // through the snapshot pipeline. A flag can be forgotten on one run and the
  // snapshot then publishes fake data claiming to be real, which is the exact
  // failure this whole thing exists to prevent. Stamped on the data, the
  // "not real" notice travels with it and cannot come apart from it.
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('demo_data', '1')").run();

  report(db, OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
