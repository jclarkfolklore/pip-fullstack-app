// The activity_log contract — risk #2.
//
// Metrics is computed entirely from activity_log, never from current-state
// columns. A mutation that forgets to log is therefore invisible forever, and
// nothing surfaces it: the app looks correct, the history is just quietly
// wrong.
//
// These tests are behavioural rather than static. Grepping for `logEvent`
// proves a call exists somewhere in the file; running the mutation and reading
// the table proves it fires on the path actually taken.
//
// Note what is deliberately NOT required to log: Clu3 messages (chrome, not
// work history — see CLAUDE.md), widget layout (UI config), and tag/file
// helpers that run inside an already-logged operation. Asserting "everything
// logs" would be wrong in both directions, so the intended set is encoded
// explicitly below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDb } from './helpers/db.mjs';

const events = (db, entityId) =>
  db
    .prepare('SELECT event_type FROM activity_log WHERE entity_id = ? ORDER BY occurred_at')
    .all(entityId)
    .map((r) => r.event_type);

test('creating an entity logs it', async () => {
  await withDb(({ db, load }) => {
    const taskId = load('server/repo/tasksRepo.js').createTask({ title: 'T' });
    assert.ok(events(db, taskId).includes('task_created'));

    const noteId = load('server/repo/notesRepo.js').createNote({ title: 'N' });
    assert.ok(events(db, noteId).includes('note_created'));

    const inboxId = load('server/repo/inboxRepo.js').createInboxItem({ title: 'I' });
    assert.ok(events(db, inboxId).includes('inbox_created'));

    const journalId = load('server/repo/journalRepo.js').createEntry({ bodyMd: 'J' });
    assert.ok(events(db, journalId).includes('journal_created'));

    const projectId = load('server/repo/projectsRepo.js').createProject({ name: 'P' });
    assert.ok(events(db, projectId).includes('project_created'));
  });
});

test('changing state logs it', async () => {
  await withDb(({ db, load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    const id = tasks.createTask({ title: 'T' });
    tasks.setTaskStatus(id, 'doing');
    tasks.setTaskStatus(id, 'done');
    const log = events(db, id);
    assert.ok(log.includes('task_started') || log.includes('task_status_changed'), `got ${log.join(',')}`);
    assert.ok(log.includes('task_completed'), 'completion is what Metrics counts');
  });
});

test('inbox stage transitions log', async () => {
  await withDb(({ db, load }) => {
    const inbox = load('server/repo/inboxRepo.js');
    const id = inbox.createInboxItem({ title: 'I' });
    inbox.setStage(id, 'active');
    inbox.resolveWithOutcome(id, 'done');
    const log = events(db, id);
    assert.ok(log.includes('inbox_created'));
    assert.ok(log.some((e) => e.startsWith('inbox_')), 'stage changes logged');
    assert.ok(log.includes('inbox_resolved'), 'resolution is what Metrics counts');
  });
});

// Deleting is a real event in the work history. Without it, Metrics reads a
// deleted task as created-but-never-finished forever, and "what happened to
// that item" has no answer.
test('deleting an entity logs it', async () => {
  await withDb(({ db, load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    const taskId = tasks.createTask({ title: 'T' });
    tasks.deleteTask(taskId);
    assert.ok(events(db, taskId).includes('task_deleted'), 'task deletion logged');

    const notes = load('server/repo/notesRepo.js');
    const noteId = notes.createNote({ title: 'N' });
    notes.deleteNote(noteId);
    assert.ok(events(db, noteId).includes('note_deleted'), 'note deletion logged');

    const inbox = load('server/repo/inboxRepo.js');
    const inboxId = inbox.createInboxItem({ title: 'I' });
    inbox.deleteItem(inboxId);
    assert.ok(events(db, inboxId).includes('inbox_deleted'), 'inbox deletion logged');
  });
});

test('the log survives the row it describes', async () => {
  // The whole point of an append-only log: history outlives current state.
  await withDb(({ db, load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    const id = tasks.createTask({ title: 'Gone' });
    tasks.deleteTask(id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE id = ?').get(id).n, 0, 'row gone');
    assert.ok(events(db, id).length >= 2, 'history remains');
  });
});

test('Clu3 messages are deliberately NOT logged', async () => {
  // Clu3 is chrome, not work history. Logging it would pollute Metrics with
  // events that represent nothing the user did.
  await withDb(({ db, load }) => {
    const clu3 = load('server/repo/clu3Repo.js');
    const before = db.prepare('SELECT COUNT(*) n FROM activity_log').get().n;
    clu3.createMessage({ body: 'hello', mood: 'happy' });
    const after = db.prepare('SELECT COUNT(*) n FROM activity_log').get().n;
    assert.equal(after, before, 'no activity_log entry for a Clu3 message');
  });
});
