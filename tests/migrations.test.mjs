// Migrations — risk #1.
//
// This is the class of bug that killed startup today: an index referencing a
// column a migration adds ran BEFORE that migration, so every existing
// database failed to boot while a fresh one was fine. Local dev never sees it,
// because local dev usually has a current database.
//
// The only way to catch that is to build a database at an OLD shape and
// migrate it forward for real. Testing against a fresh database — which is
// what "run the app and see" does — is precisely the case that passes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withDb, dbAtVersion, tablesOf, columnsOf } from './helpers/db.mjs';

const require = createRequire(import.meta.url);
const { MIGRATIONS, SCHEMA_VERSION } = require(process.cwd() + '/server/schema.js');

// The v1 shape, before any migration. Written out rather than derived: the
// historical shape is the thing under test, so generating it from today's
// schema would make the test tautological.
const V1_SQL = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT 'default',
  archived INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'me', source_type TEXT NOT NULL DEFAULT 'manual', source_url TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','active','resolved','archived')),
  outcome_md TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, stage_changed_at TEXT NOT NULL,
  import_hash TEXT
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, notes_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','doing','done')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, due_at TEXT,
  created_at TEXT NOT NULL, completed_at TEXT,
  from_inbox_item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL
);
CREATE TABLE notes (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'me', source_type TEXT NOT NULL DEFAULT 'manual', source_url TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, import_hash TEXT
);
CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE entity_tags (
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_type, entity_id, tag_id)
);
CREATE TABLE widgets (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, glyph TEXT NOT NULL DEFAULT 'link',
  sort_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL
);
`;

test('migration versions are contiguous and match SCHEMA_VERSION', () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), 'versions are ordered');
  for (let i = 1; i < versions.length; i++) {
    assert.equal(versions[i], versions[i - 1] + 1, `no gap before v${versions[i]}`);
  }
  assert.equal(
    versions[versions.length - 1],
    SCHEMA_VERSION,
    'last migration matches SCHEMA_VERSION — a bump without a migration silently skips it'
  );
});

test('a v1 database migrates to the current schema', () => {
  const ctx = dbAtVersion(V1_SQL, 1);
  try {
    const { db } = ctx.migrate();
    const v = db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get();
    assert.equal(v.value, String(SCHEMA_VERSION), 'version stamped forward');

    // Columns every later migration added — the ones an index could trip on.
    assert.ok(columnsOf(db, 'projects').includes('status'), 'v11 projects.status');
    assert.ok(columnsOf(db, 'journal_entries').includes('project_id'), 'v11 journal.project_id');
    assert.ok(columnsOf(db, 'tasks').includes('source_ref'), 'v8 tasks.source_ref');
    assert.ok(columnsOf(db, 'inbox_items').includes('deactivated_at'), 'inbox.deactivated_at');
  } finally {
    ctx.cleanup();
  }
});

test('a migrated database matches a freshly built one', async () => {
  // The regression that matters: SCHEMA_SQL and the migration path drifting
  // apart, so new installs and existing ones diverge.
  const migrated = dbAtVersion(V1_SQL, 1);
  let migratedTables, migratedCols;
  try {
    const { db } = migrated.migrate();
    migratedTables = tablesOf(db);
    migratedCols = Object.fromEntries(migratedTables.map((t) => [t, columnsOf(db, t)]));
  } finally {
    migrated.cleanup();
  }

  await withDb(({ db }) => {
    const freshTables = tablesOf(db);
    assert.deepEqual(
      migratedTables,
      freshTables,
      'same tables — a table added to SCHEMA_SQL but not MIGRATIONS (or vice versa) fails here'
    );
    for (const t of freshTables) {
      assert.deepEqual(columnsOf(db, t), migratedCols[t], `same columns in ${t}`);
    }
  });
});

test('migrating twice is a no-op', () => {
  const ctx = dbAtVersion(V1_SQL, 1);
  try {
    const first = ctx.migrate();
    const before = tablesOf(first.db).map((t) => `${t}:${columnsOf(first.db, t).join(',')}`);
    // Re-running must not duplicate columns, drop data, or throw.
    const second = ctx.migrate();
    const after = tablesOf(second.db).map((t) => `${t}:${columnsOf(second.db, t).join(',')}`);
    assert.deepEqual(after, before, 'shape unchanged on second run');
  } finally {
    ctx.cleanup();
  }
});

test('existing rows survive migration', () => {
  const ctx = dbAtVersion(
    V1_SQL +
      `INSERT INTO projects (id,name,created_at) VALUES ('p1','Kept','2026-01-01T00:00:00Z');
       INSERT INTO tasks (id,title,created_at) VALUES ('t1','Kept task','2026-01-01T00:00:00Z');`,
    1
  );
  try {
    const { db } = ctx.migrate();
    assert.equal(db.prepare("SELECT name FROM projects WHERE id='p1'").get().name, 'Kept');
    assert.equal(db.prepare("SELECT title FROM tasks WHERE id='t1'").get().title, 'Kept task');
    // Added columns take their default rather than nulling the row.
    assert.equal(db.prepare("SELECT status FROM projects WHERE id='p1'").get().status, 'open');
  } finally {
    ctx.cleanup();
  }
});

test('indexes are created after migrations, not before', () => {
  // Direct regression test for today's startup bug: idx_journal_project
  // references a column that migration v11 adds. If indexes ran with the
  // table definitions, booting a pre-v11 database would throw here.
  const ctx = dbAtVersion(V1_SQL, 1);
  try {
    const { db } = ctx.migrate();
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all()
      .map((r) => r.name);
    assert.ok(idx.includes('idx_journal_project'), 'index on a migration-added column exists');
    assert.ok(idx.includes('idx_project_contacts'), 'index on a migration-added table exists');
  } finally {
    ctx.cleanup();
  }
});
