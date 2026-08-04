import './styles/fonts.css';
import './styles/variables.css';
import './styles/base.css';
import './styles/device.css';
import './styles/widgets.css';

import { openDatabase, exportDatabase, onChange } from './db/client.js';
import { loadSnapshot, saveSnapshotDebounced } from './db/persistence.js';
import { buildShell } from './app/shell.js';
import { mountDashboard } from './app/dashboard.js';
import { navigateTo, goHome } from './app/router.js';

async function main() {
  const existing = await loadSnapshot();
  await openDatabase(existing || undefined);

  // Autosave to IndexedDB on every write, debounced so rapid edits don't
  // thrash. This is the durable day-to-day store; Export/Import .sqlite is
  // the portable backup layered on top of it.
  onChange(() => saveSnapshotDebounced(exportDatabase));

  const root = document.getElementById('pip-root');
  const { device, app } = buildShell();
  root.appendChild(device);

  try {
    const savedTheme = localStorage.getItem('pip-theme');
    if (savedTheme && savedTheme !== 'default') {
      device.dataset.theme = savedTheme;
    }
  } catch (_) {
    /* localStorage unavailable — theme just defaults each load */
  }

  const ctx = {
    pendingTileRect: null,
    open(kind, el) {
      ctx.pendingTileRect = el ? el.getBoundingClientRect() : null;
      navigateTo(kind);
    },
    goHome
  };

  mountDashboard(app, ctx);
}

main().catch((err) => {
  console.error('[pip] failed to start', err);
  const root = document.getElementById('pip-root');
  root.innerHTML =
    '<div style="color:#fff;font-family:monospace;padding:24px;text-align:center;">PIP failed to start. Check the console for details.</div>';
});
