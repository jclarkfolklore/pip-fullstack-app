import { h } from '../../lib/dom.js';
import { stageCounts } from '../../db/repo/inboxRepo.js';
import { taskCounts } from '../../db/repo/tasksRepo.js';

export const kind = 'overview';

export function renderTile(ctx) {
  const inbox = stageCounts();
  const tasks = taskCounts();
  const openish = inbox.new + inbox.active + tasks.open + tasks.doing;
  return h('button', { class: 'pip-tile', dataset: { widget: 'overview' }, onClick: (e) => ctx.open('overview', e.currentTarget) }, [
    h('div', { class: 'pip-tile-icon' }, '📡'),
    h('div', { class: 'pip-tile-sub' }, openish ? `${openish} in motion` : 'all clear'),
    h('div', { class: 'pip-tile-label' }, 'STATUS')
  ]);
}

export function renderFull(ctx) {
  const inbox = stageCounts();
  const tasks = taskCounts();

  const row = (label, value) =>
    h('div', { class: 'pip-card' }, [
      h('div', { class: 'pip-card-top' }, [
        h('div', { class: 'pip-card-title' }, label),
        h('div', { class: 'pip-tile-sub' }, String(value))
      ])
    ]);

  const el = h('div', { class: 'pip-view' }, [
    h('div', { class: 'pip-view-header' }, [
      h('button', { class: 'pip-back', onClick: ctx.goHome }, '‹ HOME'),
      h('div', { class: 'pip-view-title' }, 'STATUS')
    ]),
    h('div', { class: 'pip-view-body pip-card-list' }, [
      row('Inbox — new', inbox.new),
      row('Inbox — active', inbox.active),
      row('Inbox — resolved', inbox.resolved),
      row('Tasks — open', tasks.open),
      row('Tasks — doing', tasks.doing),
      row('Tasks — done', tasks.done)
    ])
  ]);

  return { el };
}
