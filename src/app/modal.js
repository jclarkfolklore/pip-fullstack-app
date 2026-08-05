// App-level modal with a glassmorphic backdrop.
//
// Distinct from the in-screen `.pip-sheet-scrim` used by widget compose forms:
// those are scoped inside the device screen, this one is `position: fixed` and
// covers the whole page — needed because it's opened from panels that live
// outside the screen frame (the forecast, Clu3).
//
// The backdrop blurs and dims everything behind it; the dialog itself keeps the
// LCD panel treatment so it still reads as part of the device.

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let openCount = 0;

export function openModal({ title = '', body = null, footer = null } = {}) {
  const content = h('div', { class: 'pip-modal-body' });
  if (body) content.append(...(Array.isArray(body) ? body : [body]));

  const closeBtn = h('button', { class: 'pip-modal-close', title: 'Close' }, [icon('close', { size: 10 })]);

  const dialog = h('div', { class: 'pip-modal', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'pip-modal-header' }, [h('div', { class: 'pip-modal-title' }, title), closeBtn]),
    content,
    footer ? h('div', { class: 'pip-modal-footer' }, footer) : null
  ]);

  const scrim = h('div', { class: 'pip-modal-scrim' }, [dialog]);

  function close() {
    if (!scrim.isConnected) return;
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.body.classList.remove('pip-modal-open');
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(scrim);
  openCount += 1;
  document.body.classList.add('pip-modal-open');
  closeBtn.focus();

  return { el: scrim, close };
}
