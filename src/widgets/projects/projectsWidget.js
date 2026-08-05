import { h, showSheetError } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import { listProjects, createProject, updateProject, deleteProject } from '../../api/projectsRepo.js';
import { confirmDestructive } from '../../app/modal.js';

export const kind = 'projects';

export async function renderTile(ctx) {
  const projects = await listProjects();
  return tile({
    kind: 'projects',
    glyph: 'folderLg',
    label: 'PROJECTS',
    sub: projects.length ? `${projects.length} active` : 'no projects yet',
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
  const listContainer = h('div');
  el.append(header, body);
  body.appendChild(listContainer);

  function openComposeSheet(existing = null) {
    const nameInput = h('input', { type: 'text', placeholder: 'Project name', value: existing ? existing.name : '' });
    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, existing ? 'RENAME PROJECT' : 'NEW PROJECT'),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Name'), nameInput]),
        h('div', { class: 'pip-sheet-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() }, 'CANCEL'),
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
                  showSheetError(e.currentTarget.closest('.pip-sheet'), 'A project with that name already exists.');
                }
              }
            },
            'SAVE'
          )
        ])
      ])
    ]);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
    el.appendChild(scrim);
  }

  function card(project) {
    const cardEl = h('div', { class: 'pip-card' });
    const c = project.counts;
    cardEl.append(
      h('div', { class: 'pip-card-top' }, [
        h('div', { class: 'pip-card-title', style: 'display:flex;align-items:center;gap:6px;' }, [
          icon('folder', { size: 12 }),
          project.name
        ])
      ]),
      h('div', { class: 'pip-card-meta' }, `${c.inbox} inbox · ${c.tasks} tasks · ${c.notes} notes`),
      h('div', { class: 'pip-card-actions' }, [
        h('button', { class: 'pip-action-btn', onClick: () => openComposeSheet(project) }, 'RENAME'),
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

  async function renderList() {
    const projects = await listProjects();
    listContainer.innerHTML = '';
    if (!projects.length) {
      listContainer.appendChild(h('div', { class: 'pip-empty' }, [icon('folder', { size: 24, className: 'pip-empty-glyph' }), h('div', {}, 'No projects yet.')]));
      return;
    }
    const list = h('div', { class: 'pip-card-list' }, projects.map(card));
    listContainer.appendChild(list);
    staggerIn(list.children);
  }

  const fab = h('button', { class: 'pip-fab', title: 'New project', onClick: () => openComposeSheet() }, [icon('plus', { size: 18, color: '#fff' })]);
  el.appendChild(fab);

  renderList();
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
