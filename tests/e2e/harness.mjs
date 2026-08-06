// E2E harness: a real server on a throwaway database, driven by a real browser.
//
// Separate from `npm test` on purpose. The unit suite is pure Node, runs in
// under a second, and can run anywhere. This needs a built bundle, a spare
// port and Chrome, so it lives behind `npm run test:e2e` — mixing them would
// make the fast suite slow and fragile.
//
// The database is a temp file seeded through the real repos, never the live
// data/pip.sqlite. A test that mutates your actual work would be worse than no
// test at all.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PIP_E2E_PORT) || 4399;
export const BASE = `http://127.0.0.1:${PORT}`;

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch (_) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not become healthy at ${BASE}`);
}

// Seed through the repos rather than raw SQL, so the fixture exercises the
// same paths the app does and can't drift from real behaviour.
function seed(dbPath) {
  process.env.PIP_DB_PATH = dbPath;
  const load = (rel) => require(join(process.cwd(), rel));
  const projects = load('server/repo/projectsRepo.js');
  const tasks = load('server/repo/tasksRepo.js');
  const notes = load('server/repo/notesRepo.js');
  const inbox = load('server/repo/inboxRepo.js');
  const journal = load('server/repo/journalRepo.js');

  const pid = projects.createProject({ name: 'E2E Project' });
  projects.createProject({ name: 'E2E Closed' });

  tasks.createTask({ title: 'E2E open task', projectId: pid, notesMd: 'findme' });
  const doing = tasks.createTask({ title: 'E2E doing task', projectId: pid });
  tasks.setTaskStatus(doing, 'doing');
  const done = tasks.createTask({ title: 'E2E done task', projectId: pid });
  tasks.setTaskStatus(done, 'done');

  notes.createNote({ title: 'E2E note', bodyMd: 'findme in a note', projectId: pid });
  inbox.createInboxItem({ title: 'E2E inbox item', bodyMd: 'findme in the inbox', projectId: pid });
  const held = inbox.createInboxItem({ title: 'E2E held item' });
  inbox.deactivateItem(held);
  journal.createEntry({ bodyMd: 'E2E journal entry, findme', projectId: pid });

  load('server/db.js').db.close();
  for (const key of Object.keys(require.cache)) {
    if (/server\/(db|repo)\//.test(key) || key.endsWith('server/db.js')) delete require.cache[key];
  }
}

export async function startApp() {
  if (!existsSync('server/public/pip.bundle.js')) {
    throw new Error('no build found — run `npm run build` before the e2e suite');
  }

  const dir = mkdtempSync(join(tmpdir(), 'pip-e2e-'));
  const dbPath = join(dir, 'e2e.sqlite');
  seed(dbPath);

  const server = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PIP_DB_PATH: dbPath,
      PIP_DROPS_PATH: join(dir, 'drops'),
      PIP_PORT: String(PORT),
      // The password gate would block every test; it's covered by its own.
      PIP_SNAPSHOT_PASSWORD: ''
    },
    stdio: 'pipe'
  });
  const logs = [];
  server.stdout.on('data', (d) => logs.push(String(d)));
  server.stderr.on('data', (d) => logs.push(String(d)));

  try {
    await waitForHealth();
  } catch (err) {
    server.kill('SIGKILL');
    throw new Error(`${err.message}\n--- server output ---\n${logs.join('')}`);
  }

  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Any uncaught page error is a failure — a view that throws while still
  // rendering something is exactly the kind of thing screenshots miss.
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  return {
    page,
    pageErrors,
    logs,
    async goto(hash) {
      await page.goto(`${BASE}/?e2e=${Date.now()}#/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
    },
    async stop() {
      await browser.close();
      server.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      server.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
