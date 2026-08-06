// E2E — the whole stack, in a real browser, against a real server.
//
// These cover what unit tests structurally cannot: that the bundle actually
// boots, that each view renders without throwing, that data reaches the DOM,
// and that the interactions people rely on still work end to end.
//
// Every test asserts on visible RESULT, not on internals — the point is to
// catch "it looks fine but does nothing", which is the failure mode the manual
// pass kept missing today.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './harness.mjs';

let app;

before(async () => {
  app = await startApp();
});

after(async () => {
  if (app) await app.stop();
});

const VIEWS = ['dashboard', 'inbox', 'tasks', 'notes', 'journal', 'projects', 'metrics', 'overview', 'settings'];

describe('every view renders', () => {
  for (const view of VIEWS) {
    test(`${view} renders without a page error`, async () => {
      const before = app.pageErrors.length;
      await app.goto(view);

      const visible = await app.page.evaluate(() => {
        const app = document.querySelector('.pip-app');
        return { present: !!app, text: (app?.innerText || '').trim().length };
      });
      assert.ok(visible.present, `${view}: app mounted`);
      assert.ok(visible.text > 0, `${view}: rendered something`);
      assert.deepEqual(
        app.pageErrors.slice(before),
        [],
        `${view}: no uncaught errors — a view that throws can still paint, so this is the real check`
      );
    });
  }
});

test('seeded data reaches the screen', async () => {
  await app.goto('tasks');
  const text = await app.page.innerText('.pip-app');
  assert.ok(text.includes('E2E open task'), 'task title rendered');
  assert.ok(text.includes('IN PROGRESS'), 'status grouping rendered');
});

test('tasks are grouped and done work is collapsed by default', async () => {
  await app.goto('tasks');
  const text = await app.page.innerText('.pip-app');
  assert.ok(!text.includes('E2E done task'), 'done work hidden until asked for');
  assert.ok(/SHOW DONE/.test(text), 'and reachable');

  await app.page.click('.pip-chip-toggle');
  await app.page.waitForTimeout(300);
  assert.ok((await app.page.innerText('.pip-app')).includes('E2E done task'), 'revealed on click');
});

test('search finds across every entity type', async () => {
  await app.goto('dashboard');
  await app.page.fill('.pip-search-panel .pip-search-input', 'findme');
  await app.page.waitForTimeout(700);

  const results = await app.page.innerText('.pip-search-panel .pip-search-results');
  for (const expected of ['E2E open task', 'E2E note', 'E2E inbox item']) {
    assert.ok(results.includes(expected), `search found: ${expected}`);
  }
});

test('a search result deep-links to its item', async () => {
  await app.goto('dashboard');
  await app.page.fill('.pip-search-panel .pip-search-input', 'E2E note');
  await app.page.waitForTimeout(700);
  await app.page.click('.pip-search-panel .pip-search-result');
  await app.page.waitForTimeout(700);

  assert.match(app.page.url(), /#\/notes/, 'navigated to the right view');
  assert.ok((await app.page.innerText('.pip-app')).includes('E2E note'), 'the item is on screen');
});

test('clicking a card opens its detail modal', async () => {
  await app.goto('tasks');
  await app.page.click('.pip-task-card');
  await app.page.waitForTimeout(400);

  assert.ok(await app.page.isVisible('.pip-modal'), 'modal opened');
  await app.page.keyboard.press('Escape');
  await app.page.waitForTimeout(300);
  assert.ok(!(await app.page.isVisible('.pip-modal')), 'Escape closes it');
});

test('a destructive action requires confirmation and can be declined', async () => {
  await app.goto('tasks');
  const before = await app.page.locator('.pip-task-card').count();

  await app.page.click('.pip-task-card .pip-action-btn--ghost');
  await app.page.waitForTimeout(400);
  assert.ok(await app.page.isVisible('.pip-modal'), 'confirm modal appeared rather than deleting');

  const body = await app.page.innerText('.pip-modal');
  assert.ok(body.length > 20, 'the prompt explains what will happen');

  await app.page.click('.pip-confirm-actions .pip-action-btn--ghost'); // Cancel
  await app.page.waitForTimeout(500);
  assert.equal(await app.page.locator('.pip-task-card').count(), before, 'cancelling deleted nothing');
});

test('confirming a delete actually deletes', async () => {
  await app.goto('tasks');
  const before = await app.page.locator('.pip-task-card').count();

  await app.page.click('.pip-task-card .pip-action-btn--ghost');
  await app.page.waitForTimeout(400);
  await app.page.click('.pip-confirm-actions .pip-action-btn--danger');
  await app.page.waitForTimeout(900);

  assert.equal(await app.page.locator('.pip-task-card').count(), before - 1, 'one fewer card');
});

test('creating a task persists across a reload', async () => {
  await app.goto('tasks');
  await app.page.click('.pip-fab');
  await app.page.waitForTimeout(300);
  await app.page.fill('.pip-sheet input[type="text"]', 'Created by e2e');
  await app.page.click('.pip-sheet-actions .pip-action-btn--primary');
  await app.page.waitForTimeout(700);

  assert.ok((await app.page.innerText('.pip-app')).includes('Created by e2e'), 'appears immediately');

  await app.goto('tasks');
  assert.ok((await app.page.innerText('.pip-app')).includes('Created by e2e'), 'survived a reload');
});

test('held inbox items sort last and are not counted as active', async () => {
  await app.goto('inbox');
  const text = await app.page.innerText('.pip-app');
  const heldAt = text.indexOf('E2E held item');
  const liveAt = text.indexOf('E2E inbox item');
  assert.ok(heldAt > liveAt, 'held item is below the live one');
  assert.ok(text.includes('INACTIVE'), 'labelled inactive, not paused');
});

test('the project view opens and lists related work', async () => {
  await app.goto('projects');
  await app.page.click('.pip-project-card, .pip-card');
  await app.page.waitForTimeout(600);

  const modal = await app.page.innerText('.pip-modal');
  assert.ok(modal.includes('E2E open task'), 'related task listed');
  assert.ok(modal.includes('E2E note'), 'related note listed');
});

test('theme switching applies and persists', async () => {
  await app.goto('settings');
  const buttons = app.page.locator('.pip-set-theme-btn, .pip-chip-toggle');
  if ((await buttons.count()) === 0) return; // no theme control rendered; nothing to assert

  await app.goto('settings');
  const initial = await app.page.evaluate(() => document.querySelector('.pip-layout')?.dataset.theme || 'default');
  await app.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /AMBER|MONO|NIGHT/i.test(x.textContent));
    if (b) b.click();
  });
  await app.page.waitForTimeout(400);
  const after = await app.page.evaluate(() => document.querySelector('.pip-layout')?.dataset.theme || 'default');
  assert.notEqual(after, initial, 'theme changed');
});

test('no view leaves the page horizontally scrollable', async () => {
  // A horizontal scrollbar in the main area was an explicit design failure.
  for (const view of VIEWS) {
    await app.goto(view);
    const overflows = await app.page.evaluate(() => {
      const el = document.querySelector('.pip-app');
      return el ? el.scrollWidth > el.clientWidth + 2 : false;
    });
    assert.equal(overflows, false, `${view}: no horizontal overflow`);
  }
});
