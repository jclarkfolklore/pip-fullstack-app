import { h } from '../lib/dom.js';
import { viewEnter, viewExit, tileToFull } from '../lib/animations.js';
import { onNavigate, currentView, navigateTo, goHome } from './router.js';
import { listWidgets } from '../db/repo/layoutRepo.js';
import { getWidgetModule } from './widgetRegistry.js';
import { onChange, exportDatabase, openDatabase } from '../db/client.js';
import { downloadDatabaseFile, pickDatabaseFile, saveSnapshotDebounced } from '../db/persistence.js';

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

function dbBar(ctx) {
  return h('div', { class: 'pip-dbbar' }, [
    h(
      'button',
      {
        onClick: () => downloadDatabaseFile(exportDatabase())
      },
      'EXPORT .sqlite'
    ),
    h(
      'button',
      {
        onClick: async () => {
          const bytes = await pickDatabaseFile();
          if (!bytes) return;
          if (!window.confirm('Replace the current data with this .sqlite file?')) return;
          await openDatabase(bytes);
          saveSnapshotDebounced(exportDatabase);
          location.reload();
        }
      },
      'IMPORT'
    )
  ]);
}

export function mountDashboard(container, ctx) {
  let activeModule = null; // module currently rendered full-screen
  let activeHandle = null; // { el, destroy }

  function renderGrid() {
    const grid = h(
      'div',
      { class: 'pip-grid' },
      listWidgets()
        .map((row) => {
          const mod = getWidgetModule(row.kind);
          if (!mod) return null;
          return mod.renderTile(ctx);
        })
        .filter(Boolean)
    );
    return h('div', {}, [clockNode(), grid, dbBar(ctx)]);
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
      const node = renderGrid();
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

  onNavigate((viewId, previous) => show(viewId, previous, ctx.pendingTileRect));
  onChange(() => {
    // Only the dashboard grid needs a manual refresh on data change — widget
    // full-views subscribe to onChange themselves. Re-render tiles in place
    // without a transition so badge counts stay live.
    if (currentView() === 'dashboard' && container.firstElementChild) {
      const node = renderGrid();
      container.replaceChild(node, container.firstElementChild);
    }
  });

  show(currentView(), null, null);
}
