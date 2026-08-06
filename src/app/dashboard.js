import { h } from '../lib/dom.js';
import { viewEnter, viewExit, tileToFull } from '../lib/animations.js';
import { onNavigate, currentView, navigateTo, goHome } from './router.js';
import { listWidgets } from '../api/layoutRepo.js';
import { getWidgetModule, GROUPS } from './widgetRegistry.js';
import { onChange } from '../api/client.js';
import { onThemeChange } from '../lib/theme.js';

function clockNode() {
  const time = h('div', { class: 'pip-clock-time' }, '');
  const date = h('div', { class: 'pip-clock-date' }, '');
  const wrap = h('div', { class: 'pip-clock' }, [time, date]);
  function tick() {
    const now = new Date();
    time.textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    date.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  tick();
  const iv = setInterval(tick, 15000);
  wrap._pipStop = () => clearInterval(iv);
  return wrap;
}

export function mountDashboard(container, ctx) {
  let activeModule = null; // module currently rendered full-screen
  let activeHandle = null; // { el, destroy }

  async function renderGrid() {
    const widgetRows = await listWidgets();
    const rowsWithTiles = await Promise.all(
      widgetRows.map(async (row) => {
        const mod = getWidgetModule(row.kind);
        if (!mod) return null;
        return { row, tile: await mod.renderTile(ctx) };
      })
    );
    const byGroup = new Map();
    for (const entry of rowsWithTiles) {
      if (!entry) continue;
      const key = entry.row.group_name || 'work';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(entry.tile);
    }

    const knownKeys = new Set(GROUPS.map((g) => g.key));
    const groupDefs = [...GROUPS, ...[...byGroup.keys()].filter((k) => !knownKeys.has(k)).map((k) => ({ key: k, label: k.toUpperCase() }))];

    const sections = groupDefs
      .filter((g) => byGroup.has(g.key))
      .map((g) =>
        h('section', { class: 'pip-tile-group' }, [
          h('div', { class: 'pip-tile-group-label' }, g.label),
          h('div', { class: 'pip-grid' }, byGroup.get(g.key))
        ])
      );

    // pip-home is the dashboard's own scroll container. Widget views get one
    // for free via .pip-view-body; the dashboard renders straight into
    // .pip-app, which is overflow:hidden — so without this its lower tiles
    // were simply unreachable on a short screen.
    return h('div', { class: 'pip-home' }, [clockNode(), h('div', { class: 'pip-tile-groups' }, sections)]);
  }

  function teardownActive() {
    if (activeHandle && typeof activeHandle.destroy === 'function') activeHandle.destroy();
    activeModule = null;
    activeHandle = null;
  }

  async function show(viewId, previous, tileRect) {
    const direction = viewId === 'dashboard' ? 'back' : 'forward';
    const outgoing = container.firstElementChild;
    if (outgoing) {
      await viewExit(outgoing, direction);
    }
    teardownActive();
    container.innerHTML = '';

    if (viewId === 'dashboard') {
      const node = await renderGrid();
      container.appendChild(node);
      viewEnter(node, direction);
      return;
    }

    const mod = getWidgetModule(viewId);
    if (!mod) {
      navigateTo('dashboard');
      return;
    }
    activeModule = mod;
    activeHandle = mod.renderFull(ctx);
    container.appendChild(activeHandle.el);
    if (tileRect) {
      const screenEl = container.closest('.pip-screen');
      if (screenEl) tileToFull(tileRect, screenEl);
    }
    viewEnter(activeHandle.el, direction);
  }

  async function refreshGridInPlace() {
    // Only the dashboard grid needs a manual refresh on data/theme change —
    // widget full-views subscribe to these themselves. Re-render tiles in
    // place without a transition so badge counts and the Settings tile's
    // theme label stay live.
    if (currentView() === 'dashboard' && container.firstElementChild) {
      const node = await renderGrid();
      if (currentView() === 'dashboard' && container.firstElementChild) {
        container.replaceChild(node, container.firstElementChild);
      }
    }
  }

  onNavigate((viewId, previous) => show(viewId, previous, ctx.pendingTileRect));
  onChange(refreshGridInPlace);
  onThemeChange(refreshGridInPlace);

  show(currentView(), null, null);
}
