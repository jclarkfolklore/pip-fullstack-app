import { marked } from 'marked';
import { h, fmtDate, readPref, writePref } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  noteCounts,
  SOURCE_TYPES
} from '../../api/notesRepo.js';
import { allTagNames } from '../../api/tagsRepo.js';
import { listProjects } from '../../api/projectsRepo.js';
import { confirmDestructive } from '../../app/modal.js';
import { openTicketModal } from '../../app/ticketModal.js';
import { projectLink } from '../../app/projectModal.js';
import { contentCard, contentGrid } from '../../app/contentCard.js';
import { listAttachmentsForMany } from '../../api/attachmentsRepo.js';
import { consumeHighlight, applyHighlight } from '../../lib/highlight.js';

export const kind = 'notes';

marked.setOptions({ breaks: true });

const SOURCE_LABEL = {
  manual: 'manual',
  chat: 'chat',
  monday: 'Monday',
  ado: 'ADO',
  email: 'email',
  screenshot: 'screenshot'
};

export async function renderTile(ctx) {
  const counts = await noteCounts();
  // Pinned isn't a problem, so it doesn't get the red default — red is
  // reserved for overdue work and weather alerts.
  const badge =
    counts.pinned > 0
      ? h('div', { class: 'pip-tile-badge pip-tile-badge--pinned' }, String(counts.pinned))
      : null;
  return tile({
    kind: 'notes',
    glyph: 'noteLg',
    label: 'NOTES',
    sub: counts.pinned
      ? `${counts.pinned} pinned of ${counts.total}`
      : counts.total
        ? `${counts.total} note${counts.total === 1 ? '' : 's'}`
        : 'nothing yet',
    badges: [badge],
    ctx
  });
}

export function renderFull(ctx) {
  const filters = { project: null, tag: null, search: '', sort: readPref('pip:notes:sort', 'updated_desc') };
  let projectsById = {};

  // A search-result click deep-links here for one specific note — consumed
  // once, at mount, so a later re-render (onChange) doesn't re-scroll/flash.
  let highlightId = consumeHighlight(ctx, 'notes');

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
      {
        class: 'pip-chip-select',
        onChange: (e) => {
          filters.project = e.target.value || null;
          renderList();
        }
      },
      [
        h('option', { value: '' }, 'All projects'),
        ...projects.map((p) => h('option', { value: p.id }, p.name))
      ]
    );
    const tagSelect = h(
      'select',
      {
        class: 'pip-chip-select',
        onChange: (e) => {
          filters.tag = e.target.value || null;
          renderList();
        }
      },
      [h('option', { value: '' }, 'All tags'), ...tags.map((t) => h('option', { value: t }, `#${t}`))]
    );
    const sortSelect = h(
      'select',
      {
        class: 'pip-chip-select',
        onChange: (e) => {
          filters.sort = e.target.value;
          writePref('pip:notes:sort', e.target.value);
          renderList();
        }
      },
      [
        h('option', { value: 'updated_desc' }, 'Newest'),
        h('option', { value: 'created_asc' }, 'Oldest'),
        h('option', { value: 'title_asc' }, 'Title A–Z')
      ]
    );
    sortSelect.value = filters.sort;

    const search = h('input', {
      class: 'pip-search',
      type: 'search',
      placeholder: 'search…',
      oninput: (e) => {
        filters.search = e.target.value;
        renderList();
      }
    });

    toolbarHost.appendChild(
      h('div', { class: 'pip-toolbar' }, [projectSelect, tagSelect, sortSelect, search])
    );
  }

  function openComposeSheet(existing = null) {
    const titleInput = h('input', {
      type: 'text',
      placeholder: 'Title',
      value: existing ? existing.title : ''
    });
    const bodyInput = h(
      'textarea',
      { rows: '6', placeholder: 'Markdown…' },
      existing ? existing.body_md : ''
    );
    const tagsInput = h('input', {
      type: 'text',
      placeholder: 'tags, comma, separated',
      value: existing ? existing.tags.join(', ') : ''
    });
    const sourceTypeSelect = h(
      'select',
      { class: 'pip-chip-select' },
      SOURCE_TYPES.map((s) => h('option', { value: s }, SOURCE_LABEL[s] || s))
    );
    if (existing) sourceTypeSelect.value = existing.source_type;
    const sourceUrlInput = h('input', {
      type: 'url',
      placeholder: 'https:// link back to the source (optional)',
      value: existing ? existing.source_url || '' : ''
    });
    const projectSelect = h('select', { class: 'pip-chip-select' }, [
      h('option', { value: '' }, 'No project'),
      ...Object.values(projectsById).map((p) => h('option', { value: p.id }, p.name))
    ]);
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
          h(
            'button',
            { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() },
            'CANCEL'
          ),
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
                  tags: tagsInput.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
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
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) scrim.remove();
    });
    el.appendChild(scrim);
  }

  function card(note) {
    const project = note.project_id ? projectsById[note.project_id] : null;
    // A note's project is its one first-class cross-reference — worth a real
    // link rather than inert text, since "what else is in this project" is
    // exactly what you'd want after reading a note about it. `.closest('a')`
    // in contentCard's click handler keeps this from also opening the note.
    const metaBits = [
      SOURCE_LABEL[note.source_type] || note.source_type,
      project ? projectLink(project) : null,
      fmtDate(note.updated_at)
    ]
      .filter(Boolean)
      .flatMap((bit, i) => (i === 0 ? [bit] : [' · ', bit]));

    const cardEl = contentCard({
      id: note.id,
      lead: note.pinned
        ? h('div', { class: 'pip-content-card-lead' }, [icon('pin', { size: 10 }), ' PINNED'])
        : null,
      title: note.title || '(untitled)',
      bodyMd: note.body_md,
      meta: metaBits,
      tags: note.tags || [],
      attachments: attachmentsById[note.id] || [],
      // Notes have no lifecycle, so there's nothing to colour-code by state.
      // Pinned is the only distinction that exists, and it gets the same
      // accent edge treatment the other card types use.
      dataset: { pinned: note.pinned ? 'true' : 'false' },
      onOpen: () =>
        openTicketModal(note, {
          entityType: 'note',
          extra: { project: project ? projectLink(project) : null, updated: fmtDate(note.updated_at) }
        }),
      actions: [
        h('button', { class: 'pip-action-btn', onClick: () => openComposeSheet(note) }, 'EDIT'),
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--ghost',
            onClick: async () => {
              await updateNote(note.id, { pinned: !note.pinned });
              renderList();
            }
          },
          note.pinned ? 'UNPIN' : 'PIN'
        ),
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--ghost',
            title: 'Delete',
            onClick: async () => {
              const ok = await confirmDestructive({
                title: 'Delete this note?',
                what: note.title || 'Untitled note',
                consequence:
                  'Notes are reference material with no archive stage — this is permanent and cannot be undone. Any images attached to it are deleted too.',
                confirmLabel: 'DELETE NOTE'
              });
              if (!ok) return;
              await collapseOut(cardEl);
              await deleteNote(note.id);
              renderList();
            }
          },
          [icon('close', { size: 9 })]
        )
      ]
    });
    return cardEl;
  }

  // Attachments for the whole page in one request — see listForMany.
  let attachmentsById = {};

  async function renderList() {
    const items = await listNotes(filters);
    attachmentsById = await listAttachmentsForMany(
      'note',
      items.map((n) => n.id)
    ).catch(() => ({}));
    listContainer.innerHTML = '';
    if (!items.length) {
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [
          icon('note', { size: 24, className: 'pip-empty-glyph' }),
          h('div', {}, 'No notes yet.')
        ])
      );
      return;
    }
    const list = contentGrid(items.map(card));
    listContainer.appendChild(list);
    staggerIn(list.children);

    if (highlightId) {
      const target = listContainer.querySelector(`[data-id="${highlightId}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        applyHighlight(target);
        highlightId = null; // one-shot — don't re-scroll on the next onChange render
      }
    }
  }

  const fab = h('button', { class: 'pip-fab', title: 'New note', onClick: () => openComposeSheet() }, [
    icon('plus', { size: 18, color: '#fff' })
  ]);
  el.appendChild(fab);

  body.append(toolbarHost, listContainer);
  buildToolbar().then(renderList);
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
