// A fresh database's widgets have to match SEED_WIDGETS exactly, including
// group_name — not just fall back to the column's default.
//
// The bug this catches: the insert that seeds widgets on a brand-new database
// once left group_name out entirely, so every widget silently landed in
// 'work' (the column's DEFAULT) regardless of what SEED_WIDGETS said. It
// stayed invisible because the one database anyone actually looked at
// (data/pip.sqlite) had already been patched by a migration — only a
// genuinely fresh database (a new install, or a from-scratch seeder) ever
// went through the buggy path, and nobody was looking at one of those.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDb } from './helpers/db.mjs';

test('a fresh database seeds every widget with its intended group_name', async () => {
  await withDb(async ({ db, load }) => {
    const { SEED_WIDGETS } = load('server/schema.js');
    const rows = db.prepare('SELECT id, group_name FROM widgets').all();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.group_name]));

    assert.equal(rows.length, SEED_WIDGETS.length, 'every seed widget got a row');
    for (const w of SEED_WIDGETS) {
      assert.equal(
        byId[w.id],
        w.group_name || 'work',
        `${w.id} should be grouped under "${w.group_name || 'work'}", not fallen back to the column default`
      );
    }
    // The specific case that actually shipped wrong: METRICS and SETTINGS
    // are supposed to stand apart from the WORK tiles.
    assert.equal(byId.metrics, 'insights');
    assert.equal(byId.settings, 'system');
  });
});
