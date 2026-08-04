// The data model lives here, independent of any UI. Widgets talk to the
// repo/*.js modules, which talk to the client, which talks to this schema.
// SQLITE_USER_VERSION is bumped whenever this schema changes so future
// sessions can add real migrations instead of guessing.

export const SQLITE_USER_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'me',
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','active','resolved','archived')),
  outcome_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  stage_changed_at TEXT NOT NULL,
  resolved_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  import_hash TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS inbox_item_tags (
  inbox_item_id TEXT NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (inbox_item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','doing','done')),
  due_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  from_inbox_item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  glyph TEXT NOT NULL DEFAULT '▢',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_stage ON inbox_items(stage);
CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_items(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`;

export const SEED_WIDGETS = [
  { id: 'inbox', kind: 'inbox', title: 'INBOX', glyph: '📥', sort_order: 0 },
  { id: 'tasks', kind: 'tasks', title: 'TASKS', glyph: '✅', sort_order: 1 },
  { id: 'pacing', kind: 'pacing', title: 'PACING', glyph: '⏱', sort_order: 2 },
  { id: 'overview', kind: 'overview', title: 'STATUS', glyph: '📡', sort_order: 3 }
];
