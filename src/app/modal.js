// App-level modal with a glassmorphic backdrop — the app's ONE modal.
//
// Everything that needs to overlay the whole page goes through here: forecast
// alerts, Clu3, synced-ticket detail, and destructive confirms. Don't add a
// second modal implementation; add a helper here instead.
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

export function openModal({ title = '', body = null, footer = null, onClose = null, size = 'default' } = {}) {
  const content = h('div', { class: 'pip-modal-body' });
  if (body) content.append(...(Array.isArray(body) ? body : [body]).filter(Boolean));

  const closeBtn = h('button', { class: 'pip-modal-close', title: 'Close' }, [icon('close', { size: 10 })]);

  const dialogClass = size === 'large' ? 'pip-modal pip-modal--lg' : 'pip-modal';
  const dialog = h('div', { class: dialogClass, role: 'dialog', 'aria-modal': 'true' }, [
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
    if (onClose) onClose();
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

// The single gate for destructive actions. Resolves true only on an explicit
// confirm click — every dismissal path (Escape, backdrop, X, Cancel) resolves
// false, so a stray click can never destroy anything.
//
// `consequence` is required on purpose: a prompt that doesn't say what's about
// to be lost isn't a safeguard, it's a speed bump. Say what goes away, and
// whether it comes back.
export function confirmDestructive({
  title = 'Are you sure?',
  what = '',
  consequence = '',
  confirmLabel = 'DELETE',
  cancelLabel = 'CANCEL'
} = {}) {
  return new Promise((resolve) => {
    let confirmed = false;

    const confirmBtn = h('button', { class: 'pip-action-btn pip-action-btn--danger' }, confirmLabel);
    const cancelBtn = h('button', { class: 'pip-action-btn pip-action-btn--ghost' }, cancelLabel);

    const { close } = openModal({
      title,
      body: [
        what ? h('div', { class: 'pip-confirm-what' }, what) : null,
        consequence ? h('div', { class: 'pip-confirm-consequence' }, consequence) : null
      ],
      footer: h('div', { class: 'pip-confirm-actions' }, [cancelBtn, confirmBtn]),
      // Fires for every close path, including the confirm button's own close.
      onClose: () => resolve(confirmed)
    });

    confirmBtn.addEventListener('click', () => {
      confirmed = true;
      close();
    });
    cancelBtn.addEventListener('click', close);

    cancelBtn.focus();
  });
}
