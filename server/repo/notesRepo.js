const crypto = require('crypto');
const { db } = require('../db');
const { logEvent } = require('./activityRepo');
const { tagsFor, attachTags } = require('./tagsRepo');
const attachmentsRepo = require('./attachmentsRepo');

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

// Notes are plain reference material — no lifecycle (no new/active/
// resolved/archived) — for stuff you want to jot down or keep on hand,
// distinct from the Inbox's review-and-resolve flow. They still carry
// source/source_type/source_url and tags, and can belong to a project,
// same as inbox items and tasks.
const SOURCE_TYPES = ['manual', 'chat', 'monday', 'ado', 'email', 'screenshot'];

function hydrate(row) {
  return row ? { ...row, tags: tagsFor('note', row.id) } : null;
}

function findByImportHash(hash) {
  if (!hash) return null;
  return db.prepare('SELECT id FROM notes WHERE import_hash = ?').get(hash);
}

function importDroppedNote({
  id,
  title = '',
  bodyMd = '',
  tags = [],
  createdAt,
  source = 'claude',
  sourceType = 'chat',
  sourceUrl = null,
  projectId = null,
  pinned = false
}) {
  const already = db.prepare('SELECT id FROM notes WHERE id = ?').get(id);
  if (already) return { id, created: false };
  const created = createdAt || nowIso();
  db.prepare(
    `INSERT INTO notes (id, title, body_md, source, source_type, source_url, project_id, pinned, created_at, updated_at, import_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, title, bodyMd, source, sourceType, sourceUrl, projectId, pinned ? 1 : 0, created, created, id);
  attachTags('note', id, tags);
  logEvent('note', id, 'note_created', { title, source, sourceType });
  return { id, created: true };
}

function createNote({
  title = '',
  bodyMd = '',
  source = 'me',
  sourceType = 'manual',
  sourceUrl = null,
  projectId = null,
  tags = [],
  pinned = false,
  createdAt
} = {}) {
  const id = newId();
  const created = createdAt || nowIso();
  db.prepare(
    `INSERT INTO notes (id, title, body_md, source, source_type, source_url, project_id, pinned, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, title, bodyMd, source, sourceType, sourceUrl, projectId, pinned ? 1 : 0, created, created);
  attachTags('note', id, tags);
  logEvent('note', id, 'note_created', { title, source, sourceType });
  return id;
}

function listNotes({ project = null, tag = null, search = '', pinned = null, sort = 'updated_desc' } = {}) {
  const where = [];
  const params = [];
  if (project) {
    where.push('project_id = ?');
    params.push(project);
  }
  if (pinned !== null) {
    where.push('pinned = ?');
    params.push(pinned ? 1 : 0);
  }
  if (search) {
    where.push('(title LIKE ? OR body_md LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tag) {
    where.push(
      `id IN (SELECT et.entity_id FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type='note' AND t.name = ?)`
    );
    params.push(tag.toLowerCase());
  }
  const orderBy =
    {
      updated_desc: 'pinned DESC, updated_at DESC',
      created_desc: 'pinned DESC, created_at DESC',
      title_asc: 'title COLLATE NOCASE ASC'
    }[sort] || 'pinned DESC, updated_at DESC';

  return db
    .prepare(`SELECT * FROM notes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`)
    .all(...params)
    .map(hydrate);
}

function getNote(id) {
  return hydrate(db.prepare('SELECT * FROM notes WHERE id = ?').get(id));
}

function updateFields(id, fields = {}) {
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!existing) return null;
  const next = {
    title: fields.title !== undefined ? fields.title : existing.title,
    body_md: fields.bodyMd !== undefined ? fields.bodyMd : existing.body_md,
    source_type: fields.sourceType !== undefined ? fields.sourceType : existing.source_type,
    source_url: fields.sourceUrl !== undefined ? fields.sourceUrl : existing.source_url,
    project_id: fields.projectId !== undefined ? fields.projectId : existing.project_id,
    pinned: fields.pinned !== undefined ? (fields.pinned ? 1 : 0) : existing.pinned
  };
  db.prepare(
    'UPDATE notes SET title=?, body_md=?, source_type=?, source_url=?, project_id=?, pinned=?, updated_at=? WHERE id=?'
  ).run(
    next.title,
    next.body_md,
    next.source_type,
    next.source_url,
    next.project_id,
    next.pinned,
    nowIso(),
    id
  );
  if (fields.tags !== undefined) attachTags('note', id, fields.tags);
  logEvent('note', id, 'note_updated', { fields: Object.keys(fields) });
  return getNote(id);
}

function deleteNote(id) {
  // Read before deleting: a log entry saying only "something was
  // deleted" is barely better than no entry at all.
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  db.prepare("DELETE FROM entity_tags WHERE entity_type='note' AND entity_id = ?").run(id);
  // Attachments have no FK to cascade from — see attachmentsRepo.
  attachmentsRepo.deleteForEntity('note', id);
  logEvent('note', id, 'note_deleted', { title: existing ? existing.title : null });
}

function noteCounts() {
  return {
    total: db.prepare('SELECT COUNT(*) AS n FROM notes').get().n,
    pinned: db.prepare('SELECT COUNT(*) AS n FROM notes WHERE pinned=1').get().n
  };
}

module.exports = {
  SOURCE_TYPES,
  findByImportHash,
  importDroppedNote,
  createNote,
  listNotes,
  getNote,
  updateFields,
  deleteNote,
  noteCounts
};
