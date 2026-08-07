#!/usr/bin/env node
// Captures the README screenshots from the running app.
//
// Uses playwright-core against the system Chrome rather than bundling a
// browser — the point is a handful of images, not a test suite, and a 200MB
// download for that is a bad trade.
//
// Requires the server up (npm run server). Views are reached by hash route;
// modals and the sprite viewers need real clicks, which is why this drives a
// browser rather than just fetching pages.

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.env.PIP_BASE || 'http://127.0.0.1:4288';
const OUT = path.resolve(__dirname, '..', 'docs', 'screens');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

  const shot = async (name, target = page) => {
    await target.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  ${name}.png`);
  };
  // Cache-bust each load; the bundle is aggressively cached in dev.
  const go = async (hash = '') => {
    await page.goto(`${BASE}/?s=${Date.now()}${hash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  };

  await go('#/dashboard');
  await shot('dashboard');

  for (const view of ['tasks', 'notes', 'journal', 'projects', 'settings']) {
    await go(`#/${view}`);
    await shot(view);
  }

  // Project detail — the view that ties everything together.
  await go('#/projects');
  // .pip-card was the class before the cards redesign (see README's "Projects"
  // section) — it's been .pip-project-card since, and this silently matched
  // nothing and skipped the shot rather than failing loudly.
  const project = page.locator('.pip-project-card', { hasText: 'PIP' }).first();
  if (await project.count()) {
    await project.click();
    await page.waitForTimeout(1400);
    await shot('project-modal');
  }

  // Ticket detail, with description and acceptance criteria.
  await go('#/tasks');
  const task = page.locator('.pip-task-card').first();
  if (await task.count()) {
    await task.click();
    await page.waitForTimeout(1200);
    await shot('task-modal');
  }

  // Clu3's sprite viewer: poses -> combos -> live sequencer.
  await go('#/dashboard');
  await page.locator('.pip-clu3-panel .pip-clu3-sheet-btn').click();
  await page.waitForTimeout(1500);
  await shot('clu3-poses');
  const cycle = page.locator('.pip-clu3-sheet-controls .pip-chip-toggle').first();
  await cycle.click();
  await page.waitForTimeout(1200);
  await shot('clu3-combos');
  await cycle.click();
  await page.waitForTimeout(1800);
  await shot('clu3-sequencer');

  // Weather art against the codes it has to cover.
  await go('#/dashboard');
  await page.locator('.pip-wx-header .pip-clu3-sheet-btn').click();
  await page.waitForTimeout(1400);
  await shot('weather-codes');

  // The two companion panels on their own.
  await go('#/dashboard');
  await shot('clu3-panel', page.locator('.pip-clu3-panel'));
  await shot('weather-panel', page.locator('.pip-wx-panel'));

  await page.setViewportSize({ width: 390, height: 844 });
  await go('#/dashboard');
  await shot('mobile');

  await page.setViewportSize({ width: 768, height: 1024 });
  await go('#/dashboard');
  await shot('tablet');

  await browser.close();
  console.log(`\nscreens -> ${OUT}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
