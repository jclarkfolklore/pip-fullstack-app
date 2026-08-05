#!/usr/bin/env node
//
// Idempotent upsert of external work items into PIP.
//
// Reads a JSON array on stdin and reconciles it against PIP through the API
// (never raw SQL — see CLAUDE.md). Safe to run repeatedly: the external id is
// the PIP id, so a second run updates in place rather than duplicating.
//
// This is the deterministic half of the sync. Claude gathers from Monday (or
// any other system) using whatever tools it has and hands the normalised
// records here, so the write path is identical no matter where the work came
// from — Monday today, ADO or personal items later.
//
// Record shape (all fields optional except id/title/kind):
//   {
//     id:        "monday-12704488282",   // REQUIRED, stable, source-prefixed
//     kind:      "inbox" | "task",
//     title:     "…",
//     bodyMd:    "…",
//     project:   "Best Buy",             // created on demand by name
//     sourceType:"monday",               // manual|chat|monday|ado|email|screenshot
//     sourceUrl: "https://…",
//     tags:      ["mention"],
//     state:     "open" | "done",        // the state IN THE SOURCE SYSTEM
//     dueAt:     "2026-08-12"            // tasks only
//   }
//
// `state` is what keeps PIP honest: an item that's been completed upstream is
// resolved/completed here too, rather than lingering as fake open work.
//
// Usage:
//   node scripts/pip-upsert.js < records.json
//   node scripts/pip-upsert.js --dry-run < records.json

const BASE = process.env.PIP_BASE_URL || 'http://127.0.0.1:4288';
const DRY = process.argv.includes('--dry-run');

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error || '';
    } catch (_) {
      /* ignore */
    }
    throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status} ${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patch = (p, body) =>
  api(p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// Projects are referenced by name; create on first mention.
async function resolveProjects(records) {
  const existing = await api('/api/projects');
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p.id]));
  const wanted = [...new Set(records.map((r) => r.project).filter(Boolean))];
  for (const name of wanted) {
    if (byName.has(name.toLowerCase())) continue;
    if (DRY) {
      console.log(`  + would create project "${name}"`);
      byName.set(name.toLowerCase(), '(dry-run)');
      continue;
    }
    const created = await post('/api/projects', { name });
    byName.set(name.toLowerCase(), created.id);
    console.log(`  + created project "${name}"`);
  }
  return byName;
}

async function upsertInbox(rec, projectId, index) {
  const existing = index.get(rec.id) || null;
  const doneUpstream = rec.state === 'done';

  if (!existing) {
    if (DRY) return console.log(`  + would create inbox "${rec.title}"${doneUpstream ? ' (already resolved)' : ''}`);
    // The drops importer keys on the caller-supplied id, which is what makes
    // re-running safe — so we go through it rather than POST /api/inbox
    // (which mints a random uuid).
    await post('/api/inbox/import', {
      id: rec.id,
      title: rec.title,
      bodyMd: rec.bodyMd || '',
      tags: rec.tags || [],
      source: 'monday-sync',
      sourceType: rec.sourceType || 'monday',
      sourceUrl: rec.sourceUrl || null,
      projectId: projectId || null
    });
    if (doneUpstream) await post(`/api/inbox/${rec.id}/resolve`, { outcomeMd: 'Completed upstream.', taskTitles: [] });
    return console.log(`  + inbox "${rec.title}"${doneUpstream ? ' (resolved)' : ''}`);
  }

  // Already present — reconcile the fields that can drift upstream.
  const changes = [];
  if (existing.title !== rec.title) changes.push('title');
  if (rec.bodyMd && existing.body_md !== rec.bodyMd) changes.push('body');
  if (projectId && existing.project_id !== projectId) changes.push('project');

  if (changes.length) {
    if (DRY) console.log(`  ~ would update inbox "${rec.title}" (${changes.join(', ')})`);
    else {
      await patch(`/api/inbox/${rec.id}`, {
        title: rec.title,
        bodyMd: rec.bodyMd || existing.body_md,
        projectId: projectId || existing.project_id,
        sourceUrl: rec.sourceUrl || existing.source_url
      });
      console.log(`  ~ inbox "${rec.title}" (${changes.join(', ')})`);
    }
  }

  // Honest state: resolve locally once it's done upstream.
  const openLocally = existing.stage === 'new' || existing.stage === 'active';
  if (doneUpstream && openLocally) {
    if (DRY) console.log(`  ~ would resolve inbox "${rec.title}" (done upstream)`);
    else {
      await post(`/api/inbox/${rec.id}/resolve`, { outcomeMd: 'Completed upstream.', taskTitles: [] });
      console.log(`  ~ resolved inbox "${rec.title}" (done upstream)`);
    }
  }
}

async function upsertTask(rec, projectId, tasksById) {
  const existing = tasksById.get(rec.id) || null;
  const doneUpstream = rec.state === 'done';
  const wantStatus = doneUpstream ? 'done' : rec.status || 'open';

  if (!existing) {
    if (DRY) return console.log(`  + would create task "${rec.title}" (${wantStatus})`);
    await post('/api/tasks/import', {
      id: rec.id,
      title: rec.title,
      notesMd: rec.bodyMd || '',
      projectId: projectId || null,
      dueAt: rec.dueAt || null,
      tags: rec.tags || []
    });
    if (wantStatus !== 'open') await post(`/api/tasks/${rec.id}/status`, { status: wantStatus });
    return console.log(`  + task "${rec.title}" (${wantStatus})`);
  }

  if (existing.status !== wantStatus) {
    if (DRY) console.log(`  ~ would set task "${rec.title}" ${existing.status} -> ${wantStatus}`);
    else {
      await post(`/api/tasks/${rec.id}/status`, { status: wantStatus });
      console.log(`  ~ task "${rec.title}" ${existing.status} -> ${wantStatus}`);
    }
  }
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error('No input. Pipe a JSON array of records on stdin.');
    process.exit(1);
  }

  let records;
  try {
    records = JSON.parse(raw);
  } catch (err) {
    console.error('Input is not valid JSON:', err.message);
    process.exit(1);
  }
  if (!Array.isArray(records)) {
    console.error('Input must be a JSON array.');
    process.exit(1);
  }

  const missing = records.filter((r) => !r.id || !r.title);
  if (missing.length) {
    console.error(`${missing.length} record(s) missing required id/title — aborting so nothing lands half-synced.`);
    process.exit(1);
  }

  if (DRY) console.log('DRY RUN — no writes\n');

  const projects = await resolveProjects(records);

  // Index what's already in PIP so we can tell create from update.
  const inboxIndex = new Map((await api('/api/inbox')).map((i) => [i.id, i]));
  const tasksById = new Map((await api('/api/tasks')).map((t) => [t.id, t]));

  for (const rec of records) {
    const projectId = rec.project ? projects.get(rec.project.toLowerCase()) : null;
    if (rec.kind === 'task') await upsertTask(rec, projectId, tasksById);
    else await upsertInbox(rec, projectId, inboxIndex);
  }

  console.log(`\nDone. ${records.length} record(s) reconciled.`);
}

main().catch((err) => {
  console.error('[pip-upsert] failed:', err.message);
  process.exit(1);
});
