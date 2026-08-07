#!/usr/bin/env node
// Answers one question: does this module still match the real data model?
//
// WHY THIS EXISTS. The seeder writes through the real repos (server/db.js
// etc.), so a schema change that a repo already handles will keep seeding
// without error — but a NEW table or column that nothing in scripts/demo-data
// happens to touch fails silently. The demo then quietly stops exercising
// whatever feature that table/column was for, and nobody notices until
// someone looks at the deployed link and asks why a section is empty. This
// is the check that's supposed to catch that before a deploy, not after.
//
// TWO INDEPENDENT CHECKS:
//
//   1. Schema-version pin. VERIFIED_SCHEMA_VERSION below records the schema
//      version this module was last reviewed against. server/schema.js's
//      SCHEMA_VERSION is bumped on every migration (see CLAUDE.md's
//      "Schema changes" convention) — if it has moved past this pin, someone
//      changed the data model and hasn't confirmed the demo module still
//      covers it. Bump the pin only after actually checking: does the new
//      column/table need a seed*.js update to stay exercised?
//
//   2. Table coverage. After a real seed run, every real table should have
//      at least one row — a table with zero rows is either a schema table
//      the seeder was never taught about, or a feature the demo doesn't
//      demonstrate. Cheap and generic: no per-table list to maintain, it
//      just asks sqlite what tables exist and checks each one.
//
// Usage:  node scripts/demo-data/freshnessCheck.js [dbPath]
//         npm run demo:check
//
// Exits non-zero (and prints why) if either check fails — meant to run
// before every deploy of the demo snapshot, not just when someone remembers.

const path = require('path');

// This is a plain number literal, not a `require` of SCHEMA_VERSION at
// review time — the point is to freeze what was true when someone last
// looked, so a later bump in server/schema.js is visible as a diff here
// rather than silently tracking it.
const VERIFIED_SCHEMA_VERSION = 13;

// Tables that are allowed to be empty in a real, working demo — chrome or
// caches rather than content, so "zero rows" there says nothing about
// coverage. Keep this short; a table landing here should be a deliberate
// call, not a default.
const ALLOW_EMPTY = new Set([
  // Deliberately empty. currentState() (server/repo/clu3Repo.js) computes
  // Clu3's line live from real signals whenever nothing is queued here — the
  // demo relies on exactly that, so it shows the same rules engine reacting
  // to the seeded (fictional) workspace instead of a scripted line. A row
  // here would silently pre-empt that and always win over the real engine
  // (see pendingMessage() in clu3Repo.js).
  'clu3_messages'
]);

function checkSchemaVersion() {
  const { SCHEMA_VERSION } = require(path.join(__dirname, '..', '..', 'server', 'schema.js'));
  if (SCHEMA_VERSION === VERIFIED_SCHEMA_VERSION) {
    return { ok: true, message: `schema version: v${SCHEMA_VERSION} (matches what this module was reviewed against)` };
  }
  return {
    ok: false,
    message:
      `server/schema.js is at v${SCHEMA_VERSION}, but scripts/demo-data was last reviewed at v${VERIFIED_SCHEMA_VERSION}.\n` +
      `  Someone changed the data model since. Before deploying the demo:\n` +
      `    1. Read the migration(s) between v${VERIFIED_SCHEMA_VERSION} and v${SCHEMA_VERSION} in server/schema.js.\n` +
      `    2. Decide whether any new table/column needs a seed*.js update to stay exercised.\n` +
      `    3. Bump VERIFIED_SCHEMA_VERSION in scripts/demo-data/freshnessCheck.js to ${SCHEMA_VERSION}.`
  };
}

function listTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
}

// Requires an already-seeded database (any recent seed:demo run) — this does
// not seed one itself, since the whole point is to check output that already
// exists rather than pay for a fresh run every time.
function checkTableCoverage(dbPath) {
  const Database = require('better-sqlite3');
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    return { ok: false, message: `can't open ${dbPath} — run \`npm run seed:demo\` first (${err.message})` };
  }
  try {
    const empty = listTables(db)
      .filter((name) => !ALLOW_EMPTY.has(name))
      .filter((name) => db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n === 0);
    if (empty.length) {
      return {
        ok: false,
        message:
          `these tables have zero rows in ${dbPath}: ${empty.join(', ')}\n` +
          `  Either scripts/demo-data doesn't seed them yet (add coverage in the matching seed*.js,\n` +
          `  or a new one if it's a new feature), or they're genuinely fine empty — in which case\n` +
          `  add them to ALLOW_EMPTY in freshnessCheck.js with a one-line reason.`
      };
    }
    return { ok: true, message: `table coverage: every table in ${dbPath} has rows` };
  } finally {
    db.close();
  }
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--schema-only');
  // --schema-only skips table coverage, which needs an already-seeded
  // database — useful as a fast pre-flight before spending time seeding one
  // (see scripts/pip-snapshot-demo.js, which runs both: this check before
  // seeding, and the full pair again against the fresh output afterward).
  const schemaOnly = process.argv.includes('--schema-only');
  const dbPath = path.resolve(args[0] || path.join(__dirname, '..', '..', 'data', 'demo.sqlite'));
  const results = [checkSchemaVersion()];
  if (!schemaOnly) results.push(checkTableCoverage(dbPath));

  let failed = false;
  for (const r of results) {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.message}`);
    if (!r.ok) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

module.exports = { checkSchemaVersion, checkTableCoverage, VERIFIED_SCHEMA_VERSION };

if (require.main === module) main();
