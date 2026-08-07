#!/usr/bin/env node
// Builds a shareable snapshot from fictional data, end to end:
//
//   seed data/demo.sqlite -> serve it on a spare port -> snapshot it -> stop
//
// WHY THIS IS A SCRIPT AND NOT THREE COMMANDS. Doing it by hand means setting
// PIP_DB_PATH before starting the server and remembering to point the snapshot
// at the right port. Forget the first and you publish the real database — the
// single failure this whole pipeline exists to prevent. Here the demo path is
// the only path the child server is ever given, so the mistake isn't available.
//
// It also runs on its own port, so a real `npm run server` you already have
// open on 4288 keeps running and is never the thing that gets captured.
//
// Usage:  node scripts/pip-snapshot-demo.js
//         npm run snapshot:demo

const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEMO_DB = path.join(ROOT, 'data', 'demo.sqlite');
const PORT = Number(process.env.PIP_DEMO_PORT) || 4299;
const BASE = `http://127.0.0.1:${PORT}`;

function run(label, file, args, env) {
  process.stdout.write(`\n=== ${label} ===\n`);
  execFileSync(file, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res.json();
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`server never became healthy at ${BASE}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Refuse to start if something already holds the port. Otherwise our own
// server loses the bind, waitForHealth cheerfully talks to whatever was
// already there, and the snapshot captures a database nobody chose — found
// exactly that way, against a stale server left over from an earlier run.
function assertPortFree() {
  return new Promise((resolve, reject) => {
    const srv = require('net').createServer();
    srv.once('error', (err) =>
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(
              `port ${PORT} is already in use — stop whatever is listening there, ` +
                'or set PIP_DEMO_PORT to a free port'
            )
          : err
      )
    );
    srv.listen(PORT, '127.0.0.1', () => srv.close(() => resolve()));
  });
}

async function main() {
  await assertPortFree();

  // Refuses before touching anything if scripts/demo-data hasn't been
  // reviewed against the current schema (see freshnessCheck.js) — this is
  // the "does the demo need updating" signal asked for before a deploy.
  run('checking demo data is current', process.execPath, ['scripts/demo-data/freshnessCheck.js', '--schema-only']);

  run('seeding fictional data', process.execPath, ['scripts/demo-data/index.js']);

  // Full check (schema + table coverage) against the database that was
  // actually just built — catches a new table the seeder silently leaves
  // empty, which the schema-only pre-flight above can't see.
  run('checking table coverage', process.execPath, ['scripts/demo-data/freshnessCheck.js', DEMO_DB]);

  process.stdout.write(`\n=== serving ${path.relative(ROOT, DEMO_DB)} on ${PORT} ===\n`);
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    // PIP_DISABLE_WEATHER_POLL keeps the server from immediately overwriting
    // seedWeather.js's fabricated, deterministic forecast with a real live
    // fetch on startup — see server/index.js.
    env: { ...process.env, PIP_DB_PATH: DEMO_DB, PIP_PORT: String(PORT), PIP_DISABLE_WEATHER_POLL: '1' }
  });

  let stopped = false;
  const stop = () => {
    if (!stopped) {
      stopped = true;
      server.kill('SIGTERM');
    }
  };
  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  try {
    const health = await waitForHealth();

    // Refuse rather than publish. If the served database isn't the demo one,
    // or isn't stamped as fictional, something upstream went wrong and the
    // next step would capture real client work into a shareable directory.
    if (path.resolve(health.dbPath) !== DEMO_DB) {
      throw new Error(`server is serving ${health.dbPath}, expected ${DEMO_DB}`);
    }
    if (health.demo !== true) {
      throw new Error('served database is not stamped as demo data — refusing to snapshot');
    }

    run('capturing snapshot', process.execPath, ['scripts/pip-snapshot.js'], { PIP_BASE: BASE });
  } finally {
    stop();
  }

  // Same check again, this time on what actually landed on disk: the banner
  // is driven by this flag, so a snapshot without it would look real.
  const injected = fs.readFileSync(path.join(ROOT, 'snapshot', 'index.html'), 'utf8');
  if (!/__PIP_STATIC__ = \{[^}]*"demo":true/.test(injected)) {
    throw new Error('snapshot/index.html is missing the demo flag — the banner would not appear');
  }

  process.stdout.write('\n=== done ===\nsnapshot/ is fictional data and says so.\n');
  process.stdout.write('Deploy with: npx netlify-cli deploy --dir snapshot --prod\n');
}

main().catch((err) => {
  console.error(`\nsnapshot:demo failed — ${err.message}`);
  process.exit(1);
});
