// The data model lives here, independent of the API layer or the UI.
// This is the "full-stack" successor to the old client-side sql.js schema —
// same lifecycle/tagging/activity-log ideas, now backed by a real SQLite
// file on disk (server/db.js opens it with better-sqlite3), plus a first-
// class Project entity and a standalone Notes table.

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'default',
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'me',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','active','resolved','archived')),
  outcome_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  stage_changed_at TEXT NOT NULL,
  resolved_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  import_hash TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','doing','done')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  due_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  from_inbox_item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'me',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_hash TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Polymorphic tag links: entity_type is 'inbox' | 'task' | 'note'.
CREATE TABLE IF NOT EXISTS entity_tags (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_type, entity_id, tag_id)
);

CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  glyph TEXT NOT NULL DEFAULT 'link',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_stage ON inbox_items(stage);
CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_items(created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_project ON inbox_items(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at);
CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_occurred ON activity_log(occurred_at);
`;

const SEED_WIDGETS = [
  { id: 'inbox', kind: 'inbox', title: 'INBOX', glyph: 'inbox', sort_order: 0 },
  { id: 'tasks', kind: 'tasks', title: 'TASKS', glyph: 'tasks', sort_order: 1 },
  { id: 'notes', kind: 'notes', title: 'NOTES', glyph: 'note', sort_order: 2 },
  { id: 'projects', kind: 'projects', title: 'PROJECTS', glyph: 'folder', sort_order: 3 },
  { id: 'metrics', kind: 'metrics', title: 'METRICS', glyph: 'metrics', sort_order: 4 },
  { id: 'overview', kind: 'overview', title: 'STATUS', glyph: 'link', sort_order: 5 }
];

const SEED_PROJECTS = [
  { id: 'unassigned', name: 'Unassigned', color: 'default', sort_order: 0 }
];

// Future schema changes go here as { version, statements: [...] } — same
// pattern as the old client-side schema, just running against a real file
// via better-sqlite3 instead of sql.js.
const MIGRATIONS = [];

module.exports = { SCHEMA_VERSION, SCHEMA_SQL, SEED_WIDGETS, SEED_PROJECTS, MIGRATIONS };
