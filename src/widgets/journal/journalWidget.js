import { marked } from 'marked';
import { h, fmtDateTime } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import { listEntries, createEntry, updateEntry, deleteEntry, entryCount } from '../../api/journalRepo.js';
import { confirmDestructive } from '../../app/modal.js';

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

  function card(entry) {
    const cardEl = h('div', { class: 'pip-card' });
    cardEl.append(
      h('div', { class: 'pip-card-top' }, [h('div', { class: 'pip-card-meta' }, fmtDateTime(entry.created_at))]),
      h('div', { class: 'pip-card-body', html: marked.parse(entry.body_md || '') }),
      h('div', { class: 'pip-card-actions' }, [
        h('button', { class: 'pip-action-btn', onClick: () => openComposeSheet(entry) }, 'EDIT'),
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--ghost',
            onClick: async () => {
              const ok = await confirmDestructive({
                title: 'Delete this journal entry?',
                what: fmtDateTime(entry.created_at),
                consequence:
                  'Journal entries are your own written record — this one is gone permanently and cannot be recovered.',
                confirmLabel: 'DELETE ENTRY'
              });
              if (!ok) return;
              await collapseOut(cardEl);
              await deleteEntry(entry.id);
            }
          },
          'DELETE'
        )
      ])
    );
    return cardEl;
  }

  async function renderList() {
    const items = await listEntries(filters);
    listContainer.innerHTML = '';
    if (!items.length) {
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [icon('book', { size: 24, className: 'pip-empty-glyph' }), h('div', {}, 'Nothing recorded yet.')])
      );
      return;
    }
    const list = h('div', { class: 'pip-card-list' }, items.map(card));
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
