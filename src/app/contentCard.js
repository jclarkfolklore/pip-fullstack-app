// The card used by Notes and Journal — same shape as a task card.
//
// Both were full-width rows with their entire body rendered inline, which
// meant one long note pushed everything else off screen and scanning was
// impossible. A card shows a clamped preview; the full content lives in the
// detail modal, exactly as tasks work.
//
// Preview text is deliberately markdown-STRIPPED rather than rendered: at
// three lines, headings and list bullets are noise, and a half-rendered
// fragment reads worse than plain prose.

import { h } from '../lib/dom.js';
import { attachmentStrip } from './attachmentViews.js';

// Enough to be representative without doing real markdown work per card.
function toPreview(md = '') {
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// `lead` is an optional element above the title (a pin, a ticket ref).
// `actions` are buttons; clicks on them never open the detail view.
export function contentCard({
  id,
  lead = null,
  title,
  bodyMd = '',
  meta = '',
  tags = [],
  attachments = [],
  actions = [],
  dataset = {},
  onOpen = null
}) {
  const preview = toPreview(bodyMd);

  const card = h('div', { class: 'pip-content-card', dataset: { id, ...dataset } }, [
    lead,
    h('div', { class: 'pip-content-card-title' }, title),
    preview ? h('div', { class: 'pip-content-card-preview' }, preview) : null,
    attachmentStrip(attachments),
    tags.length
      ? h('div', { class: 'pip-content-card-tags' }, tags.map((t) => h('span', { class: 'pip-tag' }, `#${t}`)))
      : null,
    meta ? h('div', { class: 'pip-content-card-meta' }, meta) : null,
    actions.length ? h('div', { class: 'pip-content-card-actions' }, actions) : null
  ].filter(Boolean));

  if (onOpen) {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      onOpen();
    });
    card.classList.add('is-clickable');
  }
  return card;
}

export function contentGrid(cards) {
  return h('div', { class: 'pip-content-grid' }, cards);
}
