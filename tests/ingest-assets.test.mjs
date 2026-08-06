// scripts/pip-ingest-assets.js — the mechanical half of an asset sync.
//
// This script exists to take judgement out of the sync skills, so these tests
// are what actually make that true. Prose saying "don't attach it twice" is a
// hope; a passing idempotency test is a guarantee.
//
// Runs against a real server on a throwaway database — the script talks HTTP,
// so testing it any other way would test something else.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PORT = 4402;
const API = `http://127.0.0.1:${PORT}`;

// A real 1x1 PNG — the script reads actual bytes and base64s them.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let dir;
let server;
let taskId;

function run(records, args = []) {
  try {
    return {
      ok: true,
      out: execFileSync('node', ['scripts/pip-ingest-assets.js', ...args], {
        input: JSON.stringify(records),
        encoding: 'utf8',
        env: { ...process.env, PIP_API: API }
      })
    };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || ''), status: err.status };
  }
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pip-ingest-'));
  const dbPath = join(dir, 'test.sqlite');

  // Seed a task through the repos, then hand the same file to the server.
  process.env.PIP_DB_PATH = dbPath;
  const tasks = require(join(process.cwd(), 'server/repo/tasksRepo.js'));
  taskId = tasks.createTask({ title: 'Ingest target', notesMd: '' });
  tasks.updateFields(taskId, {
    detailsMd: '## Description\n\nBody text.\n\n## Acceptance Criteria\n\n- one\n'
  });
  require(join(process.cwd(), 'server/db.js')).db.close();
  for (const k of Object.keys(require.cache)) {
    if (/server\/(db|repo)\//.test(k) || k.endsWith('server/db.js')) delete require.cache[k];
  }

  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PIP_DB_PATH: dbPath, PIP_DROPS_PATH: join(dir, 'drops'), PIP_PORT: String(PORT) },
    stdio: 'pipe'
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${API}/api/health`)).ok) break;
    } catch (_) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  writeFileSync(join(dir, 'a.png'), PNG);
  writeFileSync(join(dir, 'b.png'), PNG);
});

after(() => {
  if (server) server.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PIP_DB_PATH;
});

const rec = (over = {}) => ({
  entityType: 'task',
  entityId: taskId,
  file: join(dir, 'a.png'),
  title: 'State dropdown open — option list at ~2x the type scale',
  ...over
});

test('attaches an image and places it inline', async () => {
  const r = run([rec()]);
  assert.ok(r.ok, r.out);

  const atts = await (await fetch(`${API}/api/attachments?entityType=task&entityId=${taskId}`)).json();
  assert.equal(atts.length, 1, 'one attachment');
  assert.equal(atts[0].kind, 'image');

  const task = await (await fetch(`${API}/api/tasks/${taskId}`)).json();
  assert.ok(task.details_md.includes(`/api/attachments/${atts[0].id}/raw`), 'referenced inline');
  assert.ok(task.details_md.includes(`*${atts[0].title}*`), 'caption line written');
});

test('placed at the end of Description, not appended to the whole document', async () => {
  // Where the image sits is the point — a screenshot after the acceptance
  // criteria reads as an afterthought rather than as part of the report.
  const task = await (await fetch(`${API}/api/tasks/${taskId}`)).json();
  const img = task.details_md.indexOf('![');
  const ac = task.details_md.indexOf('## Acceptance Criteria');
  assert.ok(img > 0 && ac > 0, 'both present');
  assert.ok(img < ac, 'image precedes the Acceptance Criteria heading');
});

test('re-running is a no-op — no duplicate attachment, no duplicate inline', async () => {
  // A re-sync is the normal case. This is the guarantee the skill can't make
  // in prose.
  const before = await (await fetch(`${API}/api/tasks/${taskId}`)).json();
  const r = run([rec()]);
  assert.ok(r.ok, r.out);
  assert.match(r.out, /already has/, 'reported as already present');

  const atts = await (await fetch(`${API}/api/attachments?entityType=task&entityId=${taskId}`)).json();
  assert.equal(atts.length, 1, 'still one attachment');

  const after = await (await fetch(`${API}/api/tasks/${taskId}`)).json();
  assert.equal(after.details_md, before.details_md, 'prose untouched');
  assert.equal((after.details_md.match(/!\[/g) || []).length, 1, 'one inline image');
});

test('a second distinct image is added without disturbing the first', async () => {
  const r = run([rec({ file: join(dir, 'b.png'), title: 'Focused state — square-cornered focus ring' })]);
  assert.ok(r.ok, r.out);
  const task = await (await fetch(`${API}/api/tasks/${taskId}`)).json();
  assert.equal((task.details_md.match(/!\[/g) || []).length, 2);
  assert.ok(task.details_md.includes('State dropdown open'), 'first caption still there');
});

test('dry-run writes nothing', async () => {
  const before = await (await fetch(`${API}/api/tasks/${taskId}`)).json();
  const beforeAtts = await (await fetch(`${API}/api/attachments?entityType=task&entityId=${taskId}`)).json();

  const r = run([rec({ title: 'Never actually attached' })], ['--dry-run']);
  assert.ok(r.ok, r.out);
  assert.match(r.out, /DRY RUN/);

  const after = await (await fetch(`${API}/api/tasks/${taskId}`)).json();
  const afterAtts = await (await fetch(`${API}/api/attachments?entityType=task&entityId=${taskId}`)).json();
  assert.equal(afterAtts.length, beforeAtts.length, 'no attachment created');
  assert.equal(after.details_md, before.details_md, 'prose untouched');
});

test('a caption that is just the filename is rejected', async () => {
  // The single most common way captions become useless.
  const r = run([rec({ title: 'a.png' })]);
  assert.equal(r.ok, false, 'should abort');
  assert.match(r.out, /caption what the image SHOWS/);
});

test('a missing file aborts the whole run before anything is written', async () => {
  const beforeAtts = await (await fetch(`${API}/api/attachments?entityType=task&entityId=${taskId}`)).json();
  const r = run([
    rec({ title: 'Valid caption here' }),
    rec({ file: join(dir, 'nope.png'), title: 'Also valid' })
  ]);
  assert.equal(r.ok, false);
  assert.match(r.out, /file not found/);

  const afterAtts = await (await fetch(`${API}/api/attachments?entityType=task&entityId=${taskId}`)).json();
  assert.equal(afterAtts.length, beforeAtts.length, 'the valid record was not partially ingested either');
});

test('an unknown entity type is rejected', async () => {
  const r = run([rec({ entityType: 'nonsense' })]);
  assert.equal(r.ok, false);
  assert.match(r.out, /bad entityType/);
});
