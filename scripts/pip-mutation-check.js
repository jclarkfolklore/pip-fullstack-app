#!/usr/bin/env node
// Does the test suite actually have teeth?
//
// A green suite proves nothing on its own — tests that assert the wrong thing,
// or nothing at all, are also green. This deliberately breaks the code in ways
// that MUST be caught, and fails if the suite stays green.
//
// Each mutation reverses a specific bug this suite was written to prevent, so
// a survivor means that protection is fictional.
//
// Always restores the original file, including on crash or Ctrl-C.
//
// Usage: node scripts/pip-mutation-check.js   (or npm run test:mutation)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MUTATIONS = [
  {
    name: 'deleting a task stops writing to activity_log',
    guards: 'the 3 unlogged delete paths found by the audit',
    file: 'server/repo/tasksRepo.js',
    find: "logEvent('task', id, 'task_deleted'",
    replace: "false && logEvent('task', id, 'task_deleted'",
    expect: 'tests/activity-log.test.mjs'
  },
  {
    name: 'deleting a note stops cleaning up its attachments',
    guards: 'orphaned files — SQLite cannot cascade a polymorphic reference',
    file: 'server/repo/notesRepo.js',
    find: "attachmentsRepo.deleteForEntity('note', id);",
    replace: '// mutation: cleanup removed',
    expect: 'tests/attachments.test.mjs'
  },
  {
    name: 'held inbox items are counted as active again',
    guards: 'the inactive/active conflation',
    file: 'server/repo/inboxRepo.js',
    find: 'WHERE deactivated_at IS NULL GROUP BY stage',
    replace: 'GROUP BY stage',
    expect: 'tests/inactive.test.mjs'
  },
  {
    name: 'indexes run before migrations again',
    guards: "today's startup bug — an index on a migration-added column",
    file: 'server/db.js',
    find: 'runMigrations();\n// After migrations',
    replace: 'db.exec(SCHEMA_INDEXES);\nrunMigrations();\n// After migrations',
    expect: 'tests/migrations.test.mjs'
  },
  {
    name: 'the search index drifts from live search',
    guards: 'static snapshot search silently disagreeing with the real app',
    file: 'server/repo/searchRepo.js',
    find: 'function searchIndex({ limit = 5000 } = {}) {',
    replace:
      'function searchIndex({ limit = 5000 } = {}) {\n  if (true) return collect("%", limit).map((r) => ({ ...r, snippet: undefined }));',
    expect: 'tests/search-and-snapshot.test.mjs'
  },
  {
    name: 'reassigning a task logs it as a completion',
    guards: 'Metrics crediting you with a colleague’s work',
    file: 'server/repo/tasksRepo.js',
    find: "logEvent('task', id, 'task_reassigned'",
    replace: "logEvent('task', id, 'task_completed'",
    expect: 'tests/workflows.test.mjs'
  },
  {
    name: 'asset ingest stops being idempotent',
    guards: 'a re-sync silently duplicating every screenshot',
    file: 'scripts/pip-ingest-assets.js',
    find: 'if (seen.has(title)) {',
    replace: 'if (false) {',
    expect: 'tests/ingest-assets.test.mjs'
  },
  {
    name: 'a caption that is just the filename is accepted',
    guards: 'captions that tell a future reader nothing',
    file: 'scripts/pip-ingest-assets.js',
    find: 'problems.push(`[${i}] title is just the filename',
    replace: 'void 0 && problems.push(`[${i}] title is just the filename',
    expect: 'tests/ingest-assets.test.mjs'
  },
  {
    name: "ado-sync's discussion extractor stops stripping editor boilerplate",
    guards: 'QA comments arriving with UI chrome baked in',
    file: '.claude/skills/ado-sync/SKILL.md',
    find: 'd = d.replace(/Markdown supported',
    replace: 'd = d.replace(/NOTHING_MATCHES_THIS',
    expect: 'tests/skills.test.mjs'
  },
  {
    name: 'activity is bucketed by UTC day again',
    guards: "the timezone bug — an evening's work credited to the next day",
    file: 'server/repo/activityRepo.js',
    find: "SELECT date(occurred_at, 'localtime') AS day, event_type, COUNT(*) AS n",
    replace: 'SELECT substr(occurred_at, 1, 10) AS day, event_type, COUNT(*) AS n',
    expect: 'tests/metrics.test.mjs'
  },
  {
    name: 'throughput stops counting task completions',
    guards: 'the headline chart plotting a series that is almost always empty',
    file: 'server/repo/activityRepo.js',
    find: "if (r.event_type === 'task_completed') byDay[r.day].completed += r.n;",
    replace: '// mutation: task completions dropped',
    expect: 'tests/metrics.test.mjs'
  },
  {
    name: 'time-to-close goes back to inbox items only',
    guards: 'an average that reads "—" on a workspace where tasks are the work',
    file: 'server/repo/activityRepo.js',
    find: "    ['task_created', 'task_completed']\n",
    replace: '',
    expect: 'tests/metrics.test.mjs'
  },
  {
    name: 'the activity feed stops resolving entity titles',
    guards: 'anonymous forensic rows — an event with no indication of what it happened to',
    file: 'server/repo/activityRepo.js',
    find: 'COALESCE(t.title, n.title, i.title, p.name, substr(j.body_md, 1, 60)) AS entity_title',
    replace: 'NULL AS entity_title',
    expect: 'tests/metrics.test.mjs'
  },
  {
    name: 'the tag graph links tags that never co-occur',
    guards: 'a network diagram inventing relationships that are not in the data',
    file: 'server/repo/activityRepo.js',
    find: 'ON e1.entity_type = e2.entity_type AND e1.entity_id = e2.entity_id AND e1.tag_id < e2.tag_id',
    replace: 'ON e1.tag_id < e2.tag_id',
    expect: 'tests/metrics.test.mjs'
  },
  {
    name: 'a failing migration is swallowed instead of aborting',
    guards: 'a half-applied migration recorded as complete',
    file: 'server/db.js',
    find: 'if (!isTolerated(err)) {',
    replace: 'if (false) {',
    expect: 'tests/migrations.test.mjs'
  }
];

let restore = null;
function cleanup() {
  if (restore) {
    fs.writeFileSync(restore.file, restore.original);
    restore = null;
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function runSuite(testFile) {
  try {
    execSync(`node --test ${testFile}`, { stdio: 'pipe' });
    return true; // suite passed
  } catch (_) {
    return false; // suite failed
  }
}

console.log('Checking that the suite catches deliberate regressions.\n');

let survived = 0;
for (const m of MUTATIONS) {
  const file = path.join(process.cwd(), m.file);
  const original = fs.readFileSync(file, 'utf8');

  if (!original.includes(m.find)) {
    console.log(`  ?  ${m.name}\n     SKIPPED — anchor not found in ${m.file}; this check has gone stale\n`);
    survived += 1; // a stale check is a failure: it silently protects nothing
    continue;
  }

  restore = { file, original };
  fs.writeFileSync(file, original.replace(m.find, m.replace));

  const stillGreen = runSuite(m.expect);

  fs.writeFileSync(file, original);
  restore = null;

  if (stillGreen) {
    survived += 1;
    console.log(`  ✗  ${m.name}`);
    console.log(`     SURVIVED — ${m.expect} stayed green.`);
    console.log(`     Protection against "${m.guards}" is fictional.\n`);
  } else {
    console.log(`  ✓  ${m.name}`);
    console.log(`     caught by ${m.expect}\n`);
  }
}

if (survived) {
  console.log(`${survived} of ${MUTATIONS.length} mutations survived — the suite has gaps.`);
  process.exit(1);
}
console.log(`All ${MUTATIONS.length} mutations were caught. The suite has teeth.`);
