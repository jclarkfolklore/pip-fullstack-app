import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { onChange } from '../../api/client.js';
import { stageCounts } from '../../api/inboxRepo.js';
import { taskCounts } from '../../api/tasksRepo.js';
import { noteCounts } from '../../api/notesRepo.js';
import { listProjects } from '../../api/projectsRepo.js';

export const kind = 'overview';

export async function renderTile(ctx) {
  const [inbox, tasks] = await Promise.all([stageCounts(), taskCounts()]);
  const openish = inbox.new + inbox.active + tasks.open + tasks.doing;
  return tile({
    kind: 'overview',
    glyph: 'linkLg',
    label: 'STATUS',
    sub: openish ? `${openish} in motion` : 'all clear',
    ctx
  });
}

export function renderFull(ctx) {
  const el = h('div', { class: 'pip-view' }, [
    h('div', { class: 'pip-view-header' }, [
      h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
      h('div', { class: 'pip-view-title' }, 'STATUS')
    ])
  ]);
  const body = h('div', { class: 'pip-view-body pip-card-list' });
  el.appendChild(body);

  const row = (label, value) =>
    h('div', { class: 'pip-card' }, [
      h('div', { class: 'pip-card-top' }, [
        h('div', { class: 'pip-card-title' }, label),
        h('div', { class: 'pip-tile-sub' }, String(value))
      ])
    ]);

  async function render() {
    const [inbox, tasks, notes, projects] = await Promise.all([stageCounts(), taskCounts(), noteCounts(), listProjects()]);
    body.innerHTML = '';
    body.append(
      row('Inbox — new', inbox.new),
      row('Inbox — active', inbox.active),
      row('Inbox — resolved', inbox.resolved),
      row('Tasks — open', tasks.open),
      row('Tasks — doing', tasks.doing),
      row('Tasks — done', tasks.done),
      row('Notes', notes.total),
      row('Active projects', projects.length)
    );
  }

  render();
  const unsubscribe = onChange(render);
  return { el, destroy: unsubscribe };
}
