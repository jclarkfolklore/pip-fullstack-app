// Images and links belonging to an inbox item, task, note or journal entry.
//
// THE CLEANUP CONTRACT. The attachments -> parent reference is polymorphic
// (entity_type + entity_id), which SQLite can't express as a foreign key. So
// there is no ON DELETE CASCADE and no database-level guarantee: every entity
// delete path MUST call deleteForEntity(). If you add a new way to delete an
// inbox item, task, note or journal entry and forget, you get stale rows and
// stale files on disk — the exact thing this design is trying to avoid.
//
// Two things make that safe in practice:
//   - files are stored under data/attachments/<entity_type>/<entity_id>/, so
//     cleaning up an entity is one directory removal, not a per-file walk
//   - sweepOrphans() finds anything that slipped through, in the DB and on
//     disk, and is safe to run any time
//
// Images can be stored locally (downloaded or uploaded) or left as a bare
// URL. Anything behind auth — ADO and monday attachments both are — can't be
// fetched server-side without credentials we don't hold, so those land as
// links and say so rather than rendering as a broken image.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('../db');
const { logEvent } = require('./activityRepo');

const ENTITY_TYPES = ['inbox', 'task', 'note', 'journal', 'project'];
const KINDS = ['image', 'link', 'file'];

// Well-known link relationships, mostly so synced tickets can carry their
// design/testing links as first-class things rather than buried in prose.
const RELS = ['design', 'testing', 'spec', 'source', 'reference'];

const ATTACHMENTS_DIR = path.resolve(path.dirname(DB_PATH), 'attachments');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Documents run bigger than screenshots (a Confluence export or a slide deck
// easily clears 8MB) but this is still a personal tool on a local disk, not
// a file host — 25MB catches the real cases without becoming one.
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip'
};

// kind:'image' still gets the strict "must actually be an image" check on
// fetchImage's content-type; kind:'file' has no single expected prefix, so a
// mime is required up front instead of sniffed from the response.
function extensionFor(mime) {
  return MIME_EXT[mime] || '';
}

function nowIso() {
  return new Date().toISOString();
}

function assertEntity(entityType) {
  if (!ENTITY_TYPES.includes(entityType)) {
    throw new Error(`entityType must be one of ${ENTITY_TYPES.join(', ')}`);
  }
}

function entityDir(entityType, entityId) {
  // entityId is app-generated (uuid or a source-prefixed slug), but this path
  // is built from caller input, so refuse anything that could escape the
  // attachments directory.
  const safeId = String(entityId).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(ATTACHMENTS_DIR, entityType, safeId);
}

function absPathFor(row) {
  return row.file_path ? path.join(ATTACHMENTS_DIR, row.file_path) : null;
}

function shape(row) {
  return {
    ...row,
    // What the UI should actually load. Stored files go through our own
    // route; link-only images keep their remote URL.
    src: row.file_path ? `/api/attachments/${row.id}/raw` : row.url
  };
}

function totalCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM attachments').get().n;
}

function listFor(entityType, entityId) {
  assertEntity(entityType);
  return db
    .prepare(
      `SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ?
       ORDER BY kind DESC, sort_order ASC, created_at ASC`
    )
    .all(entityType, entityId)
    .map(shape);
}

// Attachments for many entities at once, keyed by id — so a card list can
// show thumbnails without one query per card.
function listForMany(entityType, entityIds = []) {
  assertEntity(entityType);
  if (!entityIds.length) return {};
  const holes = entityIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM attachments WHERE entity_type = ? AND entity_id IN (${holes})
       ORDER BY kind DESC, sort_order ASC, created_at ASC`
    )
    .all(entityType, ...entityIds);
  const out = {};
  for (const row of rows) {
    if (!out[row.entity_id]) out[row.entity_id] = [];
    out[row.entity_id].push(shape(row));
  }
  return out;
}

function getAttachment(id) {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  return row ? shape(row) : null;
}

function rawFileFor(id) {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!row || !row.file_path) return null;
  const abs = absPathFor(row);
  if (!fs.existsSync(abs)) return null;
  const mime = row.mime || 'application/octet-stream';
  const base = (row.title || 'attachment').replace(/[^A-Za-z0-9._-]+/g, '_');
  return { path: abs, mime, filename: `${base}${extensionFor(mime)}` };
}

function insert({ entityType, entityId, kind, rel, title, url, filePath, mime, bytes, source, sortOrder }) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO attachments
       (id, entity_type, entity_id, kind, rel, title, url, file_path, mime, bytes, sort_order, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    entityType,
    entityId,
    kind,
    rel || null,
    title || null,
    url || null,
    filePath || null,
    mime || null,
    bytes || null,
    sortOrder || 0,
    source || 'manual',
    nowIso()
  );
  logEvent(entityType === 'inbox' ? 'inbox_item' : entityType, entityId, 'attachment_added', {
    kind,
    rel,
    title
  });
  return getAttachment(id);
}

async function fetchImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!mime.startsWith('image/')) throw new Error(`not an image (${mime || 'unknown type'})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error(`image too large (${buf.length} bytes)`);
    return { buf, mime };
  } finally {
    clearTimeout(timeout);
  }
}

function writeFile(entityType, entityId, buf, mime) {
  const dir = entityDir(entityType, entityId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}${extensionFor(mime)}`;
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, buf);
  return path.relative(ATTACHMENTS_DIR, abs);
}

// Add an attachment.
//
//   kind:'link'   -> url is kept as-is
//   kind:'image'  -> `data` (base64) is stored; otherwise `url` is fetched and
//                    stored, and if that fails we fall back to keeping the URL
//                    rather than losing the reference entirely
//   kind:'file'   -> `data` (base64) is stored, same as image, but always
//                    with an explicit `mime` — there's no sensible default to
//                    fall back to for an arbitrary document, and no url-fetch
//                    path: the documents this exists for (email attachments)
//                    sit behind auth we don't hold, so the caller downloads
//                    the bytes itself and hands them over as data.
async function addAttachment({
  entityType,
  entityId,
  kind = 'link',
  rel = null,
  title = null,
  url = null,
  data = null,
  mime = null,
  source = 'manual',
  sortOrder = 0
}) {
  assertEntity(entityType);
  if (!entityId) throw new Error('entityId is required');
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  if (kind === 'link' && !url) throw new Error('a link attachment needs a url');
  if (kind === 'image' && !url && !data) throw new Error('an image attachment needs a url or data');
  if (kind === 'file' && !data) throw new Error('a file attachment needs base64 data');
  if (kind === 'file' && !mime) throw new Error('a file attachment needs a mime type');

  if (kind === 'link') {
    return { attachment: insert({ entityType, entityId, kind, rel, title, url, source, sortOrder }) };
  }

  if (data) {
    const buf = Buffer.from(data, 'base64');
    const maxBytes = kind === 'file' ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
    if (buf.length > maxBytes) throw new Error(`${kind} too large (${buf.length} bytes)`);
    const fileMime = mime || 'image/png';
    const filePath = writeFile(entityType, entityId, buf, fileMime);
    return {
      attachment: insert({
        entityType,
        entityId,
        kind,
        rel,
        title,
        url,
        filePath,
        mime: fileMime,
        bytes: buf.length,
        source,
        sortOrder
      })
    };
  }

  try {
    const { buf, mime: fetched } = await fetchImage(url);
    const filePath = writeFile(entityType, entityId, buf, fetched);
    return {
      attachment: insert({
        entityType,
        entityId,
        kind,
        rel,
        title,
        url,
        filePath,
        mime: fetched,
        bytes: buf.length,
        source,
        sortOrder
      })
    };
  } catch (err) {
    // Most upstream images (ADO, monday) sit behind auth we don't hold.
    // Keeping the URL as a link beats dropping it or rendering a broken img.
    return {
      attachment: insert({ entityType, entityId, kind: 'link', rel, title, url, source, sortOrder }),
      degraded: `couldn't fetch image (${err.message}) — kept as a link`
    };
  }
}

function removeFileQuietly(abs) {
  if (!abs) return;
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (err) {
    console.warn('[pip] could not remove attachment file:', err.message);
  }
}

function deleteAttachment(id) {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!row) return false;
  removeFileQuietly(absPathFor(row));
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  logEvent(
    row.entity_type === 'inbox' ? 'inbox_item' : row.entity_type,
    row.entity_id,
    'attachment_removed',
    { kind: row.kind, title: row.title }
  );
  return true;
}

// Called by every entity delete path. Drops the rows and the whole storage
// directory in one go — see the cleanup contract at the top of this file.
function deleteForEntity(entityType, entityId) {
  const rows = db
    .prepare('SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ?')
    .all(entityType, entityId);
  if (!rows.length) return 0;
  db.prepare('DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
  try {
    fs.rmSync(entityDir(entityType, entityId), { recursive: true, force: true });
  } catch (err) {
    console.warn('[pip] could not remove attachment dir:', err.message);
  }
  return rows.length;
}

const PARENT_TABLE = {
  project: 'projects',
  inbox: 'inbox_items',
  task: 'tasks',
  note: 'notes',
  journal: 'journal_entries'
};

// Belt and braces for the missing foreign key: rows whose parent is gone, and
// files on disk with no row. Safe to run any time; returns what it removed.
function sweepOrphans() {
  const removedRows = [];
  for (const [entityType, table] of Object.entries(PARENT_TABLE)) {
    const orphans = db
      .prepare(
        `SELECT a.* FROM attachments a
         LEFT JOIN ${table} p ON p.id = a.entity_id
         WHERE a.entity_type = ? AND p.id IS NULL`
      )
      .all(entityType);
    for (const row of orphans) {
      removeFileQuietly(absPathFor(row));
      db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
      removedRows.push(`${entityType}:${row.entity_id}`);
    }
  }

  const known = new Set(
    db
      .prepare('SELECT file_path FROM attachments WHERE file_path IS NOT NULL')
      .all()
      .map((r) => r.file_path)
  );
  const removedFiles = [];
  if (fs.existsSync(ATTACHMENTS_DIR)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
          // Prune directories the sweep just emptied.
          if (!fs.readdirSync(abs).length) fs.rmdirSync(abs);
        } else if (!known.has(path.relative(ATTACHMENTS_DIR, abs))) {
          removeFileQuietly(abs);
          removedFiles.push(path.relative(ATTACHMENTS_DIR, abs));
        }
      }
    };
    walk(ATTACHMENTS_DIR);
  }

  return { removedRows, removedFiles };
}

module.exports = {
  ENTITY_TYPES,
  KINDS,
  RELS,
  ATTACHMENTS_DIR,
  totalCount,
  listFor,
  listForMany,
  getAttachment,
  rawFileFor,
  addAttachment,
  deleteAttachment,
  deleteForEntity,
  sweepOrphans
};
