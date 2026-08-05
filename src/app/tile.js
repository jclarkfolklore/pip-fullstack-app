// The dashboard tile — one shell, used by every widget's renderTile().
//
// Previously each widget hand-assembled its own button, which meant eight
// near-identical copies drifting apart (some wrapped badges in a row, some
// didn't; ordering varied). Tile layout is a property of the dashboard, not
// of any one widget, so it lives here and the widgets just supply content.
//
// Layout: the glyph is a full-height column on the left, with label and
// summary stacked in their own column beside it. Badges stay pinned
// top-right, over both.
//
//   +----------------------------+
//   | ####            [3] [12]   |
//   | ####   INBOX               |
//   | ####   3 in progress       |
//   +----------------------------+

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
      list.length ? h('div', { class: 'pip-tile-badge-row' }, list) : null,
      h('div', { class: 'pip-tile-glyph' }, [icon(glyph, { size: TILE_ICON_SIZE, className: 'pip-tile-icon' })]),
      h('div', { class: 'pip-tile-text' }, [
        h('div', { class: 'pip-tile-label' }, label),
        h('div', { class: 'pip-tile-sub' }, sub)
      ])
    ].filter(Boolean)
  );
}
