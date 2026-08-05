const crypto = require('crypto');
const { db } = require('../db');
const signals = require('../clu3/signals');
const { expression, DEFAULT_TONE, TONE_RANK } = require('../clu3/engine');

// Composition root for Clu3: reads the world (signals), reads config (tone),
// reads anything Claude has authored, and hands it all to the pure engine.
//
// Note: nothing here writes to activity_log. Clu3 is chrome, not work
// history — logging its chatter would drown recentActivity().

const MOODS = ['content', 'happy', 'proud', 'curious', 'busy', 'concerned', 'alarmed', 'sleepy'];
const TONE_KEY = 'clu3_tone';

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function getTone() {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(TONE_KEY);
  const value = row && row.value;
  return TONE_RANK[value] !== undefined ? value : DEFAULT_TONE;
}

function setTone(tone) {
  if (TONE_RANK[tone] === undefined) throw new Error(`Unknown tone "${tone}"`);
  db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(TONE_KEY, tone);
  return tone;
}

// Newest message that hasn't been dismissed and hasn't expired.
function pendingMessage() {
  return (
    db
      .prepare(
        `SELECT * FROM clu3_messages
         WHERE dismissed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(nowIso()) || null
  );
}

function listMessages({ includeSpent = false } = {}) {
  if (includeSpent) {
    return db.prepare('SELECT * FROM clu3_messages ORDER BY created_at DESC').all();
  }
  return db
    .prepare(
      `SELECT * FROM clu3_messages
       WHERE dismissed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC`
    )
    .all(nowIso());
}

function getMessage(id) {
  return db.prepare('SELECT * FROM clu3_messages WHERE id = ?').get(id) || null;
}

// This is how a Claude session leaves Clu3 something to say. ttlMinutes is
// the useful knob — a note about work we just did shouldn't still be on
// screen tomorrow.
function createMessage({ body, mood = 'content', actionKind = null, actionLabel = null, ttlMinutes = null } = {}) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Message body is required');
  if (!MOODS.includes(mood)) throw new Error(`Unknown mood "${mood}" (known: ${MOODS.join(', ')})`);

  const id = newId();
  const expiresAt =
    ttlMinutes === null || ttlMinutes === undefined
      ? null
      : new Date(Date.now() + Number(ttlMinutes) * 60000).toISOString();

  db.prepare(
    `INSERT INTO clu3_messages (id, body, mood, action_kind, action_label, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, text, mood, actionKind, actionLabel, nowIso(), expiresAt);
  return id;
}

function dismissMessage(id) {
  db.prepare('UPDATE clu3_messages SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL').run(nowIso(), id);
  return getMessage(id);
}

function deleteMessage(id) {
  db.prepare('DELETE FROM clu3_messages WHERE id = ?').run(id);
}

// The one endpoint the panel actually polls.
function currentState() {
  const facts = signals.collect();
  const tone = getTone();
  const state = expression(facts, { tone, pendingMessage: pendingMessage() });
  // Unlike weather, there's no upstream fetch to timestamp — this is always
  // computed fresh from the live local DB. computedAt exists so the panel can
  // show a "last updated" readout with the same shape as weather's fetchedAt.
  return { ...state, tone, moods: MOODS, computedAt: new Date().toISOString() };
}

module.exports = {
  MOODS,
  currentState,
  getTone,
  setTone,
  listMessages,
  getMessage,
  createMessage,
  dismissMessage,
  deleteMessage,
  pendingMessage
};
