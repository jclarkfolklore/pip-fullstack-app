import './styles/fonts.css';
import './styles/variables.css';
import './styles/base.css';
import './styles/device.css';
import './styles/widgets.css';

import { buildShell } from './app/shell.js';
import { mountDashboard } from './app/dashboard.js';
import { navigateTo, goHome } from './app/router.js';

async function main() {
  // No client-side database anymore — the real SQLite file lives on the
  // server (server/db.js), reached over the same-origin fetch API in
  // src/api/*. Live refresh comes from a shared SSE connection (see
  // src/api/client.js's onChange) instead of an in-process pub/sub.
  const root = document.getElementById('pip-root');
  const { layout, app, setCtx } = buildShell();
  root.appendChild(layout);

  const ctx = {
    pendingTileRect: null,
    open(kind, el) {
      ctx.pendingTileRect = el ? el.getBoundingClientRect() : null;
      navigateTo(kind);
    },
    goHome
  };

  setCtx(ctx);
  mountDashboard(app, ctx);
}

main().catch((err) => {
  console.error('[pip] failed to start', err);
  const root = document.getElementById('pip-root');
  root.innerHTML =
    '<div style="color:#fff;font-family:monospace;padding:24px;text-align:center;">PIP failed to start. Check the console for details.</div>';
});
