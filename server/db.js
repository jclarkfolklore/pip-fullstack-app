const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { SCHEMA_VERSION, SCHEMA_SQL, SEED_WIDGETS, SEED_PROJECTS, MIGRATIONS } = require('./schema');

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

function runMigrations() {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get();
  const stored = row ? parseInt(row.value, 10) : null;
  if (stored === null) {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION)
    );
    return;
  }
  for (const migration of MIGRATIONS) {
    if (migration.version > stored) {
      for (const statement of migration.statements) {
        try {
          db.exec(statement);
        } catch (err) {
          console.warn(`[pip] migration v${migration.version} statement failed (continuing):`, err.message);
        }
      }
    }
  }
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)").run(
    String(SCHEMA_VERSION)
  );
}

db.exec(SCHEMA_SQL);
seedIfEmpty();
runMigrations();

// PRAGMA data_version bumps whenever ANY connection to this file — including
// Claude editing it directly with a separate script/CLI, entirely outside
// this server — commits a change. That's what lets /api/events notice and
// broadcast a refresh to open tabs without every writer having to remember
// to signal it explicitly.
function dataVersion() {
  return db.pragma('data_version', { simple: true });
}

module.exports = { db, DB_PATH, dataVersion };
