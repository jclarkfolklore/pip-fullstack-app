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
