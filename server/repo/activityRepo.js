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

function recentActivity(limit = 50) {
  return db
    .prepare('SELECT * FROM activity_log ORDER BY occurred_at DESC LIMIT ?')
    .all(limit)
    .map((r) => ({ ...r, detail: safeParse(r.detail_json) }));
}

function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function throughputByDay(days = 14) {
  const since = daysAgoIso(days);
  const rows = db
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS day, event_type, COUNT(*) AS n
       FROM activity_log
       WHERE occurred_at >= ? AND event_type IN ('inbox_resolved', 'task_completed', 'inbox_created')
       GROUP BY day, event_type
       ORDER BY day ASC`
    )
    .all(since);
  const byDay = {};
  for (const r of rows) {
    byDay[r.day] = byDay[r.day] || { created: 0, resolved: 0, completed: 0 };
    if (r.event_type === 'inbox_created') byDay[r.day].created += r.n;
    if (r.event_type === 'inbox_resolved') byDay[r.day].resolved += r.n;
    if (r.event_type === 'task_completed') byDay[r.day].completed += r.n;
  }
  return byDay;
}

function avgResolutionHours(days = 30) {
  const since = daysAgoIso(days);
  const created = db
    .prepare(
      "SELECT entity_id, occurred_at FROM activity_log WHERE event_type = 'inbox_created' AND occurred_at >= ?"
    )
    .all(since);
  const resolvedMap = {};
  for (const r of db
    .prepare(
      "SELECT entity_id, MIN(occurred_at) AS resolved_at FROM activity_log WHERE event_type = 'inbox_resolved' GROUP BY entity_id"
    )
    .all()) {
    resolvedMap[r.entity_id] = r.resolved_at;
  }
  const spans = [];
  for (const c of created) {
    const resolvedAt = resolvedMap[c.entity_id];
    if (!resolvedAt) continue;
    const hours = (new Date(resolvedAt) - new Date(c.occurred_at)) / 36e5;
    if (hours >= 0) spans.push(hours);
  }
  if (!spans.length) return null;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
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
  throughputByDay,
  avgResolutionHours,
  countsBySourceType,
  countsByProject,
  topTags
};
