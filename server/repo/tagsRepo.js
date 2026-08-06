const crypto = require('crypto');
const { db } = require('../db');

function newId() {
  return crypto.randomUUID();
}

function ensureTag(name) {
  const clean = String(name).trim().toLowerCase();
  if (!clean) return null;
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(clean);
  if (existing) return existing.id;
  const id = newId();
  db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, clean);
  return id;
}

// entityType is 'inbox' | 'task' | 'note' — one polymorphic join table
// backs tags for all three, so search/metrics can treat them uniformly.
function tagsFor(entityType, entityId) {
  return db
    .prepare(
      `SELECT t.name FROM tags t
       JOIN entity_tags et ON et.tag_id = t.id
       WHERE et.entity_type = ? AND et.entity_id = ?
       ORDER BY t.name`
    )
    .all(entityType, entityId)
    .map((r) => r.name);
}

function attachTags(entityType, entityId, tagNames = []) {
  db.prepare('DELETE FROM entity_tags WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag_id) VALUES (?,?,?)'
  );
  for (const name of tagNames) {
    const tagId = ensureTag(name);
    if (!tagId) continue;
    insert.run(entityType, entityId, tagId);
  }
}

function allTagNames() {
  return db
    .prepare('SELECT name FROM tags ORDER BY name')
    .all()
    .map((r) => r.name);
}

module.exports = { ensureTag, tagsFor, attachTags, allTagNames };
