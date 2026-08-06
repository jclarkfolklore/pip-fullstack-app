#!/usr/bin/env node
// Verifies that touch scrolling actually works in every view on mobile.
//
// Exists because a CSS change to html/body overflow silently broke nested
// touch scrolling once — and nothing caught it, because the scroll container
// still looked correct in the DOM. Checking computed styles or setting
// scrollTop by hand both PASS while real dragging does nothing.
//
// So this drives genuine touch events through the Chrome DevTools Protocol
// (Input.dispatchTouchEvent), which is what actually moves a native scroller.
// Synthetic TouchEvents from page JS do not.
//
// Requires the server running. Usage: node scripts/pip-touch-test.js

const { chromium } = require('playwright-core');

const BASE = process.env.PIP_BASE || 'http://127.0.0.1:4288';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWS = [
  'dashboard',
  'inbox',
  'tasks',
  'notes',
  'journal',
  'projects',
  'metrics',
  'overview',
  'settings'
];

async function touchDrag(cdp, x, fromY, toY) {
  const step = fromY > toY ? -12 : 12;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: fromY }]
  });
  for (let y = fromY; step < 0 ? y > toY : y < toY; y += step) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  let failures = 0;

  for (const view of VIEWS) {
    await page.goto(`${BASE}/?t=${Date.now()}#/${view}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // Find whatever is actually scrollable inside the screen, rather than
    // assuming a class — different views use different containers.
    const target = await page.evaluate(() => {
      const app = document.querySelector('.pip-app');
      if (!app) return null;
      const candidates = [app, ...app.querySelectorAll('*')].filter((el) => {
        const cs = getComputedStyle(el);
        return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8;
      });
      if (!candidates.length) return null;
      const el = candidates[0];
      el.dataset.touchTest = '1';
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height)
      };
    });

    if (!target) {
      console.log(`  ${view.padEnd(10)} —  nothing to scroll (content fits)`);
      continue;
    }

    const before = await page.evaluate(() => document.querySelector('[data-touch-test]').scrollTop);
    const x = target.left + Math.round(target.w / 2);
    await touchDrag(cdp, x, target.top + Math.round(target.h * 0.8), target.top + Math.round(target.h * 0.2));
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => document.querySelector('[data-touch-test]').scrollTop);

    const moved = after > before;
    if (!moved) failures += 1;
    console.log(`  ${view.padEnd(10)} ${moved ? 'OK ' : 'FAIL'} scrollTop ${before} -> ${after}`);
  }

  // The search overlay is its own scroller, opened from the bottom nav.
  await page.goto(`${BASE}/?t=${Date.now()}#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const searchBtn = page.locator('.pip-btn--search');
  if (await searchBtn.count()) {
    await searchBtn.tap();
    await page.waitForTimeout(500);
    await page.locator('.pip-search-overlay .pip-search-input').fill('a');
    await page.waitForTimeout(900);
    const res = await page.evaluate(() => {
      const el = document.querySelector('.pip-search-overlay .pip-search-results');
      if (!el) return null;
      el.dataset.touchTest = '1';
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
        scrollable: el.scrollHeight > el.clientHeight + 8
      };
    });
    if (res && res.scrollable) {
      const before = await page.evaluate(() => document.querySelector('[data-touch-test]').scrollTop);
      await touchDrag(
        cdp,
        res.left + Math.round(res.w / 2),
        res.top + Math.round(res.h * 0.8),
        res.top + Math.round(res.h * 0.2)
      );
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => document.querySelector('[data-touch-test]').scrollTop);
      const moved = after > before;
      if (!moved) failures += 1;
      console.log(`  ${'search'.padEnd(10)} ${moved ? 'OK ' : 'FAIL'} scrollTop ${before} -> ${after}`);
    } else {
      console.log(`  ${'search'.padEnd(10)} —  nothing to scroll`);
    }
  }

  await browser.close();
  console.log(failures ? `\n${failures} view(s) FAILED` : '\nall views scroll on touch');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
