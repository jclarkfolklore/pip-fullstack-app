import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { goHome } from './router.js';
import { mountDesktopSearchPanel, openMobileSearchOverlay } from './searchPanel.js';
import { THEMES, getTheme, setTheme } from '../lib/theme.js';

function btn(name, { accent = false, extraClass = '', onClick, title }) {
  return h(
    'button',
    { class: `pip-btn ${accent ? 'pip-btn--accent' : ''} ${extraClass}`.trim(), title, onClick },
    [icon(name, { size: 16 })]
  );
}

// Builds the console (screen + status bar + bottom controls) and returns
// references index.js needs to finish wiring up (the #pip-app mount point,
// and a place to attach the desktop search panel once ctx exists).
export function buildShell() {
  const app = h('main', { id: 'pip-app', class: 'pip-app' });
  const statusbar = h('header', { class: 'pip-statusbar' }, [
    h('div', { class: 'pip-status-title' }, [h('span', { class: 'pip-status-dot' }), 'PIP']),
    h('div', {}, 'v0.2')
  ]);
  const screenGlass = h('div', { class: 'pip-screen-glass' }, [statusbar, app]);
  const screen = h('div', { class: 'pip-screen' }, [
    screenGlass,
    h('div', { class: 'pip-scanlines' }),
    h('div', { class: 'pip-vignette' })
  ]);

  // ctx is filled in by index.js once it exists; the search button closes
  // over this mutable holder so buildShell() can be called before ctx is ready.
  const ctxHolder = { current: null };

  const controls = h('nav', { class: 'pip-controls' }, [
    btn('home', { title: 'Home', onClick: () => goHome() }),
    btn('back', { title: 'Back', onClick: () => history.back() }),
    btn('forward', { title: 'Forward', onClick: () => history.forward() }),
    btn('search', {
      extraClass: 'pip-btn--search',
      title: 'Search',
      onClick: () => {
        if (ctxHolder.current) openMobileSearchOverlay(screen, ctxHolder.current);
      }
    }),
    btn('theme', {
      title: 'Cycle screen theme',
      onClick: () => {
        const idx = THEMES.indexOf(getTheme());
        setTheme(THEMES[(idx + 1) % THEMES.length]);
      }
    })
  ]);

  const consoleEl = h('div', { class: 'pip-console' }, [screen]);
  const controlsPanel = h('div', { class: 'pip-controls-panel' }, [controls]);
  const searchPanelHost = h('aside', { class: 'pip-search-panel' });
  const sideCol = h('div', { class: 'pip-side' }, [controlsPanel, searchPanelHost]);
  const layout = h('div', { class: 'pip-layout' }, [consoleEl, sideCol]);

  // Applied directly to the local reference (not via setTheme()'s
  // document.querySelector) since `layout` isn't attached to the document
  // yet at this point — index.js appends it right after buildShell() returns.
  const initialTheme = getTheme();
  if (initialTheme !== 'default') layout.dataset.theme = initialTheme;

  return {
    layout,
    app,
    screen,
    setCtx(ctx) {
      ctxHolder.current = ctx;
      mountDesktopSearchPanel(searchPanelHost, ctx);
    }
  };
}
