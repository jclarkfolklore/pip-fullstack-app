import { h } from '../lib/dom.js';
import { goHome, navigateTo } from './router.js';

const THEMES = ['default', 'amber', 'mono', 'night'];

function applyTheme(name) {
  const device = document.querySelector('.pip-device');
  if (!device) return;
  if (name === 'default') delete device.dataset.theme;
  else device.dataset.theme = name;
  try {
    localStorage.setItem('pip-theme', name);
  } catch (_) {
    /* ignore — theme just won't persist across reloads */
  }
}

export function buildShell() {
  const app = h('main', { id: 'pip-app', class: 'pip-app' });
  const statusbar = h('header', { class: 'pip-statusbar' }, [
    h('div', { class: 'pip-status-title' }, [h('span', { class: 'pip-status-dot' }), 'PIP']),
    h('div', {}, 'v0.1')
  ]);
  const screenGlass = h('div', { class: 'pip-screen-glass' }, [statusbar, app]);
  const screen = h('div', { class: 'pip-screen' }, [
    screenGlass,
    h('div', { class: 'pip-scanlines' }),
    h('div', { class: 'pip-vignette' })
  ]);
  const bezel = h('div', { class: 'pip-screen-bezel' }, [screen]);

  let themeIdx = 0;
  try {
    const saved = localStorage.getItem('pip-theme');
    const idx = THEMES.indexOf(saved);
    if (idx !== -1) themeIdx = idx;
  } catch (_) {
    /* ignore */
  }
  const controls = h('nav', { class: 'pip-controls' }, [
    h('button', { class: 'pip-btn pip-btn--menu', onClick: () => goHome() }, 'MENU'),
    h('div', { class: 'pip-dpad' }, [
      h('button', { class: 'pip-btn pip-btn--dpad', onClick: () => history.back() }, '◂'),
      h('button', { class: 'pip-btn pip-btn--select', onClick: () => goHome() }, '●'),
      h('button', { class: 'pip-btn pip-btn--dpad', onClick: () => history.forward() }, '▸')
    ]),
    h('button', {
      class: 'pip-btn pip-btn--light',
      title: 'Cycle screen theme',
      onClick: () => {
        themeIdx = (themeIdx + 1) % THEMES.length;
        applyTheme(THEMES[themeIdx]);
      }
    }, '✦')
  ]);

  const shellEl = h('div', { class: 'pip-shell' }, [h('div', { class: 'pip-speaker' }), bezel, controls]);
  const device = h('div', { class: 'pip-device' }, [shellEl]);

  return { device, app, screen };
}
