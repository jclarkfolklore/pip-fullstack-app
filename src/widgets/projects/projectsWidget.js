import { h, showSheetError } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import { listProjects, createProject, updateProject, deleteProject } from '../../api/projectsRepo.js';
import { confirmDestructive } from '../../app/modal.js';
import { openProjectModal } from '../../app/projectModal.js';

export const kind = 'projects';

export async function renderTile(ctx) {
  const projects = await listProjects();
  const open = projects.filter((p) => (p.status || 'open') === 'open').length;
  const closed = projects.length - open;

  // Same lifecycle language as Inbox and Tasks: furthest along first, so
  // closed leads. An open project is live work (amber); a closed one is
  // finished (green).
  const badges = [
    closed > 0 ? h('div', { class: 'pip-tile-badge pip-tile-badge--closed' }, String(closed)) : null,
    open > 0 ? h('div', { class: 'pip-tile-badge pip-tile-badge--open' }, String(open)) : null
  ].filter(Boolean);

  return tile({
    kind: 'projects',
    glyph: 'folderLg',
    label: 'PROJECTS',
    sub: open ? `${open} open${closed ? `, ${closed} closed` : ''}` : `${closed} closed`,
    badges,
    ctx
  });
}

export function renderFull(ctx) {
  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
    h('div', { class: 'pip-view-title' }, 'PROJECTS')
  ]);
  const body = h('div', { class: 'pip-view-body' });
  const toolbarHost = h('div');
  const listContainer = h('div');
  el.append(header, body);
  body.append(toolbarHost, listContainer);

  // Loaded once per mount and filtered client-side — this is a small,
  // fully-loaded list (no pagination), so a server round-trip per keystroke
  // would just be slower for no benefit.
  let allProjects = [];
  let search = '';

  function buildToolbar() {
    const searchInput = h('input', {
      class: 'pip-search',
      type: 'search',
      placeholder: 'search projects…',
      oninput: (e) => {
        search = e.target.value;
        renderCards();
      }
    });
    toolbarHost.appendChild(h('div', { class: 'pip-toolbar' }, [searchInput]));
  }

  function openComposeSheet(existing = null) {
    const nameInput = h('input', {
      type: 'text',
      placeholder: 'Project name',
      value: existing ? existing.name : ''
    });
    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, existing ? 'RENAME PROJECT' : 'NEW PROJECT'),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Name'), nameInput]),
        h('div', { class: 'pip-sheet-actions' }, [
          h(
            'button',
            { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() },
            'CANCEL'
          ),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--primary',
              onClick: async (e) => {
                if (!nameInput.value.trim()) {
                  scrim.remove();
                  return;
                }
                try {
                  if (existing) await updateProject(existing.id, { name: nameInput.value.trim() });
                  else await createProject({ name: nameInput.value.trim() });
                  scrim.remove();
                  renderList();
                } catch (err) {
                  showSheetError(
                    e.currentTarget.closest('.pip-sheet'),
                    'A project with that name already exists.'
                  );
                }
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

  function card(project) {
    const cardEl = h('div', {
      class: 'pip-content-card pip-project-card is-clickable',
      dataset: { status: project.status || 'open' }
    });
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      openProjectModal(project, { onChanged: renderList });
    });
    const c = project.counts;
    cardEl.append(
      h('div', { class: 'pip-content-card-title pip-project-card-title' }, [
        icon('folder', { size: 12 }),
        h('span', {}, project.name),
        h(
          'span',
          { class: 'pip-project-status', dataset: { status: project.status || 'open' } },
          (project.status || 'open').toUpperCase()
        )
      ]),
      h(
        'div',
        { class: 'pip-content-card-meta' },
        `${c.inbox} inbox · ${c.tasks} tasks · ${c.notes} notes · ${c.journal || 0} journal`
      ),
      h('div', { class: 'pip-content-card-actions' }, [
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--primary',
            onClick: () => openProjectModal(project, { onChanged: renderList })
          },
          'OPEN'
        ),
        h('button', { class: 'pip-action-btn', onClick: () => openComposeSheet(project) }, 'RENAME'),
        h(
          'button',
          {
            class: 'pip-action-btn',
            onClick: async () => {
              await updateProject(project.id, { status: project.status === 'closed' ? 'open' : 'closed' });
              renderList();
            }
          },
          project.status === 'closed' ? 'REOPEN' : 'CLOSE'
        ),
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--ghost',
            onClick: async () => {
              const attached = c.inbox + c.tasks + c.notes;
              const ok = await confirmDestructive({
                title: 'Delete this project?',
                what: project.name,
                consequence: attached
                  ? `Its ${c.inbox} inbox · ${c.tasks} tasks · ${c.notes} notes are NOT deleted — they stay in PIP and become unassigned. Only the project grouping goes away.`
                  : 'Nothing is assigned to this project, so only the empty project is removed.',
                confirmLabel: 'DELETE PROJECT'
              });
              if (!ok) return;
              await collapseOut(cardEl);
              await deleteProject(project.id);
            }
          },
          'DELETE'
        )
      ])
    );
    return cardEl;
  }

  function renderCards() {
    const q = search.trim().toLowerCase();
    const projects = q ? allProjects.filter((p) => p.name.toLowerCase().includes(q)) : allProjects;

    listContainer.innerHTML = '';
    if (!allProjects.length) {
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [
          icon('folder', { size: 24, className: 'pip-empty-glyph' }),
          h('div', {}, 'No projects yet.')
        ])
      );
      return;
    }
    if (!projects.length) {
      listContainer.appendChild(h('div', { class: 'pip-empty' }, [h('div', {}, 'No projects match.')]));
      return;
    }
    const grid = h('div', { class: 'pip-content-grid pip-project-grid' }, projects.map(card));
    listContainer.appendChild(grid);
    staggerIn(grid.children);
  }

  async function renderList() {
    allProjects = await listProjects();
    renderCards();
  }

  const fab = h('button', { class: 'pip-fab', title: 'New project', onClick: () => openComposeSheet() }, [
    icon('plus', { size: 18, color: '#fff' })
  ]);
  el.appendChild(fab);

  buildToolbar();
  renderList();
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
