// The dashboard tile — one shell, used by every widget's renderTile().
//
// Previously each widget hand-assembled its own button, which meant eight
// near-identical copies drifting apart (some wrapped badges in a row, some
// didn't; ordering varied). Tile layout is a property of the dashboard, not
// of any one widget, so it lives here and the widgets just supply content.
//
// Layout: three columns — glyph, text, badges. The badges used to be
// absolutely positioned top-right, which meant the text flowed underneath
// them and long labels collided with the counts. As a real column they
// reserve their own space and can never crowd anything.
//
//   +--------------------------------+
//   | ####   INBOX             [3]   |
//   | ####   3 in progress     [12]  |
//   | ####                           |
//   +--------------------------------+

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

// Tiles use the 16x16 icon set (see icons.js) — at this size the 8x8 glyphs
// read as blown-up 8x8 glyphs rather than as detail.
const TILE_ICON_SIZE = 40;

export function tile({ kind, glyph, label, sub, badges = [], ctx }) {
  const list = badges.filter(Boolean);
  return h(
    'button',
    { class: 'pip-tile', dataset: { widget: kind }, onClick: (e) => ctx.open(kind, e.currentTarget) },
    [
      h('div', { class: 'pip-tile-glyph' }, [
        icon(glyph, { size: TILE_ICON_SIZE, className: 'pip-tile-icon' })
      ]),
      h('div', { class: 'pip-tile-text' }, [
        h('div', { class: 'pip-tile-label' }, label),
        h('div', { class: 'pip-tile-sub' }, sub)
      ]),
      list.length ? h('div', { class: 'pip-tile-badge-row' }, list) : null
    ].filter(Boolean)
  );
}
