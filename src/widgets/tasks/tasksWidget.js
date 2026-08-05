import { h, fmtDate } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import { listTasks, createTask, setTaskStatus, deleteTask, taskCounts } from '../../api/tasksRepo.js';
import { listProjects } from '../../api/projectsRepo.js';

export const kind = 'tasks';

export async function renderTile(ctx) {
  const counts = await taskCounts();
  const open = counts.open + counts.doing;
  const badge = open > 0 ? h('div', { class: 'pip-tile-badge' }, String(open)) : null;
  return h('button', { class: 'pip-tile', dataset: { widget: 'tasks' }, onClick: (e) => ctx.open('tasks', e.currentTarget) }, [
    badge,
    icon('tasks', { size: 20, className: 'pip-tile-icon' }),
    h('div', { class: 'pip-tile-sub' }, open ? `${open} open` : 'nothing due'),
    h('div', { class: 'pip-tile-label' }, 'TASKS')
  ]);
}

const STATUS_LABEL = { open: 'OPEN', doing: 'DOING', done: 'DONE' };

export function renderFull(ctx) {
  const filters = { status: null, project: null };
  let projectsById = {};

  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
    h('div', { class: 'pip-view-title' }, 'TASKS')
  ]);
  const body = h('div', { class: 'pip-view-body' });
  const toolbarHost = h('div');
  const listContainer = h('div');
  el.append(header, body);

  async function buildToolbar() {
    const statusSelect = h(
      'select',
      {
        class: 'pip-chip-select',
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

    const projects = await listProjects();
    projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
    const projectSelect = h(
      'select',
      {
        class: 'pip-chip-select',
        onChange: (e) => {
          filters.project = e.target.value || null;
          renderList();
        }
      },
      [h('option', { value: '' }, 'All projects'), ...projects.map((p) => h('option', { value: p.id }, p.name))]
    );

    toolbarHost.appendChild(h('div', { class: 'pip-toolbar' }, [statusSelect, projectSelect]));
  }

  function openComposeSheet() {
    const titleInput = h('input', { type: 'text', placeholder: 'Task title' });
    const notesInput = h('textarea', { rows: '3', placeholder: 'Notes (optional, markdown)' });
    const dueInput = h('input', { type: 'date' });
    const projectSelect = h(
      'select',
      { class: 'pip-chip-select' },
      [h('option', { value: '' }, 'No project'), ...Object.values(projectsById).map((p) => h('option', { value: p.id }, p.name))]
    );

    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, 'NEW TASK'),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Title'), titleInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Due'), dueInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Project'), projectSelect]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Notes'), notesInput]),
        h('div', { class: 'pip-sheet-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() }, 'CANCEL'),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--primary',
              onClick: async () => {
                if (!titleInput.value.trim()) {
                  scrim.remove();
                  return;
                }
                await createTask({
                  title: titleInput.value.trim(),
                  notesMd: notesInput.value.trim(),
                  dueAt: dueInput.value || null,
                  projectId: projectSelect.value || null
                });
                scrim.remove();
                renderList();
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
    const project = task.project_id ? projectsById[task.project_id] : null;

    cardEl.append(
      h('div', { class: 'pip-card-top' }, [
        h('div', { class: 'pip-card-title' }, task.title),
        h('div', { class: 'pip-stage', dataset: { stage: task.status === 'done' ? 'resolved' : task.status === 'doing' ? 'active' : 'new' } }, STATUS_LABEL[task.status])
      ]),
      task.notes_md ? h('div', { class: 'pip-card-body' }, task.notes_md) : null,
      h('div', { class: 'pip-card-meta' }, [
        task.due_at ? `due ${fmtDate(task.due_at)}` : `added ${fmtDate(task.created_at)}`,
        project ? ` · ${project.name}` : ''
      ]),
      h('div', { class: 'pip-card-actions' }, [
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--primary',
            onClick: async () => {
              await setTaskStatus(task.id, nextStatus);
              renderList();
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
              await deleteTask(task.id);
            }
          },
          'DELETE'
        )
      ])
    );
    return cardEl;
  }

  async function renderList() {
    const items = await listTasks(filters);
    listContainer.innerHTML = '';
    if (!items.length) {
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [icon('tasks', { size: 24, className: 'pip-empty-glyph' }), h('div', {}, 'No tasks here.')])
      );
      return;
    }
    const list = h('div', { class: 'pip-card-list' }, items.map(card));
    listContainer.appendChild(list);
    staggerIn(list.children);
  }

  const fab = h('button', { class: 'pip-fab', title: 'Add task', onClick: openComposeSheet }, [icon('plus', { size: 18, color: '#fff' })]);
  el.appendChild(fab);

  body.append(toolbarHost, listContainer);
  buildToolbar().then(renderList);
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
