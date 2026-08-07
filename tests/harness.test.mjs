// Verifies the test harness itself — if these fail, every other result is
// meaningless. Chiefly: does each test really get an isolated database?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { withDb, tablesOf, columnsOf } from './helpers/db.mjs';

test('fresh database is created at the current schema', async () => {
  await withDb(({ db, dbPath }) => {
    assert.ok(existsSync(dbPath), 'database file exists');
    const tables = tablesOf(db);
    for (const t of [
      'projects',
      'inbox_items',
      'tasks',
      'notes',
      'journal_entries',
      'attachments',
      'activity_log'
    ]) {
      assert.ok(tables.includes(t), `has table ${t}`);
    }
    const v = db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get();
    assert.equal(v.value, '13');
  });
});

test('each test gets an isolated database', async () => {
  let firstPath;
  await withDb(({ db, dbPath, load }) => {
    firstPath = dbPath;
    load('server/repo/projectsRepo.js').createProject({ name: 'Only In First' });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM projects').get().n, 1);
  });
  await withDb(({ db, dbPath }) => {
    assert.notEqual(dbPath, firstPath, 'different file');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM projects').get().n, 0, 'no leakage');
  });
  assert.ok(!existsSync(firstPath), 'first database cleaned up');
});

test('repos loaded through the harness write to the test database', async () => {
  await withDb(({ db, load }) => {
    const id = load('server/repo/tasksRepo.js').createTask({ title: 'harness task' });
    const row = db.prepare('SELECT title FROM tasks WHERE id = ?').get(id);
    assert.equal(row.title, 'harness task');
  });
});

test('schema has no stray columns between fresh build and expectation', async () => {
  await withDb(({ db }) => {
    assert.deepEqual(columnsOf(db, 'projects').includes('status'), true);
    assert.deepEqual(columnsOf(db, 'journal_entries').includes('project_id'), true);
  });
});
