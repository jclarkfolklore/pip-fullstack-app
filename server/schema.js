// The data model lives here, independent of the API layer or the UI.
// This is the "full-stack" successor to the old client-side sql.js schema —
// same lifecycle/tagging/activity-log ideas, now backed by a real SQLite
// file on disk (server/db.js opens it with better-sqlite3), plus a first-
// class Project entity and a standalone Notes table.

const SCHEMA_VERSION = 10;

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
  source_ref TEXT,
  details_md TEXT,
  source_meta_json TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  -- Arrivals start 'active', not 'new': anything that reached the inbox is
  -- already live work. 'new' stays valid for historical rows.
  stage TEXT NOT NULL DEFAULT 'active' CHECK (stage IN ('new','active','resolved','archived')),
  outcome_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  stage_changed_at TEXT NOT NULL,
  import_hash TEXT,
  deactivated_at TEXT
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
  from_inbox_item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  source_ref TEXT,
  -- Upstream ticket prose (description, acceptance criteria). Kept separate
  -- from notes_md so a re-sync overwrites the ticket, never your own notes.
  details_md TEXT,
  source_meta_json TEXT
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

-- A personal work journal — free-form, dated entries, no title, no
-- lifecycle, not tied to a project. For the "record experiences,
-- interactions, keep a work journal" use case, distinct from Notes
-- (reference material) and Inbox (things to triage).
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  body_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Clu3's authored messages. The rules engine (server/clu3/) covers the
-- always-on baseline; this table is what lets Claude leave Clu3 something
-- specific to say about work we actually did together. Deliberately NOT
-- written to activity_log — Clu3 is chrome, not work history.
CREATE TABLE IF NOT EXISTS clu3_messages (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  mood TEXT NOT NULL DEFAULT 'content',
  action_kind TEXT,
  action_label TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  dismissed_at TEXT
);

-- Images and links belonging to an inbox item, task, note or journal entry.
-- The reference is polymorphic, so SQLite can't enforce it or cascade the
-- delete: keeping this clean is the repo layer's job (attachmentsRepo
-- .deleteForEntity on every delete path, sweepOrphans for the rest).
-- Stored files live under data/attachments/<entity_type>/<entity_id>/.
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('inbox','task','note','journal')),
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','link')),
  rel TEXT,
  title TEXT,
  url TEXT,
  file_path TEXT,
  mime TEXT,
  bytes INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
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
  config_json TEXT NOT NULL DEFAULT '{}',
  group_name TEXT NOT NULL DEFAULT 'work'
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
CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_clu3_created ON clu3_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_occurred ON activity_log(occurred_at);
`;

// group_name buckets tiles on the dashboard grid — see GROUPS in
// widgetRegistry.js for the display order/labels. Purely a layout
// grouping, independent of sort_order (which still orders tiles within
// a group).
const SEED_WIDGETS = [
  { id: 'inbox', kind: 'inbox', title: 'INBOX', glyph: 'inbox', sort_order: 0, group_name: 'work' },
  { id: 'tasks', kind: 'tasks', title: 'TASKS', glyph: 'tasks', sort_order: 1, group_name: 'work' },
  { id: 'notes', kind: 'notes', title: 'NOTES', glyph: 'note', sort_order: 2, group_name: 'work' },
  { id: 'journal', kind: 'journal', title: 'JOURNAL', glyph: 'book', sort_order: 3, group_name: 'work' },
  { id: 'projects', kind: 'projects', title: 'PROJECTS', glyph: 'folder', sort_order: 4, group_name: 'work' },
  { id: 'metrics', kind: 'metrics', title: 'METRICS', glyph: 'metrics', sort_order: 5, group_name: 'insights' },
  { id: 'overview', kind: 'overview', title: 'STATUS', glyph: 'link', sort_order: 6, group_name: 'insights' },
  { id: 'settings', kind: 'settings', title: 'SETTINGS', glyph: 'theme', sort_order: 7, group_name: 'system' }
];

// No default/seed project — Projects starts genuinely empty until the
// user creates one (previously seeded an "Unassigned" placeholder that
// nothing ever actually referenced; see MIGRATIONS v4).
const SEED_PROJECTS = [];

// Future schema changes go here as { version, statements: [...] } — same
// pattern as the old client-side schema, just running against a real file
// via better-sqlite3 instead of sql.js.
const MIGRATIONS = [
  {
    version: 2,
    statements: [
      `INSERT OR IGNORE INTO widgets (id, kind, title, glyph, sort_order)
       VALUES ('settings', 'settings', 'SETTINGS', 'theme', 6)`
    ]
  },
  {
    version: 3,
    statements: [
      `ALTER TABLE widgets ADD COLUMN group_name TEXT NOT NULL DEFAULT 'work'`,
      `UPDATE widgets SET group_name = 'insights' WHERE id IN ('metrics', 'overview')`,
      `UPDATE widgets SET group_name = 'system' WHERE id = 'settings'`
    ]
  },
  {
    version: 4,
    statements: [
      // The seeded "Unassigned" project was never referenced by any
      // inbox item, task, or note (they use a NULL project_id for "no
      // project" instead) — it was just a permanently-empty placeholder.
      `DELETE FROM projects WHERE id = 'unassigned'`
    ]
  },
  {
    version: 5,
    statements: [
      // resolved_task_id was write-only (never read/displayed anywhere)
      // and only modeled a single resulting task. tasks.from_inbox_item_id
      // already models the real, one-to-many relationship — an inbox item
      // can now resolve into any number of tasks — so this column is
      // redundant. Requires SQLite 3.35+ (bundled better-sqlite3 has it).
      `ALTER TABLE inbox_items DROP COLUMN resolved_task_id`
    ]
  },
  {
    version: 6,
    statements: [
      `CREATE TABLE IF NOT EXISTS journal_entries (
         id TEXT PRIMARY KEY,
         body_md TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at)`,
      `UPDATE widgets SET sort_order = 4 WHERE id = 'projects'`,
      `UPDATE widgets SET sort_order = 5 WHERE id = 'metrics'`,
      `UPDATE widgets SET sort_order = 6 WHERE id = 'overview'`,
      `UPDATE widgets SET sort_order = 7 WHERE id = 'settings'`,
      `INSERT OR IGNORE INTO widgets (id, kind, title, glyph, sort_order, group_name)
       VALUES ('journal', 'journal', 'JOURNAL', 'book', 3, 'work')`
    ]
  },
  {
    version: 7,
    statements: [
      `CREATE TABLE IF NOT EXISTS clu3_messages (
         id TEXT PRIMARY KEY,
         body TEXT NOT NULL,
         mood TEXT NOT NULL DEFAULT 'content',
         action_kind TEXT,
         action_label TEXT,
         created_at TEXT NOT NULL,
         expires_at TEXT,
         dismissed_at TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS idx_clu3_created ON clu3_messages(created_at)`
    ]
  },
  {
    // Tickets synced from monday/ADO must always carry their ticket number and
    // a link back — without them a synced task is a dead end you can't act on.
    // tasks had no source columns at all; source_ref is the human-facing
    // ticket number (e.g. "183767"), separate from the prefixed PIP id.
    version: 8,
    statements: [
      `ALTER TABLE tasks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'`,
      `ALTER TABLE tasks ADD COLUMN source_url TEXT`,
      `ALTER TABLE tasks ADD COLUMN source_ref TEXT`,
      `ALTER TABLE tasks ADD COLUMN details_md TEXT`,
      `ALTER TABLE tasks ADD COLUMN source_meta_json TEXT`,
      `ALTER TABLE inbox_items ADD COLUMN source_ref TEXT`,
      `ALTER TABLE inbox_items ADD COLUMN details_md TEXT`,
      `ALTER TABLE inbox_items ADD COLUMN source_meta_json TEXT`
    ]
  },
  {
    // "Deactivated" is a hold state orthogonal to the new/active/resolved/
    // archived lifecycle — for something not ready to resolve that you also
    // don't want counted as active. Modeled as a nullable timestamp rather
    // than folded into `stage` so it doesn't require rebuilding that
    // column's CHECK constraint (SQLite can't ALTER one in place).
    version: 9,
    statements: [`ALTER TABLE inbox_items ADD COLUMN deactivated_at TEXT`]
  },
  {
    // Images and links, attached to any of the four entity types.
    //
    // The reference is polymorphic (entity_type + entity_id), so SQLite can't
    // enforce it with a foreign key and cascade the delete for us. That makes
    // orphan cleanup an explicit responsibility of the repo layer rather than
    // something the database guarantees — see attachmentsRepo.deleteForEntity,
    // which every entity delete path must call, and sweepOrphans() for
    // anything that slips through.
    //
    // Stored files live under data/attachments/<entity_type>/<entity_id>/, so
    // deleting an entity is a single directory removal and can't leave
    // stragglers behind.
    version: 10,
    statements: [
      `CREATE TABLE IF NOT EXISTS attachments (
         id TEXT PRIMARY KEY,
         entity_type TEXT NOT NULL CHECK (entity_type IN ('inbox','task','note','journal')),
         entity_id TEXT NOT NULL,
         kind TEXT NOT NULL CHECK (kind IN ('image','link')),
         rel TEXT,
         title TEXT,
         url TEXT,
         file_path TEXT,
         mime TEXT,
         bytes INTEGER,
         sort_order INTEGER NOT NULL DEFAULT 0,
         source TEXT NOT NULL DEFAULT 'manual',
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id)`
    ]
  }
];

module.exports = { SCHEMA_VERSION, SCHEMA_SQL, SEED_WIDGETS, SEED_PROJECTS, MIGRATIONS };
