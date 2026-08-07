// Attachment cleanup — risk #3.
//
// `attachments.entity_id` is polymorphic: one column pointing at five
// different tables. SQLite therefore cannot declare a foreign key on it and
// cannot cascade a delete. The entire guarantee that deleting a task removes
// its images lives in hand-written repo code, and nothing at the database
// level will complain if someone adds a sixth delete path and forgets.
//
// Files make it worse: an orphaned ROW is invisible but harmless, an orphaned
// FILE consumes disk forever. So these tests assert both halves.
//
// Written against the public API (addAttachment) rather than the internal
// insert/writeFile helpers — testing the surface callers actually use is what
// makes the test meaningful.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { withDb } from './helpers/db.mjs';

// A one-pixel PNG, base64 — content is irrelevant, only that bytes land on disk.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PARENTS = [
  {
    type: 'task',
    make: (load) => load('server/repo/tasksRepo.js').createTask({ title: 'T' }),
    del: (load, id) => load('server/repo/tasksRepo.js').deleteTask(id)
  },
  {
    type: 'note',
    make: (load) => load('server/repo/notesRepo.js').createNote({ title: 'N' }),
    del: (load, id) => load('server/repo/notesRepo.js').deleteNote(id)
  },
  {
    type: 'inbox',
    make: (load) => load('server/repo/inboxRepo.js').createInboxItem({ title: 'I' }),
    del: (load, id) => load('server/repo/inboxRepo.js').deleteItem(id)
  },
  {
    type: 'journal',
    make: (load) => load('server/repo/journalRepo.js').createEntry({ bodyMd: 'J' }),
    del: (load, id) => load('server/repo/journalRepo.js').deleteEntry(id)
  },
  {
    type: 'project',
    make: (load) => load('server/repo/projectsRepo.js').createProject({ name: 'P' }),
    del: (load, id) => load('server/repo/projectsRepo.js').deleteProject(id)
  }
];

for (const parent of PARENTS) {
  test(`deleting a ${parent.type} removes its attachment rows and files`, async () => {
    await withDb(async ({ db, load }) => {
      const att = load('server/repo/attachmentsRepo.js');
      const id = parent.make(load);

      await att.addAttachment({
        entityType: parent.type,
        entityId: id,
        kind: 'image',
        data: PNG_B64,
        mime: 'image/png'
      });
      await att.addAttachment({
        entityType: parent.type,
        entityId: id,
        kind: 'link',
        url: 'https://example.com',
        title: 'L'
      });

      assert.equal(att.listFor(parent.type, id).length, 2, 'two attachments before delete');
      const rel = db
        .prepare('SELECT file_path FROM attachments WHERE entity_id = ? AND kind = ?')
        .get(id, 'image').file_path;
      const abs = join(att.ATTACHMENTS_DIR, rel);
      assert.ok(existsSync(abs), 'file written to disk');

      parent.del(load, id);

      assert.equal(
        db.prepare('SELECT COUNT(*) n FROM attachments WHERE entity_id = ?').get(id).n,
        0,
        `${parent.type} delete removed attachment rows`
      );
      // The file must go too — an orphaned row is invisible, an orphaned file
      // is permanent disk usage.
      assert.ok(!existsSync(abs), `${parent.type} delete removed the stored file`);
    });
  });
}

test('sweepOrphans finds rows whose parent is gone', async () => {
  await withDb(async ({ db, load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const id = load('server/repo/tasksRepo.js').createTask({ title: 'T' });
    await att.addAttachment({ entityType: 'task', entityId: id, kind: 'link', url: 'https://example.com' });

    // Simulate the failure this mechanism exists to guard against: a parent
    // removed WITHOUT going through the repo, so cleanup never ran.
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attachments').get().n, 1, 'row is now orphaned');

    const { removedRows } = att.sweepOrphans();
    assert.ok(removedRows.length >= 1, 'sweep reported the orphan');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attachments').get().n, 0, 'orphan removed');
  });
});

test('sweepOrphans leaves valid attachments alone', async () => {
  // A sweep that deletes live data is far worse than one that misses an orphan.
  await withDb(async ({ db, load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const id = load('server/repo/tasksRepo.js').createTask({ title: 'Keep' });
    await att.addAttachment({ entityType: 'task', entityId: id, kind: 'link', url: 'https://example.com' });

    att.sweepOrphans();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attachments').get().n, 1, 'valid attachment survived');
  });
});

test('repo entity types match the schema CHECK constraint', async () => {
  // These two lists must agree, and they drifted once already: migration v11
  // widened the DB constraint to include 'project' while the repo's own
  // validation didn't, so projects were rejected in code while being perfectly
  // legal in the database. Compare them directly rather than restating either.
  await withDb(async ({ db, load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='attachments'").get().sql;
    const inCheck = [...sql.matchAll(/entity_type IN \(([^)]*)\)/g)][0][1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort();
    assert.deepEqual([...att.ENTITY_TYPES].sort(), inCheck, 'repo list matches the DB constraint');
  });
});

test('repo kinds match the schema CHECK constraint', async () => {
  // Same drift risk as entity_type above, now for `kind`: migration v12
  // widened the DB constraint to admit 'file', and this pins the repo's own
  // KINDS list to match rather than trusting the two were edited together.
  await withDb(async ({ db, load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='attachments'").get().sql;
    const inCheck = [...sql.matchAll(/kind IN \(([^)]*)\)/g)][0][1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .sort();
    assert.deepEqual([...att.KINDS].sort(), inCheck, 'repo list matches the DB constraint');
  });
});

test('a file attachment requires data and an explicit mime', async () => {
  // Unlike images, there's no sensible default mime for an arbitrary
  // document, and no url-fetch path (the documents this exists for sit
  // behind auth PIP doesn't hold) — both must be caught, not silently
  // defaulted.
  await withDb(async ({ load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const id = load('server/repo/tasksRepo.js').createTask({ title: 'T' });
    await assert.rejects(() => att.addAttachment({ entityType: 'task', entityId: id, kind: 'file' }));
    await assert.rejects(() =>
      att.addAttachment({ entityType: 'task', entityId: id, kind: 'file', data: 'AAAA' })
    );
  });
});

test('a file attachment stores bytes and is retrievable, separate from images', async () => {
  await withDb(async ({ load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const id = load('server/repo/tasksRepo.js').createTask({ title: 'T' });
    const pdfBytes = Buffer.from('%PDF-1.4 fake', 'utf8').toString('base64');
    const res = await att.addAttachment({
      entityType: 'task',
      entityId: id,
      kind: 'file',
      data: pdfBytes,
      mime: 'application/pdf',
      title: 'Data definitions'
    });
    assert.equal(res.attachment.kind, 'file');
    assert.equal(res.attachment.mime, 'application/pdf');

    const raw = att.rawFileFor(res.attachment.id);
    assert.ok(raw, 'file is retrievable');
    assert.match(raw.filename, /\.pdf$/, 'filename carries the right extension');

    const rows = att.listFor('task', id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'file');
  });
});

test('an unknown entity type is rejected', async () => {
  await withDb(async ({ load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    await assert.rejects(() =>
      att.addAttachment({ entityType: 'nonsense', entityId: 'x', kind: 'link', url: 'https://e.com' })
    );
  });
});

test('a link attachment requires a url', async () => {
  await withDb(async ({ load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const id = load('server/repo/tasksRepo.js').createTask({ title: 'T' });
    await assert.rejects(() => att.addAttachment({ entityType: 'task', entityId: id, kind: 'link' }));
  });
});

test('an unreachable image degrades to a link rather than being lost', async () => {
  // Most upstream images (ADO, monday) sit behind auth we don't hold. Dropping
  // them would silently lose the reference; a broken <img> is worse than a link.
  await withDb(async ({ load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const id = load('server/repo/tasksRepo.js').createTask({ title: 'T' });
    const res = await att.addAttachment({
      entityType: 'task',
      entityId: id,
      kind: 'image',
      url: 'http://127.0.0.1:9/not-reachable.png'
    });
    assert.ok(res.degraded, 'degradation reported to the caller');
    const rows = att.listFor('task', id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'link', 'kept as a link');
    assert.ok(rows[0].url.includes('not-reachable'), 'original url preserved');
  });
});

test('stored files are namespaced by entity, so cleanup is one directory', async () => {
  await withDb(async ({ db, load }) => {
    const att = load('server/repo/attachmentsRepo.js');
    const id = load('server/repo/tasksRepo.js').createTask({ title: 'T' });
    await att.addAttachment({
      entityType: 'task',
      entityId: id,
      kind: 'image',
      data: PNG_B64,
      mime: 'image/png'
    });
    const rel = db.prepare('SELECT file_path FROM attachments WHERE entity_id = ?').get(id).file_path;
    assert.ok(rel.includes('task'), 'path namespaced by entity type');
    assert.ok(rel.includes(id), 'path namespaced by entity id');
  });
});
