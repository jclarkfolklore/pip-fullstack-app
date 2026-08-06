// Search parity (risk #8) and snapshot drift (risk #5).
//
// These two share a failure mode: something new gets added, a second place
// that needed updating doesn't get updated, and nothing complains. The static
// snapshot silently ships without the new data; static search silently
// disagrees with live search.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { withDb } from './helpers/db.mjs';
import { parseFrontmatter } from '../src/lib/frontmatter.js';

const require = createRequire(import.meta.url);

function seedEverything(load) {
  load('server/repo/tasksRepo.js').createTask({ title: 'Findable task', notesMd: 'needle' });
  load('server/repo/notesRepo.js').createNote({ title: 'Findable note', bodyMd: 'needle' });
  load('server/repo/inboxRepo.js').createInboxItem({ title: 'Findable inbox', bodyMd: 'needle' });
  load('server/repo/journalRepo.js').createEntry({ bodyMd: 'Findable journal needle' });
}

test('search covers every entity type', async () => {
  await withDb(({ load }) => {
    seedEverything(load);
    const types = new Set(
      load('server/repo/searchRepo.js')
        .search('needle')
        .map((r) => r.type)
    );
    for (const t of ['task', 'note', 'inbox', 'journal']) {
      assert.ok(types.has(t), `search returns ${t} results`);
    }
  });
});

test('the search index and live search agree on shape', async () => {
  // The static snapshot filters the index client-side; live search filters in
  // SQL. If the two shaped rows differently, the demo would quietly differ
  // from the real app.
  await withDb(({ load }) => {
    seedEverything(load);
    const repo = load('server/repo/searchRepo.js');
    const [live] = repo.search('needle');
    const indexed = repo.searchIndex().find((r) => r.id === live.id);

    assert.ok(indexed, 'the same row appears in the index');
    assert.deepEqual(Object.keys(live).sort(), Object.keys(indexed).sort(), 'identical field set');
    for (const k of Object.keys(live)) {
      assert.deepEqual(indexed[k], live[k], `field ${k} matches`);
    }
  });
});

test('the index contains everything live search can return', async () => {
  await withDb(({ load }) => {
    seedEverything(load);
    const repo = load('server/repo/searchRepo.js');
    const indexIds = new Set(repo.searchIndex().map((r) => r.id));
    for (const row of repo.search('needle')) {
      assert.ok(indexIds.has(row.id), `${row.type} ${row.id} is in the index`);
    }
  });
});

test('search results are deduplicated', async () => {
  await withDb(({ load }) => {
    // A row matching on both title and body must not appear twice.
    load('server/repo/tasksRepo.js').createTask({ title: 'needle', notesMd: 'needle' });
    const rows = load('server/repo/searchRepo.js').search('needle');
    const ids = rows.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'no duplicate rows');
  });
});

test('snapshot captures every collection endpoint', async () => {
  // Risk #5: adding a route without adding it to ENDPOINTS produces a demo
  // that is silently missing data. Rather than restate the list, read the
  // actual route files and require each collection GET to be covered.
  const script = readFileSync('scripts/pip-snapshot.js', 'utf8');
  const covered = [...script.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);

  const routeFiles = readdirSync('server/routes').filter((f) => f.endsWith('.js'));

  // Resources deliberately captured by a DIFFERENT mechanism, not by a plain
  // collection fetch. Each needs its own assertion below rather than a blanket
  // exemption, so "handled elsewhere" can't quietly become "not handled".
  const handledElsewhere = {
    'events.js': 'SSE stream — nothing to capture; static mode never opens it',
    'export.js': 'file download, not JSON',
    'search.js': 'captured as /api/search/index and filtered client-side',
    'attachments.js': 'walked per entity via the `entity` field on each collection'
  };

  const missing = [];
  for (const file of routeFiles) {
    if (handledElsewhere[file]) continue;
    const resource = file.replace('.js', '');
    const src = readFileSync(`server/routes/${file}`, 'utf8');
    // Does this resource expose a plain collection GET?
    if (!/router\.get\(\s*'\/'/.test(src)) continue;
    const expected = `/api/${resource}`;
    if (!covered.includes(expected)) missing.push(expected);
  }

  assert.deepEqual(missing, [], `snapshot ENDPOINTS is missing: ${missing.join(', ')}`);

  // And the exemptions are real, not stale.
  assert.ok(covered.includes('/api/search/index'), 'search is captured as an index');
  assert.ok(/entityType=\$\{ep\.entity\}/.test(script), 'attachments are walked per entity');
  assert.ok(
    /entityType=project/.test(script),
    'project attachments are captured too — projects are not in the entity walk'
  );
});

test('snapshot marks the right resources for per-entity detail', async () => {
  const script = readFileSync('scripts/pip-snapshot.js', 'utf8');
  for (const resource of ['inbox', 'tasks', 'notes', 'journal', 'projects']) {
    const re = new RegExp(`path:\\s*'/api/${resource}'[^}]*detail:\\s*true`);
    assert.ok(re.test(script), `${resource} captures per-entity detail`);
  }
});

test('frontmatter parses, and tolerates malformed input', async () => {
  // Drop files are hand-written; a broken one must not take the watcher down.
  const ok = parseFrontmatter('---\ntitle: Hello\ntags: [a, b]\n---\nBody here');
  assert.equal(ok.data.title, 'Hello');
  assert.ok(ok.body.includes('Body here'));

  const none = parseFrontmatter('Just a body, no frontmatter');
  assert.deepEqual(none.data, {}, 'no frontmatter is not an error');
  assert.ok(none.body.includes('Just a body'));

  assert.doesNotThrow(
    () => parseFrontmatter('---\nbroken: [unclosed\n---\nbody'),
    'malformed input does not throw'
  );
});

test('the CommonJS frontmatter twin behaves identically', async () => {
  // server/lib/frontmatter.js exists because the backend is CJS and can't
  // import the bundled ESM one. Two copies means they can drift.
  const cjs = require(process.cwd() + '/server/lib/frontmatter.js');
  const input = '---\ntitle: Same\nkind: note\n---\nShared body';
  assert.deepEqual(cjs.parseFrontmatter(input).data, parseFrontmatter(input).data, 'same parsed data');
  assert.equal(cjs.parseFrontmatter(input).body.trim(), parseFrontmatter(input).body.trim(), 'same body');
});
