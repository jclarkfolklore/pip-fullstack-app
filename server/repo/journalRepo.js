const crypto = require('crypto');
const { db } = require('../db');
const { logEvent } = require('./activityRepo');
const attachmentsRepo = require('./attachmentsRepo');

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function listEntries({ search = '' } = {}) {
  const where = [];
  const params = [];
  if (search) {
    where.push('body_md LIKE ?');
    params.push(`%${search}%`);
  }
  return db
    .prepare(`SELECT * FROM journal_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`)
    .all(...params);
}

function getEntry(id) {
  return db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id);
}

function createEntry({ bodyMd = '' } = {}) {
  if (!bodyMd.trim()) throw new Error('Entry body is required');
  const id = newId();
  const now = nowIso();
  db.prepare('INSERT INTO journal_entries (id, body_md, created_at, updated_at) VALUES (?,?,?,?)').run(id, bodyMd, now, now);
  logEvent('journal_entry', id, 'journal_created', {});
  return id;
}

function updateEntry(id, { bodyMd } = {}) {
  const existing = getEntry(id);
  if (!existing) return null;
  db.prepare('UPDATE journal_entries SET body_md = ?, updated_at = ? WHERE id = ?').run(
    bodyMd !== undefined ? bodyMd : existing.body_md,
    nowIso(),
    id
  );
  logEvent('journal_entry', id, 'journal_updated', {});
  return getEntry(id);
}

function deleteEntry(id) {
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
  // Attachments have no FK to cascade from — see attachmentsRepo.
  attachmentsRepo.deleteForEntity('journal', id);
  logEvent('journal_entry', id, 'journal_deleted', {});
}

function entryCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get().n;
}

module.exports = { listEntries, getEntry, createEntry, updateEntry, deleteEntry, entryCount };
