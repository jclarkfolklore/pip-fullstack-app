const crypto = require('crypto');
const { db } = require('../db');
const { logEvent } = require('./activityRepo');
const { tagsFor, attachTags } = require('./tagsRepo');
const { listTasksFromInboxItem } = require('./tasksRepo');
const attachmentsRepo = require('./attachmentsRepo');

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

// Recognized origins — drives which pixel icon shows on a card and lets
// Metrics break work down by where it actually came from.
const SOURCE_TYPES = ['manual', 'chat', 'monday', 'ado', 'email', 'screenshot'];

function hydrate(row) {
  return row ? { ...row, tags: tagsFor('inbox', row.id), resolvedTasks: listTasksFromInboxItem(row.id) } : null;
}

function findByImportHash(hash) {
  if (!hash) return null;
  return db.prepare('SELECT id FROM inbox_items WHERE import_hash = ?').get(hash);
}

// Used by the drops-folder auto-import (Claude writing .md notes into
// data/drops/ from Monday, ADO, a screenshot, an email, or just chat).
// Idempotent on the note's own id — re-importing never duplicates.
function importDroppedNote({
  id,
  title = '',
  bodyMd = '',
  tags = [],
  createdAt,
  source = 'claude',
  sourceType = 'chat',
  sourceUrl = null,
  sourceRef = null,
  detailsMd = null,
  sourceMeta = null,
  projectId = null
}) {
  const already = db.prepare('SELECT id FROM inbox_items WHERE id = ?').get(id);
  if (already) return { id, created: false };
  const created = createdAt || nowIso();
  db.prepare(
    `INSERT INTO inbox_items
      (id, title, body_md, source, source_type, source_url, source_ref, details_md, source_meta_json, project_id, stage, outcome_md, created_at, stage_changed_at, import_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '', ?, ?, ?)`
  ).run(
    id,
    title,
    bodyMd,
    source,
    sourceType,
    sourceUrl,
    sourceRef,
    detailsMd,
    sourceMeta ? JSON.stringify(sourceMeta) : null,
    projectId,
    created,
    created,
    id
  );
  attachTags('inbox', id, tags);
  logEvent('inbox_item', id, 'inbox_created', { title, source, sourceType });
  return { id, created: true };
}

function createInboxItem({
  title = '',
  bodyMd = '',
  source = 'me',
  sourceType = 'manual',
  sourceUrl = null,
  projectId = null,
  tags = [],
  importHash = null,
  createdAt
} = {}) {
  const id = newId();
  const created = createdAt || nowIso();
  db.prepare(
    `INSERT INTO inbox_items
      (id, title, body_md, source, source_type, source_url, project_id, stage, outcome_md, created_at, stage_changed_at, import_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '', ?, ?, ?)`
  ).run(id, title, bodyMd, source, sourceType, sourceUrl, projectId, created, created, importHash);
  attachTags('inbox', id, tags);
  logEvent('inbox_item', id, 'inbox_created', { title, source, sourceType });
  return id;
}

function listInboxItems({ stage = null, tag = null, project = null, search = '', sort = 'created_desc' } = {}) {
  const where = [];
  const params = [];
  if (stage) {
    where.push('i.stage = ?');
    params.push(stage);
  }
  if (project) {
    where.push('i.project_id = ?');
    params.push(project);
  }
  if (search) {
    where.push('(i.title LIKE ? OR i.body_md LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag) {
    where.push(
      `i.id IN (SELECT et.entity_id FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type='inbox' AND t.name = ?)`
    );
    params.push(tag.toLowerCase());
  }
  const orderBy =
    {
      created_desc: 'i.created_at DESC',
      created_asc: 'i.created_at ASC',
      stage_changed_desc: 'i.stage_changed_at DESC',
      title_asc: 'i.title COLLATE NOCASE ASC'
    }[sort] || 'i.created_at DESC';

  const sql = `SELECT i.* FROM inbox_items i ${
    where.length ? 'WHERE ' + where.join(' AND ') : ''
  } ORDER BY ${orderBy}`;

  return db.prepare(sql).all(...params).map(hydrate);
}

function getInboxItem(id) {
  return hydrate(db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id));
}

function setStage(id, stage) {
  const row = db.prepare('SELECT stage FROM inbox_items WHERE id = ?').get(id);
  db.prepare('UPDATE inbox_items SET stage = ?, stage_changed_at = ? WHERE id = ?').run(stage, nowIso(), id);
  logEvent('inbox_item', id, 'inbox_stage_changed', { from: row && row.stage, to: stage });
}

function updateFields(id, fields = {}) {
  const existing = db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id);
  if (!existing) return null;
  const next = {
    title: fields.title !== undefined ? fields.title : existing.title,
    body_md: fields.bodyMd !== undefined ? fields.bodyMd : existing.body_md,
    source_type: fields.sourceType !== undefined ? fields.sourceType : existing.source_type,
    source_url: fields.sourceUrl !== undefined ? fields.sourceUrl : existing.source_url,
    project_id: fields.projectId !== undefined ? fields.projectId : existing.project_id
  };
  db.prepare(
    'UPDATE inbox_items SET title=?, body_md=?, source_type=?, source_url=?, project_id=? WHERE id=?'
  ).run(next.title, next.body_md, next.source_type, next.source_url, next.project_id, id);
  if (fields.tags !== undefined) attachTags('inbox', id, fields.tags);
  logEvent('inbox_item', id, 'inbox_updated', { fields: Object.keys(fields) });
  return getInboxItem(id);
}

function updateTags(id, tagNames) {
  attachTags('inbox', id, tagNames);
}

function resolveWithOutcome(id, outcomeMd) {
  db.prepare("UPDATE inbox_items SET stage = 'resolved', outcome_md = ?, stage_changed_at = ? WHERE id = ?").run(
    outcomeMd,
    nowIso(),
    id
  );
  logEvent('inbox_item', id, 'inbox_resolved', { outcomeMd });
}

function archiveItem(id) {
  setStage(id, 'archived');
  logEvent('inbox_item', id, 'inbox_archived', {});
}

// A hold, not a lifecycle stage — `stage` is untouched, so reactivating
// returns exactly to wherever it was (new/active), not to a fixed default.
function deactivateItem(id) {
  db.prepare('UPDATE inbox_items SET deactivated_at = ? WHERE id = ?').run(nowIso(), id);
  logEvent('inbox_item', id, 'inbox_deactivated', {});
  return getInboxItem(id);
}

function reactivateItem(id) {
  db.prepare('UPDATE inbox_items SET deactivated_at = NULL WHERE id = ?').run(id);
  logEvent('inbox_item', id, 'inbox_reactivated', {});
  return getInboxItem(id);
}

function deleteItem(id) {
  db.prepare('DELETE FROM inbox_items WHERE id = ?').run(id);
  db.prepare("DELETE FROM entity_tags WHERE entity_type='inbox' AND entity_id = ?").run(id);
  // Attachments have no FK to cascade from — see attachmentsRepo.
  attachmentsRepo.deleteForEntity('inbox', id);
}

// Deactivated items are excluded from their stage's count here — that's the
// whole point of deactivating: pull something out of "active"/"in motion"
// everywhere that number is shown (tile badge, Metrics, Overview), without
// touching its actual stage.
function stageCounts() {
  const rows = db
    .prepare("SELECT stage, COUNT(*) AS n FROM inbox_items WHERE deactivated_at IS NULL GROUP BY stage")
    .all();
  const out = { new: 0, active: 0, resolved: 0, archived: 0, deactivated: 0 };
  for (const r of rows) out[r.stage] = r.n;
  out.deactivated = db.prepare('SELECT COUNT(*) AS n FROM inbox_items WHERE deactivated_at IS NOT NULL').get().n;
  return out;
}

module.exports = {
  SOURCE_TYPES,
  findByImportHash,
  importDroppedNote,
  createInboxItem,
  listInboxItems,
  getInboxItem,
  setStage,
  updateFields,
  updateTags,
  resolveWithOutcome,
  archiveItem,
  deactivateItem,
  reactivateItem,
  deleteItem,
  stageCounts
};
