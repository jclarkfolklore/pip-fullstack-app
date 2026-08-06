// Clu3's senses: turns the database into a flat bag of FACTS.
//
// Nothing in here decides how Clu3 feels or what it says — that's rules.js
// and engine.js. Keep this file purely about "what is true right now," so a
// rule can be written against it without touching SQL. Every value here is
// derived from real rows; Clu3 never invents a number.
//
// Tuning knobs live at the top on purpose — nudging STALE_DAYS is the most
// common adjustment and shouldn't require reading the queries.

const { db } = require('../db');

const STALE_DAYS = 3; // untouched inbox item / in-progress task = "aging"
const BUSY_INBOX = 5; // new items at which Clu3 reads the room as "busy"
const JOURNAL_GAP_DAYS = 4; // silence before Clu3 mentions the journal
const QUIET_HOUR = 21; // 24h clock; past this, "all clear" reads as sleepy
const ENERGY_WINDOW_DAYS = 7;

// Recency weights for energy — index is "days ago". Today's work counts for
// a lot, week-old work barely registers. This is what gives Clu3 momentum
// (it decays if you step away, recovers when you engage) while staying a
// pure function of logged events rather than a fabricated pet stat.
const ENERGY_WEIGHTS = [14, 10, 7, 5, 3, 2, 1];
const ENERGY_CAP = 100;

// Events that count as "you engaged with your work."
const ENGAGEMENT_EVENTS = [
  'inbox_created',
  'inbox_resolved',
  'inbox_stage_changed',
  'task_created',
  'task_completed',
  'task_status_changed',
  'note_created',
  'journal_created'
];

function nowIso() {
  return new Date().toISOString();
}

function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function wholeDaysBetween(isoEarlier, isoLater) {
  const ms = new Date(isoLater) - new Date(isoEarlier);
  return Math.floor(ms / 86400000);
}

// Inactive items are excluded from every count here, and from staleness.
// Deactivating something IS the act of saying "not now" — having Clu3 then
// nag that it's been sitting for days would punish you for using the feature.
// They're reported separately as `inactive` so a rule can mention them if it
// ever wants to, but nothing treats them as live work.
function inboxSignals(staleBefore) {
  const byStage = { new: 0, active: 0, resolved: 0, archived: 0 };
  for (const r of db
    .prepare('SELECT stage, COUNT(*) AS n FROM inbox_items WHERE deactivated_at IS NULL GROUP BY stage')
    .all()) {
    byStage[r.stage] = r.n;
  }
  const inactive = db
    .prepare('SELECT COUNT(*) AS n FROM inbox_items WHERE deactivated_at IS NOT NULL')
    .get().n;
  const stale = db
    .prepare(
      `SELECT id, title, stage_changed_at FROM inbox_items
       WHERE stage IN ('new','active') AND deactivated_at IS NULL AND stage_changed_at < ?
       ORDER BY stage_changed_at ASC`
    )
    .all(staleBefore);
  return {
    new: byStage.new,
    active: byStage.active,
    resolved: byStage.resolved,
    archived: byStage.archived,
    inactive,
    pending: byStage.new + byStage.active,
    staleCount: stale.length,
    oldestStale: stale[0]
      ? { title: stale[0].title, days: wholeDaysBetween(stale[0].stage_changed_at, nowIso()) }
      : null
  };
}

function taskSignals(staleBefore) {
  const byStatus = { open: 0, doing: 0, done: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all()) {
    byStatus[r.status] = r.n;
  }
  const overdue = db
    .prepare(
      `SELECT id, title, due_at FROM tasks
       WHERE status != 'done' AND due_at IS NOT NULL AND due_at < ?
       ORDER BY due_at ASC`
    )
    .all(nowIso());
  const stalled = db
    .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'doing' AND created_at < ?`)
    .get(staleBefore).n;
  return {
    open: byStatus.open,
    doing: byStatus.doing,
    done: byStatus.done,
    active: byStatus.open + byStatus.doing,
    overdue: overdue.length,
    oldestOverdue: overdue[0]
      ? { title: overdue[0].title, days: wholeDaysBetween(overdue[0].due_at, nowIso()) }
      : null,
    stalled
  };
}

// Consecutive days (walking back from today) with at least one engagement
// event. Today not yet counting doesn't break the streak — we start the walk
// at today and stop on the first empty day that isn't today.
function streakDays(activeDays) {
  const set = new Set(activeDays);
  let streak = 0;
  for (let i = 0; i < 60; i += 1) {
    const day = daysAgoIso(i).slice(0, 10);
    if (set.has(day)) streak += 1;
    else if (i > 0) break;
  }
  return streak;
}

function energyFrom(rows) {
  let score = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const r of rows) {
    const d = new Date(r.occurred_at);
    d.setHours(0, 0, 0, 0);
    const daysAgo = Math.floor((today - d) / 86400000);
    const weight = ENERGY_WEIGHTS[daysAgo];
    if (weight) score += weight;
  }
  return Math.min(ENERGY_CAP, score);
}

function collect() {
  const staleBefore = daysAgoIso(STALE_DAYS);
  const placeholders = ENGAGEMENT_EVENTS.map(() => '?').join(',');

  const windowRows = db
    .prepare(
      `SELECT occurred_at, event_type FROM activity_log
       WHERE occurred_at >= ? AND event_type IN (${placeholders})`
    )
    .all(daysAgoIso(ENERGY_WINDOW_DAYS), ...ENGAGEMENT_EVENTS);

  const activeDays = [...new Set(windowRows.map((r) => r.occurred_at.slice(0, 10)))];

  const since = startOfTodayIso();
  const resolvedToday = db
    .prepare(
      "SELECT COUNT(*) AS n FROM activity_log WHERE event_type = 'inbox_resolved' AND occurred_at >= ?"
    )
    .get(since).n;
  const completedToday = db
    .prepare(
      "SELECT COUNT(*) AS n FROM activity_log WHERE event_type = 'task_completed' AND occurred_at >= ?"
    )
    .get(since).n;

  const lastJournal = db
    .prepare('SELECT created_at FROM journal_entries ORDER BY created_at DESC LIMIT 1')
    .get();
  const noteCount = db.prepare('SELECT COUNT(*) AS n FROM notes').get().n;
  const journalCount = db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get().n;
  const projectCount = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE archived = 0').get().n;

  const inbox = inboxSignals(staleBefore);
  const tasks = taskSignals(staleBefore);

  const wins = {
    resolvedToday,
    completedToday,
    today: resolvedToday + completedToday,
    streak: streakDays(activeDays)
  };

  return {
    inbox,
    tasks,
    notes: { total: noteCount },
    journal: {
      total: journalCount,
      daysSinceLast: lastJournal ? wholeDaysBetween(lastJournal.created_at, nowIso()) : null
    },
    projects: { total: projectCount },
    wins,
    energy: energyFrom(windowRows),
    hour: new Date().getHours(),
    // Convenience flags so rules stay readable.
    isEmptyWorkspace: inbox.pending === 0 && tasks.active === 0 && noteCount === 0 && journalCount === 0,
    isAllClear: inbox.pending === 0 && tasks.active === 0,
    thresholds: { STALE_DAYS, BUSY_INBOX, JOURNAL_GAP_DAYS, QUIET_HOUR }
  };
}

module.exports = { collect, STALE_DAYS, BUSY_INBOX, JOURNAL_GAP_DAYS, QUIET_HOUR };
