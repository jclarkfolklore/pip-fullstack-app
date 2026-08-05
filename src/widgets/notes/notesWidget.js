import { marked } from 'marked';
import { h, fmtDate } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import { listNotes, createNote, updateNote, deleteNote, noteCounts, SOURCE_TYPES } from '../../api/notesRepo.js';
import { allTagNames } from '../../api/tagsRepo.js';
import { listProjects } from '../../api/projectsRepo.js';

export const kind = 'notes';

marked.setOptions({ breaks: true });

const SOURCE_ICON = { manual: 'tag', chat: 'chat', monday: 'monday', ado: 'ado', email: 'mail', screenshot: 'camera' };
const SOURCE_LABEL = { manual: 'manual', chat: 'chat', monday: 'Monday', ado: 'ADO', email: 'email', screenshot: 'screenshot' };

export async function renderTile(ctx) {
  const counts = await noteCounts();
  const badge = counts.pinned > 0 ? h('div', { class: 'pip-tile-badge' }, String(counts.pinned)) : null;
  return h('button', { class: 'pip-tile', dataset: { widget: 'notes' }, onClick: (e) => ctx.open('notes', e.currentTarget) }, [
    badge,
    icon('note', { size: 20, className: 'pip-tile-icon' }),
    h('div', { class: 'pip-tile-sub' }, counts.total ? `${counts.total} note${counts.total === 1 ? '' : 's'}` : 'nothing yet'),
    h('div', { class: 'pip-tile-label' }, 'NOTES')
  ]);
}

export function renderFull(ctx) {
  const filters = { project: null, tag: null, search: '', sort: 'updated_desc' };
  let projectsById = {};

  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
    h('div', { class: 'pip-view-title' }, 'NOTES')
  ]);
  const body = h('div', { class: 'pip-view-body' });
  const toolbarHost = h('div');
  const listContainer = h('div');
  el.append(header, body);

  async function buildToolbar() {
    const [tags, projects] = await Promise.all([allTagNames(), listProjects()]);
    projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));

    const projectSelect = h(
      'select',
      { class: 'pip-chip-select', onChange: (e) => { filters.project = e.target.value || null; renderList(); } },
      [h('option', { value: '' }, 'All projects'), ...projects.map((p) => h('option', { value: p.id }, p.name))]
    );
    const tagSelect = h(
      'select',
      { class: 'pip-chip-select', onChange: (e) => { filters.tag = e.target.value || null; renderList(); } },
      [h('option', { value: '' }, 'All tags'), ...tags.map((t) => h('option', { value: t }, `#${t}`))]
    );
    const search = h('input', {
      class: 'pip-search',
      type: 'search',
      placeholder: 'search…',
      oninput: (e) => { filters.search = e.target.value; renderList(); }
    });

    toolbarHost.appendChild(h('div', { class: 'pip-toolbar' }, [projectSelect, tagSelect, search]));
  }

  function openComposeSheet(existing = null) {
    const titleInput = h('input', { type: 'text', placeholder: 'Title', value: existing ? existing.title : '' });
    const bodyInput = h('textarea', { rows: '6', placeholder: 'Markdown…' }, existing ? existing.body_md : '');
    const tagsInput = h('input', { type: 'text', placeholder: 'tags, comma, separated', value: existing ? existing.tags.join(', ') : '' });
    const sourceTypeSelect = h('select', { class: 'pip-chip-select' }, SOURCE_TYPES.map((s) => h('option', { value: s }, SOURCE_LABEL[s] || s)));
    if (existing) sourceTypeSelect.value = existing.source_type;
    const sourceUrlInput = h('input', { type: 'url', placeholder: 'https:// link back to the source (optional)', value: existing ? existing.source_url || '' : '' });
    const projectSelect = h(
      'select',
      { class: 'pip-chip-select' },
      [h('option', { value: '' }, 'No project'), ...Object.values(projectsById).map((p) => h('option', { value: p.id }, p.name))]
    );
    if (existing && existing.project_id) projectSelect.value = existing.project_id;

    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, existing ? 'EDIT NOTE' : 'NEW NOTE'),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Title'), titleInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Body (markdown)'), bodyInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Project'), projectSelect]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Tags'), tagsInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Source'), sourceTypeSelect]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Source link'), sourceUrlInput]),
        h('div', { class: 'pip-sheet-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() }, 'CANCEL'),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--primary',
              onClick: async () => {
                if (!titleInput.value.trim() && !bodyInput.value.trim()) {
                  scrim.remove();
                  return;
                }
                const payload = {
                  title: titleInput.value.trim() || bodyInput.value.trim().slice(0, 60),
                  bodyMd: bodyInput.value.trim(),
                  sourceType: sourceTypeSelect.value || 'manual',
                  sourceUrl: sourceUrlInput.value.trim() || null,
                  projectId: projectSelect.value || null,
                  tags: tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean)
                };
                if (existing) await updateNote(existing.id, payload);
                else await createNote({ ...payload, source: 'me' });
                scrim.remove();
                renderList();
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

  function card(note) {
    const cardEl = h('div', { class: 'pip-card' });
    const project = note.project_id ? projectsById[note.project_id] : null;
    const sourceIcon = icon(SOURCE_ICON[note.source_type] || 'tag', { size: 11 });
    const metaEl = h('div', { class: 'pip-card-meta' }, [
      h('span', { class: 'pip-card-meta-source' }, [sourceIcon, ` ${SOURCE_LABEL[note.source_type] || note.source_type}`]),
      project ? ` · ${project.name}` : '',
      ` · ${fmtDate(note.updated_at)}`
    ]);
    if (note.source_url) {
      metaEl.appendChild(h('a', { class: 'pip-card-source-link', href: note.source_url, target: '_blank', rel: 'noopener' }, [icon('link', { size: 10 }), ' open source']));
    }
    cardEl.append(
      h('div', { class: 'pip-card-top' }, [
        h('div', { class: 'pip-card-title', style: 'display:flex;align-items:center;gap:6px;' }, [
          note.pinned ? icon('pin', { size: 11 }) : null,
          note.title || '(untitled)'
        ])
      ]),
      h('div', { class: 'pip-card-body', html: marked.parse(note.body_md || '') }),
      note.tags.length ? h('div', { class: 'pip-tag-row' }, note.tags.map((t) => h('span', { class: 'pip-tag' }, `#${t}`))) : null,
      metaEl,
      h('div', { class: 'pip-card-actions' }, [
        h('button', { class: 'pip-action-btn', onClick: () => openComposeSheet(note) }, 'EDIT'),
        h(
          'button',
          { class: 'pip-action-btn pip-action-btn--ghost', onClick: async () => { await updateNote(note.id, { pinned: !note.pinned }); renderList(); } },
          note.pinned ? 'UNPIN' : 'PIN'
        ),
        h(
          'button',
          { class: 'pip-action-btn pip-action-btn--ghost', onClick: async () => { await collapseOut(cardEl); await deleteNote(note.id); } },
          'DELETE'
        )
      ])
    );
    return cardEl;
  }

  async function renderList() {
    const items = await listNotes(filters);
    listContainer.innerHTML = '';
    if (!items.length) {
      listContainer.appendChild(h('div', { class: 'pip-empty' }, [icon('note', { size: 24, className: 'pip-empty-glyph' }), h('div', {}, 'No notes yet.')]));
      return;
    }
    const list = h('div', { class: 'pip-card-list' }, items.map(card));
    listContainer.appendChild(list);
    staggerIn(list.children);
  }

  const fab = h('button', { class: 'pip-fab', title: 'New note', onClick: () => openComposeSheet() }, [icon('plus', { size: 18, color: '#fff' })]);
  el.appendChild(fab);

  body.append(toolbarHost, listContainer);
  buildToolbar().then(renderList);
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
