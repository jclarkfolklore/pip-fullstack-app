import { marked } from 'marked';
import { h, fmtDateTime } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import { listEntries, createEntry, updateEntry, deleteEntry, entryCount } from '../../api/journalRepo.js';
import { confirmDestructive } from '../../app/modal.js';
import { attachmentSections } from '../../app/attachmentViews.js';
import { listAttachmentsForMany } from '../../api/attachmentsRepo.js';

export const kind = 'journal';

marked.setOptions({ breaks: true });

export async function renderTile(ctx) {
  const { total } = await entryCount();
  return tile({
    kind: 'journal',
    glyph: 'bookLg',
    label: 'JOURNAL',
    sub: total ? `${total} entr${total === 1 ? 'y' : 'ies'}` : 'nothing recorded',
    ctx
  });
}

export function renderFull(ctx) {
  const filters = { search: '' };

  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
    h('div', { class: 'pip-view-title' }, 'JOURNAL')
  ]);
  const body = h('div', { class: 'pip-view-body' });
  const toolbarHost = h('div');
  const listContainer = h('div');
  el.append(header, body);

  function buildToolbar() {
    const search = h('input', {
      class: 'pip-search',
      type: 'search',
      placeholder: 'search entries…',
      oninput: (e) => {
        filters.search = e.target.value;
        renderList();
      }
    });
    toolbarHost.appendChild(h('div', { class: 'pip-toolbar' }, [search]));
  }

  function openComposeSheet(existing = null) {
    const bodyInput = h('textarea', { rows: '8', placeholder: 'What happened today?' }, existing ? existing.body_md : '');

    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, existing ? 'EDIT ENTRY' : 'NEW ENTRY'),
        h('div', { class: 'pip-field' }, [bodyInput]),
        h('div', { class: 'pip-sheet-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() }, 'CANCEL'),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--primary',
              onClick: async () => {
                const bodyMd = bodyInput.value.trim();
                if (!bodyMd) {
                  scrim.remove();
                  return;
                }
                if (existing) await updateEntry(existing.id, { bodyMd });
                else await createEntry({ bodyMd });
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

  // Stacked entries, not cards. A journal is read in sequence — these get
  // written as the day goes and reviewed in order — so the full text belongs
  // inline and chronology is the organising idea. Notes are the opposite
  // (disconnected blurbs you scan for one thing), which is why those ARE
  // cards with a detail modal.
  function entryEl(entry) {
    const el = h('div', { class: 'pip-journal-entry', dataset: { id: entry.id } });
    const edited = entry.updated_at !== entry.created_at;

    el.append(
      ...[
        h('div', { class: 'pip-journal-when' }, [
          h('span', { class: 'pip-journal-date' }, fmtDateTime(entry.created_at)),
          edited ? h('span', { class: 'pip-journal-edited' }, `edited ${fmtDateTime(entry.updated_at)}`) : null
        ].filter(Boolean)),
        h('div', { class: 'pip-journal-body', html: marked.parse(entry.body_md || '') }),
        (attachmentsById[entry.id] || []).length
          ? h('div', { class: 'pip-journal-att' }, attachmentSections(attachmentsById[entry.id], {
              onOpenImage: (a) => window.open(a.src, '_blank', 'noopener')
            }))
          : null,
        h('div', { class: 'pip-journal-actions' }, [
          h('button', { class: 'pip-action-btn', onClick: () => openComposeSheet(entry) }, 'EDIT'),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--ghost',
              title: 'Delete',
              onClick: async () => {
                const ok = await confirmDestructive({
                  title: 'Delete this journal entry?',
                  what: fmtDateTime(entry.created_at),
                  consequence:
                    'Journal entries are your own written record — this one is gone permanently and cannot be recovered. Any images attached to it are deleted too.',
                  confirmLabel: 'DELETE ENTRY'
                });
                if (!ok) return;
                await collapseOut(el);
                await deleteEntry(entry.id);
                renderList();
              }
            },
            [icon('close', { size: 9 })]
          )
        ])
      ].filter(Boolean)
    );
    return el;
  }

  // Attachments for the whole page in one request, keyed by entry id.
  let attachmentsById = {};

  async function renderList() {
    const items = await listEntries(filters);
    attachmentsById = await listAttachmentsForMany('journal', items.map((e) => e.id)).catch(() => ({}));
    listContainer.innerHTML = '';
    if (!items.length) {
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [icon('book', { size: 24, className: 'pip-empty-glyph' }), h('div', {}, 'Nothing recorded yet.')])
      );
      return;
    }
    const list = h('div', { class: 'pip-journal-list' }, items.map(entryEl));
    listContainer.appendChild(list);
    staggerIn(list.children);
  }

  const fab = h('button', { class: 'pip-fab', title: 'New entry', onClick: () => openComposeSheet() }, [icon('plus', { size: 18, color: '#fff' })]);
  el.appendChild(fab);

  body.append(toolbarHost, listContainer);
  buildToolbar();
  renderList();
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
