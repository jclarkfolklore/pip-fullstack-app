import { h, fmtDate } from '../../lib/dom.js';
import { staggerIn, collapseOut, pulse } from '../../lib/animations.js';
import { onChange } from '../../db/client.js';
import { listTasks, createTask, setTaskStatus, deleteTask, taskCounts } from '../../db/repo/tasksRepo.js';

export const kind = 'tasks';

export function renderTile(ctx) {
  const counts = taskCounts();
  const open = counts.open + counts.doing;
  const badge = open > 0 ? h('div', { class: 'pip-tile-badge' }, String(open)) : null;
  return h('button', { class: 'pip-tile', dataset: { widget: 'tasks' }, onClick: (e) => ctx.open('tasks', e.currentTarget) }, [
    badge,
    h('div', { class: 'pip-tile-icon' }, '✅'),
    h('div', { class: 'pip-tile-sub' }, open ? `${open} open` : 'nothing due'),
    h('div', { class: 'pip-tile-label' }, 'TASKS')
  ]);
}

const STATUS_LABEL = { open: 'OPEN', doing: 'DOING', done: 'DONE' };

export function renderFull(ctx) {
  const filters = { status: null };

  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, '‹ HOME'),
    h('div', { class: 'pip-view-title' }, 'TASKS')
  ]);
  const body = h('div', { class: 'pip-view-body' });
  const listContainer = h('div');

  const statusSelect = h(
    'select',
    {
      class: 'pip-chip-select',
      style: 'margin-left:auto',
      onChange: (e) => {
        filters.status = e.target.value || null;
        renderList();
      }
    },
    [
      h('option', { value: '' }, 'All'),
      h('option', { value: 'open' }, 'Open'),
      h('option', { value: 'doing' }, 'Doing'),
      h('option', { value: 'done' }, 'Done')
    ]
  );
  header.appendChild(statusSelect);
  el.append(header, body);

  function openComposeSheet() {
    const titleInput = h('input', { type: 'text', placeholder: 'Task title' });
    const notesInput = h('textarea', { rows: '3', placeholder: 'Notes (optional, markdown)' });
    const dueInput = h('input', { type: 'date' });

    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, 'NEW TASK'),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Title'), titleInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Due'), dueInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Notes'), notesInput]),
        h('div', { class: 'pip-sheet-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() }, 'CANCEL'),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--primary',
              onClick: () => {
                if (!titleInput.value.trim()) {
                  scrim.remove();
                  return;
                }
                createTask({
                  title: titleInput.value.trim(),
                  notesMd: notesInput.value.trim(),
                  dueAt: dueInput.value || null
                });
                scrim.remove();
              }
            },
            'SAVE'
          )
        ])
      ])
    ]);
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) scrim.remove();
    });
    el.appendChild(scrim);
  }

  function card(task) {
    const cardEl = h('div', { class: 'pip-card' });
    const nextStatus = { open: 'doing', doing: 'done', done: 'open' }[task.status];
    const nextLabel = { open: 'START', doing: 'COMPLETE', done: 'REOPEN' }[task.status];

    cardEl.append(
      h('div', { class: 'pip-card-top' }, [
        h('div', { class: 'pip-card-title' }, task.title),
        h('div', { class: 'pip-stage', dataset: { stage: task.status === 'done' ? 'resolved' : task.status === 'doing' ? 'active' : 'new' } }, STATUS_LABEL[task.status])
      ]),
      task.notes_md ? h('div', { class: 'pip-card-body' }, task.notes_md) : null,
      h('div', { class: 'pip-card-meta' }, task.due_at ? `due ${fmtDate(task.due_at)}` : `added ${fmtDate(task.created_at)}`),
      h('div', { class: 'pip-card-actions' }, [
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--primary',
            onClick: () => {
              setTaskStatus(task.id, nextStatus);
              pulse(cardEl);
            }
          },
          nextLabel
        ),
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--ghost',
            onClick: async () => {
              await collapseOut(cardEl);
              deleteTask(task.id);
            }
          },
          'DELETE'
        )
      ])
    );
    return cardEl;
  }

  function renderList() {
    listContainer.innerHTML = '';
    const items = listTasks(filters);
    if (!items.length) {
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [h('div', { class: 'pip-empty-glyph' }, '✅'), h('div', {}, 'No tasks here.')])
      );
      return;
    }
    const list = h('div', { class: 'pip-card-list' }, items.map(card));
    listContainer.appendChild(list);
    staggerIn(list.children);
  }

  const fab = h('button', { class: 'pip-fab', title: 'Add task', onClick: openComposeSheet }, '+');
  el.appendChild(fab);

  body.appendChild(listContainer);
  renderList();
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
