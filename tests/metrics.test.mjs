// Metrics aggregation — the queries the whole Metrics view is derived from.
//
// These exist because the redesign found three real defects in the old
// version, all of which were invisible: the chart plotted a series that was
// almost always empty, and days were bucketed in UTC so an evening's work
// was credited to tomorrow. None of that threw, and none of it looked wrong
// on screen — the numbers were simply not the numbers.
//
// So the rules here are: assert against a REAL derived value (never that a
// function merely returned something), and make anything timezone-dependent
// compute its own expectation from the same clock SQLite is using, so the
// test says the same thing on any machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDb } from './helpers/db.mjs';

// The local calendar day for an instant, per JS — which is the same wall
// clock SQLite's `localtime` modifier reads. Deriving the expectation this
// way rather than hardcoding a date is what keeps these tests honest
// outside the timezone they were written in.
function localDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Write an event at an exact instant. activityRepo.logEvent always stamps
// "now", so reaching past it is the only way to test bucketing.
function logAt(db, entityType, entityId, eventType, when, detail = {}) {
  db.prepare(
    'INSERT INTO activity_log (id, entity_type, entity_id, event_type, detail_json, occurred_at) VALUES (?,?,?,?,?,?)'
  ).run(
    `ev-${Math.random().toString(36).slice(2)}`,
    entityType,
    entityId,
    eventType,
    JSON.stringify(detail),
    when.toISOString()
  );
}

test('throughput buckets by LOCAL day, not UTC', async () => {
  // The original bug: `substr(occurred_at, 1, 10)` slices the UTC date
  // straight out of the ISO string. Anywhere west of UTC, work done in the
  // evening lands after UTC midnight and was credited to the next day — on
  // the live database that was ~15% of all events.
  await withDb(async ({ db, load }) => {
    const activity = load('server/repo/activityRepo.js');

    // 22:30 local today — same calendar day locally, and in a negative-UTC
    // offset it is already tomorrow in UTC.
    const evening = new Date();
    evening.setHours(22, 30, 0, 0);
    logAt(db, 'task', 't1', 'task_completed', evening);

    const byDay = activity.throughputByDay(28);
    const expected = localDay(evening);

    assert.ok(byDay[expected], `bucketed under the local day ${expected}, got ${Object.keys(byDay).join()}`);
    assert.equal(byDay[expected].completed, 1);

    // And specifically NOT under the UTC day, whenever those differ.
    const utcDay = evening.toISOString().slice(0, 10);
    if (utcDay !== expected) {
      assert.equal(byDay[utcDay], undefined, 'must not also appear under the UTC day');
    }
  });
});

test('throughput counts task completions, not only inbox resolutions', async () => {
  // The headline chart used to plot `resolved` (inbox_resolved only). On a
  // real workspace that is a handful of events against dozens of completed
  // tasks, so a busy week rendered as "no activity yet".
  await withDb(async ({ db, load }) => {
    const activity = load('server/repo/activityRepo.js');
    const now = new Date();
    now.setHours(12, 0, 0, 0);

    logAt(db, 'task', 't1', 'task_completed', now);
    logAt(db, 'task', 't2', 'task_completed', now);
    logAt(db, 'inbox_item', 'i1', 'inbox_resolved', now);
    logAt(db, 'task', 't3', 'task_created', now);
    logAt(db, 'inbox_item', 'i2', 'inbox_created', now);

    const day = activity.throughputByDay(28)[localDay(now)];
    assert.equal(day.completed, 2, 'task completions counted');
    assert.equal(day.resolved, 1, 'inbox resolutions counted separately');
    assert.equal(day.created, 2, 'creations from BOTH tasks and inbox');
  });
});

test('activityByHour is a zero-filled 7x24 grid in local time', async () => {
  await withDb(async ({ db, load }) => {
    const activity = load('server/repo/activityRepo.js');
    const when = new Date();
    when.setHours(9, 15, 0, 0);
    logAt(db, 'task', 't1', 'task_created', when);

    const grid = activity.activityByHour(28);
    assert.equal(grid.length, 7, 'seven weekday rows');
    assert.ok(
      grid.every((row) => row.length === 24),
      'every row has 24 hours — the caller should never have to rebuild the grid from sparse rows'
    );
    assert.equal(grid[when.getDay()][9], 1, 'landed on the local weekday and hour');
  });
});

test('closeTimeBuckets covers tasks as well as inbox items', async () => {
  // avgResolutionHours only ever paired inbox_created -> inbox_resolved, so
  // on a task-driven workspace it returned null and the card read "—" while
  // dozens of tasks had in fact been closed.
  await withDb(async ({ db, load }) => {
    const activity = load('server/repo/activityRepo.js');
    const base = new Date();
    base.setHours(9, 0, 0, 0);
    const twoHoursLater = new Date(base.getTime() + 2 * 36e5);
    const twoDaysLater = new Date(base.getTime() + 48 * 36e5);

    logAt(db, 'task', 'task-a', 'task_created', base);
    logAt(db, 'task', 'task-a', 'task_completed', twoHoursLater);
    logAt(db, 'inbox_item', 'inbox-a', 'inbox_created', base);
    logAt(db, 'inbox_item', 'inbox-a', 'inbox_resolved', twoDaysLater);

    const buckets = activity.closeTimeBuckets(30);
    const by = Object.fromEntries(buckets.map((b) => [b.label, b.n]));
    assert.equal(by['<4h'], 1, 'the 2-hour TASK pair is counted');
    assert.equal(by['<3d'], 1, 'the 2-day INBOX pair is counted');

    const avg = activity.avgResolutionHours(30);
    assert.ok(avg > 2 && avg < 48, `average spans both kinds, got ${avg}`);
  });
});

test('recentActivity resolves a title even when the event did not record one', async () => {
  // Status flips and field edits only store what changed, so the feed used
  // to show anonymous rows like "task_status_changed" with no indication of
  // WHICH task. The title is joined back at read time instead.
  await withDb(async ({ load }) => {
    const activity = load('server/repo/activityRepo.js');
    const tasks = load('server/repo/tasksRepo.js');
    const projects = load('server/repo/projectsRepo.js');

    const projectId = projects.createProject({ name: 'Forensics' });
    const taskId = tasks.createTask({ title: 'Find the regression', projectId });
    tasks.setTaskStatus(taskId, 'doing');

    const row = activity.recentActivity(10).find((r) => r.event_type === 'task_status_changed');
    assert.ok(row, 'the status change was logged');
    assert.equal(row.detail.title, undefined, 'the event itself carries no title — that is the premise');
    assert.equal(row.entity_title, 'Find the regression', 'resolved from the tasks table');
    assert.equal(row.project_name, 'Forensics', 'and its project came along too');
  });
});

test('recentActivity survives an event whose record was deleted', async () => {
  // An orphaned event is honest history — it really did happen to something
  // that no longer exists — so the join must degrade to null, not drop the
  // row or throw.
  await withDb(async ({ load }) => {
    const activity = load('server/repo/activityRepo.js');
    const tasks = load('server/repo/tasksRepo.js');

    const taskId = tasks.createTask({ title: 'Doomed' });
    tasks.deleteTask(taskId);

    const rows = activity.recentActivity(10).filter((r) => r.entity_id === taskId);
    assert.ok(rows.length >= 1, 'the events are still there');
    assert.ok(
      rows.some((r) => r.entity_title === null),
      'a deleted parent resolves to null rather than breaking the query'
    );
  });
});

test('tagGraph links only tags that share a record', async () => {
  await withDb(async ({ load }) => {
    const activity = load('server/repo/activityRepo.js');
    const notes = load('server/repo/notesRepo.js');

    notes.createNote({ title: 'A', tags: ['alpha', 'beta'] });
    notes.createNote({ title: 'B', tags: ['alpha', 'beta'] });
    notes.createNote({ title: 'C', tags: ['gamma'] });

    const { nodes, links } = activity.tagGraph();
    const byName = Object.fromEntries(nodes.map((n) => [n.id, n.n]));
    assert.equal(byName.alpha, 2, 'node weight is how often the tag is used');
    assert.equal(byName.gamma, 1);

    const pair = links.find(
      (l) => (l.source === 'alpha' && l.target === 'beta') || (l.source === 'beta' && l.target === 'alpha')
    );
    assert.ok(pair, 'co-occurring tags are linked');
    assert.equal(pair.n, 2, 'link weight is how many records they share');

    assert.ok(
      !links.some((l) => l.source === 'gamma' || l.target === 'gamma'),
      'a tag that never shares a record has no links — the graph must not invent a relationship'
    );
  });
});

test('activityByCategory groups by entity type', async () => {
  await withDb(async ({ load }) => {
    const activity = load('server/repo/activityRepo.js');
    const tasks = load('server/repo/tasksRepo.js');
    const notes = load('server/repo/notesRepo.js');

    tasks.createTask({ title: 'one' });
    tasks.createTask({ title: 'two' });
    notes.createNote({ title: 'a note' });

    const by = Object.fromEntries(activity.activityByCategory(7).map((c) => [c.entity_type, c.n]));
    assert.equal(by.task, 2);
    assert.equal(by.note, 1);
  });
});

test('firstEventAt marks where real history starts', async () => {
  // The view draws days before this as a faint baseline rather than a zero
  // bar: a zero for a day that predates the log is a padded number.
  await withDb(async ({ db, load }) => {
    const activity = load('server/repo/activityRepo.js');
    assert.equal(activity.firstEventAt(), null, 'null on an empty log');

    const early = new Date();
    early.setDate(early.getDate() - 3);
    logAt(db, 'task', 't1', 'task_created', early);
    logAt(db, 'task', 't2', 'task_created', new Date());

    assert.equal(activity.firstEventAt(), early.toISOString(), 'the earliest event, not the latest');
  });
});
