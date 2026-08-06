// Inactive (held) items — risk #4.
//
// The design point: `stage` is the lifecycle, `deactivated_at` is a hold, and
// the two are ORTHOGONAL. Holding an item doesn't change where it is in its
// lifecycle; it just means "not what I'm working on". That's what lets
// reactivating return an item to exactly where it was rather than dumping it
// in a fixed default stage.
//
// The cost of that design is that "exclude held items" has to be repeated
// everywhere something counts as live work — currently ten places across
// inboxRepo and clu3/signals. Any one of them forgetting is a silent wrong
// number, so each is asserted separately here rather than trusting one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDb } from './helpers/db.mjs';

function seed(load) {
  const inbox = load('server/repo/inboxRepo.js');
  const live = inbox.createInboxItem({ title: 'Live' });
  const held = inbox.createInboxItem({ title: 'Held' });
  inbox.setStage(live, 'active');
  inbox.setStage(held, 'active');
  inbox.deactivateItem(held);
  return { inbox, live, held };
}

test('a held item is excluded from its stage count and counted separately', async () => {
  await withDb(({ load }) => {
    const { inbox } = seed(load);
    const counts = inbox.stageCounts();
    assert.equal(counts.active, 1, 'only the live item counts as active');
    assert.equal(counts.deactivated, 1, 'held item counted on its own');
  });
});

test('filtering by a stage excludes held items', async () => {
  await withDb(({ load }) => {
    const { inbox } = seed(load);
    const active = inbox.listInboxItems({ stage: 'active' });
    assert.equal(active.length, 1);
    assert.equal(active[0].title, 'Live', 'held item not returned as active work');
  });
});

test("filtering by 'inactive' returns exactly the held items", async () => {
  await withDb(({ load }) => {
    const { inbox } = seed(load);
    const held = inbox.listInboxItems({ stage: 'inactive' });
    assert.equal(held.length, 1);
    assert.equal(held[0].title, 'Held');
  });
});

test('held items sort last regardless of sort order', async () => {
  // Being on hold is orthogonal to the lifecycle, but it does mean "not what
  // you're working on" — so it belongs out of the way, not interleaved by date.
  await withDb(({ load }) => {
    const inbox = load('server/repo/inboxRepo.js');
    const held = inbox.createInboxItem({ title: 'Held' });
    inbox.deactivateItem(held);
    inbox.createInboxItem({ title: 'Newer live' });

    for (const sort of ['created_desc', 'created_asc', 'title_asc']) {
      const titles = inbox.listInboxItems({ sort }).map((i) => i.title);
      assert.equal(titles[titles.length - 1], 'Held', `held last with sort=${sort}`);
    }
  });
});

test('holding does not change the lifecycle stage', async () => {
  await withDb(({ db, load }) => {
    const inbox = load('server/repo/inboxRepo.js');
    const id = inbox.createInboxItem({ title: 'X' });
    inbox.setStage(id, 'active');
    inbox.deactivateItem(id);
    const row = db.prepare('SELECT stage, deactivated_at FROM inbox_items WHERE id = ?').get(id);
    assert.equal(row.stage, 'active', 'stage untouched — the hold is a separate axis');
    assert.ok(row.deactivated_at, 'hold recorded');
  });
});

test('reactivating restores the original stage, not a default', async () => {
  // This is the payoff of keeping them orthogonal, and the thing that breaks
  // if someone "simplifies" the hold into a stage value.
  await withDb(({ load }) => {
    const inbox = load('server/repo/inboxRepo.js');
    const id = inbox.createInboxItem({ title: 'X' });
    inbox.setStage(id, 'resolved');
    inbox.deactivateItem(id);
    const back = inbox.reactivateItem(id);
    assert.equal(back.stage, 'resolved', 'returned to where it was');
    assert.equal(back.deactivated_at, null, 'hold cleared');
  });
});

test('Clu3 does not see held items as pending or stale', async () => {
  // Clu3 nagging about work you deliberately parked is the exact failure this
  // guards against.
  await withDb(({ db, load }) => {
    const inbox = load('server/repo/inboxRepo.js');
    const id = inbox.createInboxItem({ title: 'Parked' });
    inbox.setStage(id, 'active');
    inbox.deactivateItem(id);
    // Backdate it well past any staleness threshold.
    db.prepare("UPDATE inbox_items SET stage_changed_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);

    const signals = load('server/clu3/signals.js').collect();
    assert.equal(signals.inbox.pending, 0, 'held item is not pending work');
    assert.equal(signals.inbox.staleCount, 0, 'held item is never stale');
  });
});

test('a live item IS seen as pending and can go stale', async () => {
  // The mirror of the test above — proves the exclusions above are real
  // filtering rather than the signal being broken for everything.
  await withDb(({ db, load }) => {
    const inbox = load('server/repo/inboxRepo.js');
    const id = inbox.createInboxItem({ title: 'Live' });
    inbox.setStage(id, 'active');
    db.prepare("UPDATE inbox_items SET stage_changed_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);

    const signals = load('server/clu3/signals.js').collect();
    assert.equal(signals.inbox.pending, 1);
    assert.equal(signals.inbox.staleCount, 1);
  });
});
