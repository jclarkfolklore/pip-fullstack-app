const crypto = require('crypto');
const { db } = require('../db');

function newId() {
  return crypto.randomUUID();
}

// The single write path for the work-log. Every repo function that changes
// something meaningful calls this — it's what turns "current state" into
// "history you can derive metrics from," and it's also the first place
// Claude should look when asked "what's happened lately."
function logEvent(entityType, entityId, eventType, detail = {}) {
  db.prepare(
    'INSERT INTO activity_log (id, entity_type, entity_id, event_type, detail_json, occurred_at) VALUES (?,?,?,?,?,?)'
  ).run(newId(), entityType, entityId, eventType, JSON.stringify(detail), new Date().toISOString());
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch (_) {
    return {};
  }
}

// The feed is meant to be usable for forensics ("what actually happened to
// this thing, and when"), which the raw table isn't: detail_json only
// carries a title on the events that happened to record one, so a status
// flip or a field edit shows up as an anonymous row.
//
// Rather than change the write path — that would mean touching every
// logEvent call site and would still leave old rows anonymous — the title
// is resolved at read time by joining back to whichever table entity_type
// names. Deleted parents simply resolve to null, which is honest: the event
// really did happen to something that no longer exists.
function recentActivity(limit = 50) {
  return db
    .prepare(
      `SELECT a.*,
              COALESCE(t.title, n.title, i.title, p.name, substr(j.body_md, 1, 60)) AS entity_title,
              COALESCE(tp.name, np.name, ip.name, jp.name) AS project_name
       FROM activity_log a
       LEFT JOIN tasks       t ON t.id = a.entity_id AND a.entity_type = 'task'
       LEFT JOIN notes       n ON n.id = a.entity_id AND a.entity_type = 'note'
       LEFT JOIN inbox_items i ON i.id = a.entity_id AND a.entity_type = 'inbox_item'
       LEFT JOIN projects    p ON p.id = a.entity_id AND a.entity_type = 'project'
       LEFT JOIN journal_entries j ON j.id = a.entity_id AND a.entity_type = 'journal_entry'
       LEFT JOIN projects tp ON tp.id = t.project_id
       LEFT JOIN projects np ON np.id = n.project_id
       LEFT JOIN projects ip ON ip.id = i.project_id
       LEFT JOIN projects jp ON jp.id = j.project_id
       ORDER BY a.occurred_at DESC
       LIMIT ?`
    )
    .all(limit)
    .map((r) => ({ ...r, detail: safeParse(r.detail_json) }));
}

// Tags as a network rather than a leaderboard: `nodes` is each tag with how
// often it's used, `links` is how often two tags land on the same entity.
// Both are counted straight from entity_tags — a co-occurrence is a real
// shared record, never an inferred or weighted "similarity".
function tagGraph() {
  const nodes = db
    .prepare(
      `SELECT t.name AS id, COUNT(*) AS n
       FROM tags t JOIN entity_tags et ON et.tag_id = t.id
       GROUP BY t.name ORDER BY n DESC`
    )
    .all();
  const links = db
    .prepare(
      `SELECT t1.name AS source, t2.name AS target, COUNT(*) AS n
       FROM entity_tags e1
       JOIN entity_tags e2
         ON e1.entity_type = e2.entity_type AND e1.entity_id = e2.entity_id AND e1.tag_id < e2.tag_id
       JOIN tags t1 ON t1.id = e1.tag_id
       JOIN tags t2 ON t2.id = e2.tag_id
       GROUP BY t1.name, t2.name
       ORDER BY n DESC`
    )
    .all();
  return { nodes, links };
}

// What kind of thing has been happening lately — the RECENT page's own mini
// breakdown, grouped by entity_type (already exactly the right granularity:
// inbox_item/task/note/project/journal_entry, no event_type parsing needed).
function activityByCategory(days = 7) {
  const since = daysAgoIso(days);
  return db
    .prepare(
      `SELECT entity_type, COUNT(*) AS n FROM activity_log WHERE occurred_at >= ? GROUP BY entity_type ORDER BY n DESC`
    )
    .all(since);
}

// The earliest thing the log has ever seen. Metrics needs this to tell "no
// activity that day" apart from "the log didn't exist yet that day" — the
// difference between a real zero and a padded one.
function firstEventAt() {
  const row = db.prepare('SELECT MIN(occurred_at) AS at FROM activity_log').get();
  return row.at || null;
}

function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// Bucketed by the LOCAL calendar day, not UTC. This is a personal, one-
// machine app — server and user share a timezone — so `occurred_at`
// (UTC ISO) has to be converted rather than sliced. Slicing UTC directly
// (the previous approach) misattributed any event from evening-to-midnight
// local time to the next day; on the live data that was ~15% of events.
function throughputByDay(days = 28) {
  const since = daysAgoIso(days);
  const rows = db
    .prepare(
      `SELECT date(occurred_at, 'localtime') AS day, event_type, COUNT(*) AS n
       FROM activity_log
       WHERE occurred_at >= ?
         AND event_type IN ('inbox_created', 'inbox_resolved', 'task_created', 'task_completed')
       GROUP BY day, event_type
       ORDER BY day ASC`
    )
    .all(since);
  const byDay = {};
  for (const r of rows) {
    byDay[r.day] = byDay[r.day] || { created: 0, resolved: 0, completed: 0 };
    if (r.event_type === 'inbox_created' || r.event_type === 'task_created') byDay[r.day].created += r.n;
    if (r.event_type === 'inbox_resolved') byDay[r.day].resolved += r.n;
    if (r.event_type === 'task_completed') byDay[r.day].completed += r.n;
  }
  return byDay;
}

// Total events per local calendar day — the contribution calendar. Kept
// separate from throughputByDay because that one splits by event meaning
// (created / resolved / completed); this is simply "how much happened",
// which is what a calendar heatmap answers.
function dailyActivity(days = 182) {
  const since = daysAgoIso(days);
  const rows = db
    .prepare(
      `SELECT date(occurred_at, 'localtime') AS day, COUNT(*) AS n
       FROM activity_log WHERE occurred_at >= ?
       GROUP BY day ORDER BY day ASC`
    )
    .all(since);
  return Object.fromEntries(rows.map((r) => [r.day, r.n]));
}

// Hour-of-day (0-23, local) x day-of-week (0=Sunday, local) — the punchcard.
// SQLite's strftime with 'localtime' does the conversion; %w and %H read off
// the converted value.
function activityByHour(days = 28) {
  const since = daysAgoIso(days);
  const rows = db
    .prepare(
      `SELECT
         CAST(strftime('%w', occurred_at, 'localtime') AS INTEGER) AS dow,
         CAST(strftime('%H', occurred_at, 'localtime') AS INTEGER) AS hour,
         COUNT(*) AS n
       FROM activity_log
       WHERE occurred_at >= ?
       GROUP BY dow, hour`
    )
    .all(since);
  // 7 rows (Sun..Sat) x 24 cols, zero-filled — the caller shouldn't have to
  // reconstruct the grid from sparse rows.
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of rows) grid[r.dow][r.hour] = r.n;
  return grid;
}

// task_completed events, joined back to the task's project — per-project
// small multiples. entity_id on activity_log is polymorphic, so this only
// touches rows the join can actually resolve (event_type pins it to tasks);
// a task whose project was later unassigned or deleted just doesn't appear,
// same as `countsByProject` already behaves.
function completionsByProject(days = 14) {
  const since = daysAgoIso(days);
  return db
    .prepare(
      `SELECT p.id AS project_id, p.name AS project_name,
              date(a.occurred_at, 'localtime') AS day, COUNT(*) AS n
       FROM activity_log a
       JOIN tasks t ON t.id = a.entity_id
       JOIN projects p ON p.id = t.project_id
       WHERE a.event_type = 'task_completed' AND a.occurred_at >= ?
       GROUP BY p.id, day
       ORDER BY p.name, day ASC`
    )
    .all(since);
}

// Every created->closed pair the log can actually account for, across BOTH
// inbox items and tasks — averaged together (previously inbox-only, which on
// a workspace where nearly all closures are tasks left this null almost all
// the time; see closeTimeBuckets for the same pairing broken into buckets).
function closedSpansHours(days = 30) {
  const since = daysAgoIso(days);
  const pairs = [
    ['inbox_created', 'inbox_resolved'],
    ['task_created', 'task_completed']
  ];
  const spans = [];
  for (const [createdType, closedType] of pairs) {
    const created = db
      .prepare('SELECT entity_id, occurred_at FROM activity_log WHERE event_type = ? AND occurred_at >= ?')
      .all(createdType, since);
    const closedMap = {};
    for (const r of db
      .prepare(
        'SELECT entity_id, MIN(occurred_at) AS closed_at FROM activity_log WHERE event_type = ? GROUP BY entity_id'
      )
      .all(closedType)) {
      closedMap[r.entity_id] = r.closed_at;
    }
    for (const c of created) {
      const closedAt = closedMap[c.entity_id];
      if (!closedAt) continue;
      const hours = (new Date(closedAt) - new Date(c.occurred_at)) / 36e5;
      if (hours >= 0) spans.push(hours);
    }
  }
  return spans;
}

function avgResolutionHours(days = 30) {
  const spans = closedSpansHours(days);
  if (!spans.length) return null;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

// Same spans as avgResolutionHours, bucketed for a histogram rather than
// averaged to one number — an average hides whether "1.4 days" means
// everything closes in a day, or half close in an hour and half take a week.
function closeTimeBuckets(days = 30) {
  const buckets = [
    { label: '<4h', max: 4, n: 0 },
    { label: '<1d', max: 24, n: 0 },
    { label: '<3d', max: 72, n: 0 },
    { label: '<1w', max: 168, n: 0 },
    { label: '≥1w', max: Infinity, n: 0 }
  ];
  for (const hours of closedSpansHours(days)) {
    const b = buckets.find((b) => hours < b.max);
    (b || buckets[buckets.length - 1]).n += 1;
  }
  return buckets.map(({ label, n }) => ({ label, n }));
}

function countsBySourceType() {
  return db
    .prepare(
      `SELECT source_type, COUNT(*) AS n FROM (
         SELECT source_type FROM inbox_items
         UNION ALL
         SELECT source_type FROM notes
       ) GROUP BY source_type ORDER BY n DESC`
    )
    .all();
}

function countsByProject() {
  return db
    .prepare(
      `SELECT p.id, p.name, COUNT(*) AS n FROM (
         SELECT project_id FROM inbox_items WHERE stage != 'archived'
         UNION ALL
         SELECT project_id FROM tasks WHERE status != 'done'
         UNION ALL
         SELECT project_id FROM notes
       ) x JOIN projects p ON p.id = x.project_id
       GROUP BY p.id, p.name ORDER BY n DESC`
    )
    .all();
}

function topTags(limit = 6) {
  return db
    .prepare(
      `SELECT t.name AS tag, COUNT(*) AS n
       FROM tags t
       JOIN entity_tags et ON et.tag_id = t.id
       GROUP BY t.name
       ORDER BY n DESC
       LIMIT ?`
    )
    .all(limit);
}

module.exports = {
  logEvent,
  recentActivity,
  activityByCategory,
  tagGraph,
  firstEventAt,
  throughputByDay,
  activityByHour,
  dailyActivity,
  completionsByProject,
  avgResolutionHours,
  closeTimeBuckets,
  countsBySourceType,
  countsByProject,
  topTags
};
