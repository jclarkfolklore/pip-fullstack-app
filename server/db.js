const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const {
  SCHEMA_VERSION,
  SCHEMA_SQL,
  SCHEMA_INDEXES,
  SEED_WIDGETS,
  SEED_PROJECTS,
  MIGRATIONS
} = require('./schema');

// The live database file lives in <repo-root>/data/pip.sqlite, tracked in
// git alongside the code (this is a personal/private app, not shipped
// software — see CLAUDE.md). Override with PIP_DB_PATH if needed.
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'pip.sqlite');
const DB_PATH = process.env.PIP_DB_PATH || DEFAULT_DB_PATH;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function seedIfEmpty() {
  const widgetCount = db.prepare('SELECT COUNT(*) AS n FROM widgets').get().n;
  if (widgetCount === 0) {
    const insertWidget = db.prepare(
      'INSERT INTO widgets (id, kind, title, glyph, sort_order) VALUES (?,?,?,?,?)'
    );
    for (const w of SEED_WIDGETS) insertWidget.run(w.id, w.kind, w.title, w.glyph, w.sort_order);
  }
  const projectCount = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  if (projectCount === 0) {
    const insertProject = db.prepare(
      'INSERT INTO projects (id, name, color, sort_order, created_at) VALUES (?,?,?,?,?)'
    );
    const now = new Date().toISOString();
    for (const p of SEED_PROJECTS) insertProject.run(p.id, p.name, p.color, p.sort_order, now);
  }
}

// Errors that genuinely mean "this migration step is already satisfied".
//
// This list is deliberately NARROW. The previous runner caught everything and
// stamped the version as applied regardless, so a migration could fail for a
// real reason — a typo, a constraint violation, a missing table — and be
// recorded as complete. That is the most dangerous thing that can happen in a
// data layer: the schema and the version number disagree, silently, forever.
//
// Anything not matched here aborts the whole version.
const TOLERATED = [
  /duplicate column name/i, // ALTER TABLE ADD COLUMN re-run
  /already exists/i, // CREATE TABLE/INDEX re-run
  /no such column/i // DROP COLUMN for a column this database never had
];

function isTolerated(err) {
  return TOLERATED.some((re) => re.test(err.message));
}

function checksum(statements) {
  return crypto.createHash('sha256').update(statements.join(';')).digest('hex').slice(0, 16);
}

function ensureMigrationsTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
     version INTEGER PRIMARY KEY,
     checksum TEXT NOT NULL,
     applied_at TEXT NOT NULL,
     tolerated INTEGER NOT NULL DEFAULT 0
   )`);
}

// Applies one version atomically. Either every statement lands (modulo
// tolerated no-ops) or the database is left exactly as it was.
function applyMigration(migration) {
  let tolerated = 0;
  const run = db.transaction(() => {
    for (const statement of migration.statements) {
      try {
        db.exec(statement);
      } catch (err) {
        if (!isTolerated(err)) {
          // Abort the transaction — better a loud failure at boot than a
          // database whose shape matches no version.
          throw new Error(
            `migration v${migration.version} failed: ${err.message}\n  statement: ${statement.trim().slice(0, 120)}`
          );
        }
        tolerated += 1;
      }
    }
    db.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, checksum, applied_at, tolerated) VALUES (?,?,?,?)'
    ).run(migration.version, checksum(migration.statements), new Date().toISOString(), tolerated);
  });
  run();
  return tolerated;
}

// Warn if a migration that already ran has since been edited. Editing applied
// history means two databases claiming the same version can have different
// shapes — which is exactly the drift that's impossible to debug later.
function verifyAppliedChecksums() {
  const applied = new Map(
    db
      .prepare('SELECT version, checksum FROM schema_migrations')
      .all()
      .map((r) => [r.version, r.checksum])
  );
  for (const m of MIGRATIONS) {
    const seen = applied.get(m.version);
    if (seen && seen !== checksum(m.statements)) {
      console.warn(
        `[pip] migration v${m.version} has changed since it was applied here. ` +
          `Databases at this version may not match. Add a new migration instead of editing an old one.`
      );
    }
  }
}

function runMigrations() {
  ensureMigrationsTable();

  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get();
  const stored = row ? parseInt(row.value, 10) : null;

  if (stored === null) {
    // Brand-new database: SCHEMA_SQL already built the current shape, so mark
    // every migration as applied rather than replaying them against it.
    for (const m of MIGRATIONS) {
      db.prepare(
        'INSERT OR REPLACE INTO schema_migrations (version, checksum, applied_at, tolerated) VALUES (?,?,?,0)'
      ).run(m.version, checksum(m.statements), new Date().toISOString());
    }
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION)
    );
    return;
  }

  // A database that predates this table was migrated by the old runner, which
  // kept no record. Backfill everything at or below its version as applied, so
  // checksum drift detection works from here on rather than only for databases
  // created after this change.
  const recorded = db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n;
  if (recorded === 0) {
    const backfill = db.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, checksum, applied_at, tolerated) VALUES (?,?,?,0)'
    );
    const now = new Date().toISOString();
    for (const m of MIGRATIONS.filter((m) => m.version <= stored)) {
      backfill.run(m.version, checksum(m.statements), now);
    }
  }

  verifyAppliedChecksums();

  const pending = MIGRATIONS.filter((m) => m.version > stored);
  for (const migration of pending) {
    const tolerated = applyMigration(migration);
    const note = tolerated ? ` (${tolerated} step(s) already satisfied)` : '';
    console.log(`[pip] migrated to v${migration.version}${note}`);
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)").run(
    String(SCHEMA_VERSION)
  );
}

db.exec(SCHEMA_SQL);
seedIfEmpty();
runMigrations();
// After migrations, so an index can safely reference a column a migration
// added. See the note on SCHEMA_INDEXES in schema.js.
db.exec(SCHEMA_INDEXES);

// PRAGMA data_version bumps whenever ANY connection to this file — including
// Claude editing it directly with a separate script/CLI, entirely outside
// this server — commits a change. That's what lets /api/events notice and
// broadcast a refresh to open tabs without every writer having to remember
// to signal it explicitly.
function dataVersion() {
  return db.pragma('data_version', { simple: true });
}

module.exports = { db, DB_PATH, dataVersion };
