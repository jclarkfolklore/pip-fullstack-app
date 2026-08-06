// Rendering for attachments — the small strip that goes on a card, and the
// full gallery + link list that goes in a detail modal.
//
// Kept apart from both the card and the modal because every entity type needs
// the same treatment: an inbox item, a task, a note, a journal entry and a
// project all show images and links identically, and there's no reason for
// five copies of it.
//
// Images that couldn't be stored locally (anything behind auth, which is most
// monday and ADO attachments) arrive as links with the original URL, so they
// appear in the link list rather than as a broken thumbnail.

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

// Recognised link relationships get a label; anything else falls back to the
// raw value so an unexpected rel is still visible rather than silently blank.
const REL_LABEL = {
  design: 'DESIGN',
  testing: 'TESTING',
  spec: 'SPEC',
  source: 'SOURCE',
  reference: 'REF'
};

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return url;
  }
}

export function splitAttachments(list = []) {
  return {
    images: list.filter((a) => a.kind === 'image' && a.src),
    links: list.filter((a) => a.kind === 'link')
  };
}

// Compact strip for a card: a few thumbnails and a count of everything else.
export function attachmentStrip(list = []) {
  if (!list.length) return null;
  const { images, links } = splitAttachments(list);
  const shown = images.slice(0, 3);
  const extra = images.length - shown.length;

  const bits = shown.map((a) =>
    h('img', { class: 'pip-att-thumb', src: a.src, alt: a.title || '', loading: 'lazy' })
  );
  if (extra > 0) bits.push(h('span', { class: 'pip-att-more' }, `+${extra}`));
  if (links.length) {
    bits.push(h('span', { class: 'pip-att-links' }, [icon('link', { size: 10 }), ` ${links.length}`]));
  }
  return h('div', { class: 'pip-att-strip' }, bits);
}

// Full treatment for a modal. `onOpenImage` gets the attachment when a
// thumbnail is clicked, so the caller decides what "view larger" means.
export function attachmentSections(list = [], { onOpenImage = null } = {}) {
  const { images, links } = splitAttachments(list);
  const out = [];

  if (images.length) {
    const grid = h(
      'div',
      { class: 'pip-att-gallery' },
      images.map((a) => {
        const img = h('img', { class: 'pip-att-image', src: a.src, alt: a.title || '', loading: 'lazy' });
        if (!onOpenImage) return img;
        const btn = h('button', { class: 'pip-att-image-btn', title: a.title || 'View larger' }, [img]);
        btn.addEventListener('click', () => onOpenImage(a));
        return btn;
      })
    );
    out.push(
      h('div', { class: 'pip-ticket-section' }, [
        h('div', { class: 'pip-ticket-section-label' }, `IMAGES (${images.length})`),
        grid
      ])
    );
  }

  if (links.length) {
    out.push(
      h('div', { class: 'pip-ticket-section' }, [
        h('div', { class: 'pip-ticket-section-label' }, `LINKS (${links.length})`),
        h(
          'div',
          { class: 'pip-att-linklist' },
          links.map((a) =>
            h('a', { class: 'pip-att-link', href: a.url, target: '_blank', rel: 'noopener', title: a.url }, [
              a.rel ? h('span', { class: 'pip-att-rel' }, REL_LABEL[a.rel] || a.rel.toUpperCase()) : null,
              h('span', { class: 'pip-att-link-title' }, a.title || hostOf(a.url)),
              h('span', { class: 'pip-att-link-host' }, hostOf(a.url))
            ].filter(Boolean))
          )
        )
      ])
    );
  }

  return out;
}
