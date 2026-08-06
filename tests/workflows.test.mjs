// End-to-end workflows — the sequences a person actually performs.
//
// The unit tests cover each repo function in isolation. These cover the paths
// through them, because that's where assumptions between functions break:
// resolving an inbox item spawns tasks, deleting a project must NOT delete its
// work, re-running a sync must not duplicate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDb } from './helpers/db.mjs';

test('inbox lifecycle: new -> active -> resolved -> archived', async () => {
  await withDb(({ load }) => {
    const inbox = load('server/repo/inboxRepo.js');
    const id = inbox.createInboxItem({ title: 'Triage me' });
    assert.equal(inbox.getInboxItem(id).stage, 'new', 'arrivals start new, not active');

    for (const stage of ['active', 'resolved', 'archived']) {
      inbox.setStage(id, stage);
      assert.equal(inbox.getInboxItem(id).stage, stage);
    }
  });
});

test('resolving an inbox item can spawn several tasks', async () => {
  // One-to-many by design: the old model had a single resolved_task_id, which
  // couldn't express "this splits into three pieces of work".
  await withDb(({ load }) => {
    const inbox = load('server/repo/inboxRepo.js');
    const tasks = load('server/repo/tasksRepo.js');
    const id = inbox.createInboxItem({ title: 'Big thing' });

    inbox.resolveWithOutcome(id, 'split up');
    for (const title of ['Part one', 'Part two', 'Part three']) {
      tasks.createTask({ title, fromInboxItemId: id });
    }

    const spawned = tasks.listTasksFromInboxItem(id);
    assert.equal(spawned.length, 3, 'all three linked back');
    assert.equal(inbox.getInboxItem(id).resolvedTasks.length, 3, 'visible from the inbox item');
  });
});

test('task status round-trips and clears completed_at on reopen', async () => {
  // A reopened task showing a completion date would quietly corrupt Metrics.
  await withDb(({ db, load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    const id = tasks.createTask({ title: 'T' });

    tasks.setTaskStatus(id, 'done');
    assert.ok(
      db.prepare('SELECT completed_at FROM tasks WHERE id=?').get(id).completed_at,
      'completion stamped'
    );

    tasks.setTaskStatus(id, 'open');
    assert.equal(
      db.prepare('SELECT completed_at FROM tasks WHERE id=?').get(id).completed_at,
      null,
      'reopening clears the completion date'
    );
  });
});

test('re-running a sync updates rather than duplicating', async () => {
  // importTask is idempotent on a caller-supplied id — that's what makes the
  // monday/ADO sync safe to run twice.
  await withDb(({ db, load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    const rec = {
      id: 'ado-999',
      title: 'Ticket',
      sourceType: 'ado',
      sourceRef: '999',
      sourceUrl: 'https://x/999'
    };

    const first = tasks.importTask(rec);
    const second = tasks.importTask(rec);

    assert.equal(first.created, true);
    assert.equal(second.created, false, 'second import is a no-op');
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM tasks WHERE id='ado-999'").get().n,
      1,
      'no duplicate row'
    );
  });
});

test('a re-sync can backfill fields onto an existing task', async () => {
  await withDb(({ load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    tasks.importTask({ id: 'ado-1', title: 'Old title' });
    tasks.updateFields('ado-1', { title: 'New title', sourceRef: '1', sourceUrl: 'https://x/1' });

    const t = tasks.getTask('ado-1');
    assert.equal(t.title, 'New title');
    assert.equal(t.source_ref, '1', 'ticket number backfilled');
    assert.equal(t.source_url, 'https://x/1', 'link backfilled');
  });
});

test('deleting a project unassigns its work rather than deleting it', async () => {
  // The destructive-confirm copy promises exactly this. If the FK were ever
  // changed to CASCADE, that promise would silently become a lie.
  await withDb(({ load }) => {
    const projects = load('server/repo/projectsRepo.js');
    const tasks = load('server/repo/tasksRepo.js');
    const notes = load('server/repo/notesRepo.js');
    const inbox = load('server/repo/inboxRepo.js');

    const pid = projects.createProject({ name: 'Doomed' });
    const tid = tasks.createTask({ title: 'T', projectId: pid });
    const nid = notes.createNote({ title: 'N', projectId: pid });
    const iid = inbox.createInboxItem({ title: 'I', projectId: pid });

    projects.deleteProject(pid);

    assert.equal(projects.getProject(pid), null, 'project gone');
    assert.ok(tasks.getTask(tid), 'task survived');
    assert.ok(notes.getNote(nid), 'note survived');
    assert.ok(inbox.getInboxItem(iid), 'inbox item survived');
    assert.equal(tasks.getTask(tid).project_id, null, 'task unassigned');
  });
});

test('project status is open or closed, and closed still lists', async () => {
  // Closing says the work is finished; archiving is what hides it. A closed
  // project disappearing from the list would conflate the two.
  await withDb(({ load }) => {
    const projects = load('server/repo/projectsRepo.js');
    const id = projects.createProject({ name: 'P' });
    assert.equal(projects.getProject(id).status, 'open', 'defaults to open');

    projects.updateProject(id, { status: 'closed' });
    assert.equal(projects.getProject(id).status, 'closed');
    assert.ok(
      projects.listProjects().some((p) => p.id === id),
      'closed projects still appear in the default listing'
    );

    assert.throws(() => projects.updateProject(id, { status: 'nonsense' }), 'invalid status rejected');
  });
});

test('project contents gathers every related entity type', async () => {
  await withDb(({ load }) => {
    const projects = load('server/repo/projectsRepo.js');
    const pid = projects.createProject({ name: 'P' });
    load('server/repo/tasksRepo.js').createTask({ title: 'T', projectId: pid });
    load('server/repo/notesRepo.js').createNote({ title: 'N', projectId: pid });
    load('server/repo/inboxRepo.js').createInboxItem({ title: 'I', projectId: pid });
    load('server/repo/journalRepo.js').createEntry({ bodyMd: 'J', projectId: pid });

    const contents = projects.projectContents(pid);
    assert.equal(contents.tasks.length, 1);
    assert.equal(contents.notes.length, 1);
    assert.equal(contents.inbox.length, 1);
    assert.equal(contents.journal.length, 1, 'journal entries can belong to a project');
  });
});

test('deleting a project removes its contacts', async () => {
  // project_contacts DOES have a real FK, so this one is enforced by SQLite —
  // worth asserting so a future table rebuild can't silently drop the cascade.
  await withDb(({ db, load }) => {
    const projects = load('server/repo/projectsRepo.js');
    const pid = projects.createProject({ name: 'P' });
    projects.addContact(pid, { name: 'Someone', role: 'PM' });
    assert.equal(projects.listContacts(pid).length, 1);

    projects.deleteProject(pid);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM project_contacts').get().n, 0, 'contacts cascaded');
  });
});

test('tags are shared across entity types without collision', async () => {
  await withDb(({ db, load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    const notes = load('server/repo/notesRepo.js');
    const tid = tasks.createTask({ title: 'T', tags: ['shared'] });
    const nid = notes.createNote({ title: 'N', tags: ['shared'] });

    assert.deepEqual(tasks.getTask(tid).tags, ['shared']);
    assert.deepEqual(notes.getNote(nid).tags, ['shared']);

    // One tag row, two links — not two tag rows.
    const n = db.prepare("SELECT COUNT(*) n FROM tags WHERE name='shared'").get().n;
    assert.equal(n, 1, 'tag not duplicated per entity type');
    const links = db.prepare('SELECT COUNT(*) n FROM entity_tags').get().n;
    assert.equal(links, 2, 'two links to the one tag');
  });
});

test('reassigning a task closes it without crediting it as a completion', async () => {
  // Handing work to a colleague is terminal for you, so it must leave the
  // actionable count — but Metrics derives throughput from `task_completed`,
  // and counting someone else's work as yours is exactly the invented number
  // this app exists to prevent.
  await withDb(({ db, load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    const id = tasks.createTask({ title: 'Handed off' });

    const after = tasks.reassignTask(id, { to: 'Tyler Knight', note: 'conflicts with his ticket' });
    assert.equal(after.status, 'done', 'terminal — out of the actionable list');

    const events = db
      .prepare('SELECT event_type, detail_json FROM activity_log WHERE entity_id = ?')
      .all(id)
      .map((r) => ({ type: r.event_type, detail: JSON.parse(r.detail_json) }));

    assert.ok(
      events.some((e) => e.type === 'task_reassigned' && e.detail.to === 'Tyler Knight'),
      'logged as a reassignment, naming the recipient'
    );
    assert.equal(
      events.filter((e) => e.type === 'task_completed').length,
      0,
      'NOT logged as a completion — Metrics must not credit it'
    );
  });
});

test('reassigning requires a recipient', async () => {
  // "Reassigned" with nobody to reassign it to is a deletion wearing a nicer
  // word, and would leave an unexplained closed task.
  await withDb(({ load }) => {
    const tasks = load('server/repo/tasksRepo.js');
    const id = tasks.createTask({ title: 'T' });
    assert.throws(() => tasks.reassignTask(id, {}), /recipient/);
    assert.throws(() => tasks.reassignTask(id, { to: '  ' }), /recipient/);
  });
});
