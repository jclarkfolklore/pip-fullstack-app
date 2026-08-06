#!/usr/bin/env node
// Builds a static, read-only copy of PIP that runs with no server.
//
// HOW THIS SURVIVES CHANGE — the whole design constraint.
//
// It does NOT reimplement the app. It runs the real frontend bundle and
// captures the real API's responses, so:
//   - a UI change is picked up automatically (same bundle, rebuilt)
//   - a data-model change is picked up automatically (same endpoints, whatever
//     they now return)
//   - a NEW collection endpoint is the only thing needing a change here, and
//     that's one line in ENDPOINTS below
//
// Detail routes and attachments are discovered by walking the collections
// rather than being listed, so adding a field — or a hundred rows — needs
// nothing at all.
//
// Search is the one thing that can't be captured as responses: it's a
// function of the query. The snapshot instead saves the SHAPED index the
// server already builds (/api/search/index), and the static client filters it
// in the browser. The shaping stays server-owned, so search results look the
// same as they do live.
//
// Usage:  node scripts/pip-snapshot.js [outDir]
//         npm run snapshot

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const BASE = process.env.PIP_BASE || 'http://127.0.0.1:4288';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'snapshot'));

// Collections to capture. Add a line here when a new one appears; everything
// else below is derived.
//   path      the API path to fetch
//   detail    if set, each row also gets <path>/<id> captured
//   entity    if set, each row's attachments are captured under that type
const ENDPOINTS = [
  { path: '/api/health' },
  { path: '/api/projects', detail: true },
  { path: '/api/inbox', detail: true, entity: 'inbox' },
  { path: '/api/tasks', detail: true, entity: 'task' },
  { path: '/api/notes', detail: true, entity: 'note' },
  { path: '/api/journal', detail: true, entity: 'journal' },
  { path: '/api/inbox/counts' },
  { path: '/api/tasks/counts' },
  { path: '/api/notes/counts' },
  { path: '/api/journal/counts' },
  { path: '/api/widgets' },
  { path: '/api/metrics' },
  { path: '/api/activity' },
  { path: '/api/tags' },
  { path: '/api/clu3' },
  { path: '/api/weather' },
  { path: '/api/weather/codes' },
  { path: '/api/search/index' }
];

// Optional gate password, from a gitignored .env. Only a SHA-256 of it is
// ever written into the snapshot — the plaintext never ships, so it isn't
// sitting in view-source. This is a deterrent, not access control: the
// captured JSON under /api/ stays directly fetchable.
function readGateHash() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return null;
  const line = fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('PIP_SNAPSHOT_PASSWORD='));
  if (!line) return null;
  const value = line
    .slice('PIP_SNAPSHOT_PASSWORD='.length)
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex');
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function getJson(urlPath) {
  const res = await fetch(BASE + urlPath);
  if (!res.ok) throw new Error(`${urlPath} -> ${res.status}`);
  return res.json();
}

// A URL path becomes a file path. Everything gets a .json extension so it can
// be served by any static host without content-type guesswork; the static
// client appends the same suffix when it rewrites a request.
function fileFor(urlPath) {
  return path.join(OUT, `${urlPath.replace(/^\//, '')}.json`);
}

function writeJson(urlPath, data) {
  const file = fileFor(urlPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) n += copyDir(src, dst);
    else {
      fs.copyFileSync(src, dst);
      n += 1;
    }
  }
  return n;
}

async function main() {
  // Fail early and clearly rather than writing a half-empty snapshot.
  try {
    await getJson('/api/health');
  } catch (err) {
    console.error(`Can't reach PIP at ${BASE} — start it first:\n\n  npm run server\n`);
    process.exit(1);
  }

  log('building frontend...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 1. the built app itself
  const appFiles = copyDir(path.join(ROOT, 'server', 'public'), OUT);
  log(`app: ${appFiles} file(s)`);

  // 2. collections, then everything they point at
  let count = 0;
  const attachmentIds = [];

  for (const ep of ENDPOINTS) {
    let data;
    try {
      data = await getJson(ep.path);
    } catch (err) {
      log(`  skip ${ep.path} (${err.message})`);
      continue;
    }
    writeJson(ep.path, data);
    count += 1;

    const rows = Array.isArray(data) ? data : [];
    if (ep.detail) {
      for (const row of rows) {
        if (!row || !row.id) continue;
        try {
          writeJson(`${ep.path}/${row.id}`, await getJson(`${ep.path}/${row.id}`));
          count += 1;
        } catch (_) {
          /* a detail route that doesn't exist isn't fatal */
        }
      }
    }
    if (ep.entity) {
      for (const row of rows) {
        if (!row || !row.id) continue;
        try {
          const list = await getJson(`/api/attachments?entityType=${ep.entity}&entityId=${row.id}`);
          if (list.length) {
            writeJson(`/api/attachments/${ep.entity}/${row.id}`, list);
            count += 1;
            for (const a of list) if (a.file_path) attachmentIds.push(a);
          }
        } catch (_) {
          /* attachments are optional */
        }
      }
    }
  }

  // project contents + contacts power the project modal
  try {
    for (const p of await getJson('/api/projects')) {
      writeJson(`/api/projects/${p.id}/contents`, await getJson(`/api/projects/${p.id}/contents`));
      writeJson(`/api/projects/${p.id}/contacts`, await getJson(`/api/projects/${p.id}/contacts`));
      const list = await getJson(`/api/attachments?entityType=project&entityId=${p.id}`);
      if (list.length) writeJson(`/api/attachments/project/${p.id}`, list);
      count += 3;
    }
  } catch (err) {
    log(`  project detail skipped (${err.message})`);
  }

  log(`api: ${count} response(s)`);

  // 3. attachment bytes, kept at the same URL the app already requests
  let bytes = 0;
  for (const a of attachmentIds) {
    try {
      const res = await fetch(`${BASE}/api/attachments/${a.id}/raw`);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const file = path.join(OUT, 'api', 'attachments', a.id, 'raw');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      bytes += buf.length;
    } catch (_) {
      /* a missing image shouldn't fail the snapshot */
    }
  }
  if (attachmentIds.length) log(`images: ${attachmentIds.length} (${Math.round(bytes / 1024)}kb)`);

  // 4. the flag that puts the app in read-only mode. Injected into index.html
  //    rather than probed at runtime, so there's no request race and a local
  //    dev load never pays for it.
  const gate = readGateHash();
  const indexFile = path.join(OUT, 'index.html');
  let html = fs.readFileSync(indexFile, 'utf8');
  html = html.replace(
    '<head>',
    `<head><script>window.__PIP_STATIC__ = ${JSON.stringify({
      generatedAt: new Date().toISOString(),
      ...(gate ? { gate } : {})
    })};</script>`
  );
  fs.writeFileSync(indexFile, html);
  log(gate ? 'gate: enabled (password from .env)' : 'gate: none (no PIP_SNAPSHOT_PASSWORD in .env)');

  // Netlify: serve the SPA for real routes, but never rewrite /api/*, or the
  // snapshot JSON would come back as index.html.
  fs.writeFileSync(
    path.join(OUT, '_redirects'),
    ['/api/*  /api/:splat  200', '/*      /index.html  200', ''].join('\n')
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    responses: count,
    images: attachmentIds.length,
    readOnly: true,
    gated: Boolean(gate)
  };
  fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(manifest, null, 2));

  log(`\nsnapshot ready: ${OUT}`);
  log('deploy:  npx netlify-cli deploy --dir snapshot --prod');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
