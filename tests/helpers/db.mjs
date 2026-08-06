// Test-database helper.
//
// Every integration test runs against a REAL SQLite file, not a mock. The bugs
// this suite exists to catch — migration ordering, cascade behaviour, CHECK
// constraints — are all things a mock reproduces incorrectly by construction.
//
// server/db.js opens its database at require() time and caches the handle, so
// pointing a test at a fresh file means setting PIP_DB_PATH *and* clearing the
// module from require.cache before loading anything that touches it. That's
// what freshDb() does; withDb() wraps it in cleanup.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Anything that transitively holds the cached db handle. Clearing these
// between tests is what makes each one independent.
//
// schema.js is deliberately NOT cleared. It holds no handle — it's pure data —
// and keeping it cached is what lets a test mutate MIGRATIONS to simulate a
// broken migration. Clearing it would hand db.js a pristine copy and the
// simulation would silently do nothing.
const SERVER_MODULES = /server\/(db|repo|clu3|weather)\//;

function clearServerModules() {
  for (const key of Object.keys(require.cache)) {
    if (SERVER_MODULES.test(key) || key.endsWith('server/db.js')) {
      delete require.cache[key];
    }
  }
}

// A brand-new database at the current schema, plus the repos bound to it.
// `load` resolves paths relative to the repo root, so tests read naturally:
//   const { load } = freshDb();
//   const inbox = load('server/repo/inboxRepo.js');
export function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'pip-test-'));
  const dbPath = join(dir, 'test.sqlite');
  process.env.PIP_DB_PATH = dbPath;
  // Keep the drops watcher pointed somewhere harmless — a test must never
  // pick up files from the real data/drops/ directory.
  process.env.PIP_DROPS_PATH = join(dir, 'drops');
  clearServerModules();

  const load = (rel) => require(join(process.cwd(), rel));
  return {
    dir,
    dbPath,
    load,
    db: load('server/db.js').db,
    cleanup() {
      try {
        load('server/db.js').db.close();
      } catch (_) {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
      clearServerModules();
      delete process.env.PIP_DB_PATH;
      delete process.env.PIP_DROPS_PATH;
    }
  };
}

// Run `fn` against a fresh database, always cleaning up.
export async function withDb(fn) {
  const ctx = freshDb();
  try {
    return await fn(ctx);
  } finally {
    ctx.cleanup();
  }
}

// A database built at an OLDER schema version, for migration tests: create the
// tables as they were, stamp the version, then let db.js migrate it forward.
// Takes raw SQL rather than a version number because the historical shape is
// the thing under test — reconstructing it from today's schema would defeat
// the purpose.
export function dbAtVersion(sql, version) {
  const dir = mkdtempSync(join(tmpdir(), 'pip-migrate-'));
  const dbPath = join(dir, 'old.sqlite');
  const Database = require('better-sqlite3');
  const raw = new Database(dbPath);
  raw.exec(sql);
  raw.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
  raw
    .prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)`)
    .run(String(version));
  raw.close();

  return {
    dir,
    dbPath,
    // Boot the real db.js against it, running migrations for real.
    migrate() {
      process.env.PIP_DB_PATH = dbPath;
      process.env.PIP_DROPS_PATH = join(dir, 'drops');
      clearServerModules();
      return require(join(process.cwd(), 'server/db.js'));
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      clearServerModules();
      delete process.env.PIP_DB_PATH;
      delete process.env.PIP_DROPS_PATH;
    }
  };
}

// Column names for a table, for shape comparisons.
export function columnsOf(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name)
    .sort();
}

export function tablesOf(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name)
    .sort();
}
