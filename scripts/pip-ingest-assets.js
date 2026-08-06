#!/usr/bin/env node
// Attach downloaded images to a PIP entity and place them inline in its prose.
//
// This exists to take judgement OUT of the sync skills. Attaching a file,
// captioning it, inlining it at the right place and not doing any of that
// twice is mechanical work — and mechanical work described in prose is work
// that drifts. The skill now says "run this", and the behaviour is pinned by
// tests/ingest-assets.test.mjs.
//
// Idempotent on (entity, caption): re-running never produces a second copy,
// which matters because a re-sync is the normal case, not the exception.
//
// Input on stdin — a JSON array:
//   [
//     {
//       "entityType": "task",
//       "entityId":   "ado-183767",
//       "file":       "/tmp/ado-imgs/pip-ado-183767-1.png",
//       "title":      "State dropdown open — option list at ~2x the type scale",
//       "placement":  "description"      // description | end   (default description)
//     }
//   ]
//
// Usage:
//   node scripts/pip-ingest-assets.js --dry-run < assets.json
//   node scripts/pip-ingest-assets.js < assets.json

const fs = require('fs');
const path = require('path');

const API = process.env.PIP_API || 'http://127.0.0.1:4288';
const DRY = process.argv.includes('--dry-run');

// Where the prose lives differs by entity; the caller shouldn't have to know.
const PROSE_FIELD = {
  task: 'details_md',
  inbox: 'details_md',
  note: 'body_md',
  journal: 'body_md',
  project: null // projects have no prose field — attach only
};

const ENDPOINT = {
  task: 'tasks',
  inbox: 'inbox',
  note: 'notes',
  journal: 'journal',
  project: 'projects'
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function send(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    /* non-JSON error body */
  }
  if (!res.ok) {
    // Surface the server's own message — a 413 says exactly what's wrong, and
    // swallowing it sends the next person into the server log for no reason.
    throw new Error(`${method} ${url} -> ${res.status} ${(parsed && parsed.error) || text.slice(0, 200)}`);
  }
  return parsed;
}

function inlineBlock(title, src) {
  // Image then an italic caption line: the modal styles that pair as a figure.
  return `![${title}](${src})\n\n*${title}*`;
}

async function main() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) {
    console.error('nothing on stdin — expected a JSON array of asset records');
    process.exit(1);
  }

  let records;
  try {
    records = JSON.parse(raw);
  } catch (err) {
    console.error('stdin is not valid JSON:', err.message);
    process.exit(1);
  }
  if (!Array.isArray(records)) {
    console.error('expected a JSON array');
    process.exit(1);
  }

  // Validate everything before touching anything, so a bad record can't leave
  // a half-ingested entity behind.
  const problems = [];
  for (const [i, r] of records.entries()) {
    if (!r.entityType || !ENDPOINT[r.entityType]) problems.push(`[${i}] bad entityType: ${r.entityType}`);
    if (!r.entityId) problems.push(`[${i}] missing entityId`);
    if (!r.file) problems.push(`[${i}] missing file`);
    else if (!fs.existsSync(r.file)) problems.push(`[${i}] file not found: ${r.file}`);
    // A caption that just repeats the filename tells a future reader nothing,
    // which is the whole reason captions exist.
    if (!r.title || !r.title.trim()) problems.push(`[${i}] missing title (caption)`);
    else if (r.file && r.title.trim() === path.basename(r.file)) {
      problems.push(`[${i}] title is just the filename — caption what the image SHOWS`);
    }
  }
  if (problems.length) {
    console.error(`${problems.length} bad record(s) — aborting so nothing lands half-ingested:`);
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }

  if (DRY) console.log('DRY RUN — no writes\n');

  // Group by entity so prose is rewritten once, with every image in order.
  const byEntity = new Map();
  for (const r of records) {
    const key = `${r.entityType}::${r.entityId}`;
    if (!byEntity.has(key)) byEntity.set(key, []);
    byEntity.get(key).push(r);
  }

  let attached = 0;
  let skipped = 0;
  let inlined = 0;

  for (const [key, group] of byEntity) {
    const [entityType, entityId] = key.split('::');
    const existing = await getJson(`${API}/api/attachments?entityType=${entityType}&entityId=${entityId}`);
    const seen = new Set(existing.map((a) => (a.title || '').trim()));
    const fresh = [];

    for (const r of group) {
      const title = r.title.trim();
      if (seen.has(title)) {
        skipped += 1;
        console.log(`  = ${entityId}  already has "${title.slice(0, 52)}"`);
        continue;
      }
      if (DRY) {
        console.log(`  + would attach to ${entityId}: ${title.slice(0, 52)}`);
        attached += 1;
        continue;
      }
      const buf = fs.readFileSync(r.file);
      const out = await send('POST', `${API}/api/attachments`, {
        entityType,
        entityId,
        kind: 'image',
        data: buf.toString('base64'),
        mime: r.mime || 'image/png',
        title,
        source: r.source || 'sync'
      });
      const a = out.attachment;
      fresh.push({ title, src: `/api/attachments/${a.id}/raw` });
      attached += 1;
      console.log(`  + ${entityId}  ${String(buf.length).padStart(8)}b  ${title.slice(0, 52)}`);
    }

    const field = PROSE_FIELD[entityType];
    if (!field || (!fresh.length && !DRY)) continue;
    if (DRY) continue;

    const record = await getJson(`${API}/api/${ENDPOINT[entityType]}/${entityId}`);
    let md = record[field] || '';
    const additions = fresh.filter((f) => !md.includes(f.src));
    if (!additions.length) continue;

    const block = '\n\n' + additions.map((f) => inlineBlock(f.title, f.src)).join('\n\n') + '\n';

    // Default placement is the end of the Description section, which is where
    // these sat on the source ticket. Falls back to the end of the prose.
    const placement = group[0].placement || 'description';
    let next = -1;
    if (placement === 'description') {
      const descAt = md.indexOf('## Description');
      if (descAt >= 0) next = md.indexOf('\n## ', descAt + 5);
    }
    md = next > 0 ? md.slice(0, next) + block + md.slice(next) : md + block;

    const body = field === 'details_md' ? { detailsMd: md } : { bodyMd: md };
    await send('PATCH', `${API}/api/${ENDPOINT[entityType]}/${entityId}`, body);
    inlined += additions.length;
    console.log(`  ~ ${entityId}  inlined ${additions.length} image(s)`);
  }

  console.log(
    `\n${DRY ? 'Would attach' : 'Attached'} ${attached}, skipped ${skipped} already present, inlined ${inlined}.`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
