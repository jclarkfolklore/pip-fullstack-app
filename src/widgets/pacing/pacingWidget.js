import { h } from '../../lib/dom.js';

// Stub for now — will grow into real pacing/workload signals once the core
// Inbox + Tasks loop has been lived with for a bit. Deliberately left as an
// obvious placeholder rather than faked data.

export const kind = 'pacing';

export function renderTile(ctx) {
  return h(
    'button',
    { class: 'pip-tile', dataset: { widget: 'pacing', disabled: 'true' }, onClick: (e) => ctx.open('pacing', e.currentTarget) },
    [
      h('div', { class: 'pip-tile-icon' }, '⏱'),
      h('div', { class: 'pip-tile-sub' }, 'coming soon'),
      h('div', { class: 'pip-tile-label' }, 'PACING')
    ]
  );
}

export function renderFull(ctx) {
  const el = h('div', { class: 'pip-view' }, [
    h('div', { class: 'pip-view-header' }, [
      h('button', { class: 'pip-back', onClick: ctx.goHome }, '‹ HOME'),
      h('div', { class: 'pip-view-title' }, 'PACING')
    ]),
    h('div', { class: 'pip-view-body' }, [
      h('div', { class: 'pip-stub' }, [
        h('div', { class: 'pip-stub-glyph' }, '⏱'),
        h('div', {}, 'Not built yet.'),
        h(
          'div',
          { class: 'pip-stub-note' },
          'This is where pacing/workload signals will live once we’ve lived with the Inbox + Tasks loop a while — tell Claude what "pacing" should actually mean for you and we’ll design it here.'
        )
      ])
    ])
  ]);
  return { el };
}
