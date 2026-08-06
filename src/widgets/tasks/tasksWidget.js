import { h, fmtDate } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import { listTasks, createTask, setTaskStatus, deleteTask, taskCounts } from '../../api/tasksRepo.js';
import { listProjects } from '../../api/projectsRepo.js';
import { openTicketModal } from '../../app/ticketModal.js';
import { confirmDestructive } from '../../app/modal.js';
import { consumeHighlight, applyHighlight } from '../../lib/highlight.js';

export const kind = 'tasks';

export async function renderTile(ctx) {
  const counts = await taskCounts();
  // Ordered by lifecycle progress, furthest along first — same rule as the
  // Inbox tile. Colours come from the shared lifecycle system in widgets.css.
  const badges = [
    counts.done > 0 ? h('div', { class: 'pip-tile-badge pip-tile-badge--done' }, String(counts.done)) : null,
    counts.doing > 0 ? h('div', { class: 'pip-tile-badge pip-tile-badge--doing' }, String(counts.doing)) : null,
    counts.open > 0 ? h('div', { class: 'pip-tile-badge pip-tile-badge--todo' }, String(counts.open)) : null
  ].filter(Boolean);

  const sub = counts.doing
    ? `${counts.doing} in progress${counts.open ? `, ${counts.open} to do` : ''}`
    : counts.open
      ? `${counts.open} to do`
      : 'nothing due';

  return tile({ kind: 'tasks', glyph: 'tasksLg', label: 'TASKS', sub, badges, ctx });
}

// Ordered the way you actually read a board: what's underway, then what's
// queued, then history. "TODO" rather than "OPEN" because open reads as a
// state, and these are explicitly the not-yet-started ones.
const GROUPS = [
  { status: 'doing', label: 'IN PROGRESS' },
  { status: 'open', label: 'TODO' },
  { status: 'done', label: 'DONE' }
];

// Work doesn't only move forward — something in progress gets put back, and
// something marked done turns out not to be. Each status offers its forward
// move first, then whatever backwards moves make sense, rather than the old
// single button that only cycled open -> doing -> done -> open.
const STATUS_MOVES = {
  open: [{ to: 'doing', label: 'START', primary: true }],
  doing: [
    { to: 'done', label: 'COMPLETE', primary: true },
    { to: 'open', label: 'TO DO' }
  ],
  done: [
    { to: 'doing', label: 'REOPEN' },
    { to: 'open', label: 'TO DO' }
  ]
};

const SOURCE_ICON = {
  manual: 'tag',
  chat: 'chat',
  monday: 'monday',
  ado: 'ado',
  email: 'mail',
  screenshot: 'camera'
};

export function renderFull(ctx) {
  // Done work is history — it's the biggest group and the least actionable, so
  // it stays collapsed until asked for.
  const filters = { project: null };
  let showDone = false;
  let projectsById = {};

  // A search-result click deep-links here for one specific task — consumed
  // once, at mount, so a later re-render (onChange) doesn't re-scroll/flash.
  let highlightId = consumeHighlight(ctx, 'tasks');
  if (highlightId) filters.project = null; // don't let a stale project filter hide it

  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
    h('div', { class: 'pip-view-title' }, 'TASKS')
  ]);
  const body = h('div', { class: 'pip-view-body' });
  const toolbarHost = h('div');
  const listContainer = h('div');
  el.append(header, body);

  const doneToggle = h('button', { class: 'pip-chip-toggle' }, 'SHOW DONE');

  async function buildToolbar() {
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

    doneToggle.addEventListener('click', () => {
      showDone = !showDone;
      doneToggle.textContent = showDone ? 'HIDE DONE' : 'SHOW DONE';
      doneToggle.dataset.on = showDone ? 'true' : 'false';
      renderList();
    });

    toolbarHost.appendChild(h('div', { class: 'pip-toolbar' }, [projectSelect, doneToggle]));
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

  // Compact card, sized for a grid. The section heading already states the
  // status, so there's no per-card status chip — notes clamp to a couple of
  // lines rather than expanding the row.
  function card(task) {
    const cardEl = h('div', { class: 'pip-task-card', dataset: { status: task.status, id: task.id } });
    const project = task.project_id ? projectsById[task.project_id] : null;
    const overdue = task.status !== 'done' && task.due_at && new Date(task.due_at) < new Date();

    const metaParts = [task.due_at ? `due ${fmtDate(task.due_at)}` : `added ${fmtDate(task.created_at)}`];
    if (project) metaParts.push(project.name);

    // Synced tickets lead with their number, linked back to the source system.
    // Clicking the ref is the fastest path from "I'll do this" to the ticket.
    const ref = task.source_ref
      ? h(
          'a',
          {
            class: 'pip-task-card-ref',
            href: task.source_url || '#',
            target: '_blank',
            rel: 'noopener',
            title: task.source_url || ''
          },
          [icon(SOURCE_ICON[task.source_type] || 'tag', { size: 10 }), ` ${task.source_ref}`]
        )
      : null;

    cardEl.append(
      ...[
        ref,
        h('div', { class: 'pip-task-card-title' }, task.title),
        task.notes_md ? h('div', { class: 'pip-task-card-notes' }, task.notes_md) : null,
        h('div', { class: `pip-task-card-meta ${overdue ? 'is-overdue' : ''}`.trim() }, metaParts.join(' · ')),
        h('div', { class: 'pip-task-card-actions' }, [
          ...(STATUS_MOVES[task.status] || []).map((move) =>
            h(
              'button',
              {
                class: 'pip-action-btn',
                // Coloured by destination — see .pip-action-btn[data-to] in
                // widgets.css.
                dataset: { to: move.to },
                title: `Move to ${move.label}`,
                onClick: async () => {
                  await setTaskStatus(task.id, move.to);
                  renderList();
                }
              },
              move.label
            )
          ),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--ghost',
              title: 'Delete',
              onClick: async () => {
                const ok = await confirmDestructive({
                  title: 'Delete this task?',
                  what: task.title,
                  consequence: task.source_ref
                    ? `This removes the task from PIP only — ${task.source_ref} stays open in the source system, and a re-sync will bring it back. Your local notes and status will be lost.`
                    : 'This permanently removes the task and its notes from PIP. It cannot be undone.',
                  confirmLabel: 'DELETE TASK'
                });
                if (!ok) return;
                await collapseOut(cardEl);
                await deleteTask(task.id);
                renderList();
              }
            },
            [icon('close', { size: 9 })]
          )
        ])
      ].filter(Boolean)
    );

    // Whole card opens the detail view; the action buttons and the ref link
    // keep their own behaviour.
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      openTicketModal(task, {
        extra: {
          status: task.status,
          project: project ? project.name : null,
          due: task.due_at ? fmtDate(task.due_at) : null
        }
      });
    });
    cardEl.classList.add('is-clickable');

    return cardEl;
  }

  async function renderList() {
    // Fetch everything and group locally — the sections need all three
    // statuses at once, and one request is cheaper than three.
    const items = await listTasks({ project: filters.project });
    listContainer.innerHTML = '';

    const byStatus = { doing: [], open: [], done: [] };
    for (const t of items) (byStatus[t.status] || byStatus.open).push(t);

    // A deep-linked task hiding in the collapsed DONE section wouldn't be
    // "the view where I can see the item" — surface the section rather than
    // leaving the user to notice and click SHOW DONE themselves.
    if (highlightId && !showDone && byStatus.done.some((t) => t.id === highlightId)) showDone = true;

    doneToggle.textContent = showDone ? 'HIDE DONE' : `SHOW DONE (${byStatus.done.length})`;

    const visible = GROUPS.filter((g) => (g.status === 'done' ? showDone : true)).filter(
      (g) => byStatus[g.status].length > 0
    );

    if (!visible.length) {
      const allDoneHidden = !showDone && byStatus.done.length > 0;
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [
          icon('tasks', { size: 24, className: 'pip-empty-glyph' }),
          h('div', {}, allDoneHidden ? 'Nothing active — all clear.' : 'No tasks here.')
        ])
      );
      return;
    }

    for (const group of visible) {
      const grid = h('div', { class: 'pip-task-grid' }, byStatus[group.status].map(card));
      listContainer.appendChild(
        h('section', { class: 'pip-task-section' }, [
          h(
            'div',
            { class: 'pip-task-section-label', dataset: { status: group.status } },
            `${group.label} · ${byStatus[group.status].length}`
          ),
          grid
        ])
      );
      staggerIn(grid.children);
    }

    if (highlightId) {
      const target = listContainer.querySelector(`[data-id="${highlightId}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        applyHighlight(target);
        highlightId = null; // one-shot — don't re-scroll on the next onChange render
      }
    }
  }

  const fab = h('button', { class: 'pip-fab', title: 'Add task', onClick: openComposeSheet }, [icon('plus', { size: 18, color: '#fff' })]);
  el.appendChild(fab);

  body.append(toolbarHost, listContainer);
  buildToolbar().then(renderList);
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
