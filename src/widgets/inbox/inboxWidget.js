import { marked } from 'marked';
import { h, fmtDate } from '../../lib/dom.js';
import { staggerIn, collapseOut, pulse } from '../../lib/animations.js';
import { onChange } from '../../db/client.js';
import {
  listInboxItems,
  createInboxItem,
  setStage,
  resolveWithOutcome,
  linkResolvedTask,
  archiveItem,
  stageCounts,
  allTagNames
} from '../../db/repo/inboxRepo.js';
import { createTask } from '../../db/repo/tasksRepo.js';
import { pickAndImportDrops } from './markdownImport.js';

export const kind = 'inbox';

marked.setOptions({ breaks: true });

export function renderTile(ctx) {
  const counts = stageCounts();
  const badge = counts.new > 0 ? h('div', { class: 'pip-tile-badge' }, String(counts.new)) : null;
  return h(
    'button',
    { class: 'pip-tile', dataset: { widget: 'inbox' }, onClick: (e) => ctx.open('inbox', e.currentTarget) },
    [
      badge,
      h('div', { class: 'pip-tile-icon' }, '📥'),
      h('div', { class: 'pip-tile-sub' }, counts.active ? `${counts.active} in progress` : 'nothing pending'),
      h('div', { class: 'pip-tile-label' }, 'INBOX')
    ]
  );
}

const STAGE_LABEL = { new: 'NEW', active: 'ACTIVE', resolved: 'RESOLVED', archived: 'ARCHIVED' };

export function renderFull(ctx) {
  const filters = { stage: null, tag: null, search: '', sort: 'created_desc' };

  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, '‹ HOME'),
    h('div', { class: 'pip-view-title' }, 'INBOX'),
  ]);

  const importBtn = h(
    'button',
    {
      class: 'pip-action-btn',
      style: 'margin-left:auto',
      onClick: async () => {
        importBtn.textContent = '...';
        const result = await pickAndImportDrops();
        importBtn.textContent = 'IMPORT';
        if (result) {
          toast(el, `+${result.created} new · ${result.skipped} already had`);
        }
      }
    },
    'IMPORT'
  );
  header.appendChild(importBtn);

  const body = h('div', { class: 'pip-view-body' });
  const listContainer = h('div');
  el.append(header, body);

  function toast(root, text) {
    const t = h('div', { class: 'pip-tile-sub', style: 'text-align:center;margin:4px 0;' }, text);
    root.insertBefore(t, root.firstChild.nextSibling);
    setTimeout(() => t.remove(), 2200);
  }

  function buildToolbar() {
    const stageSelect = h(
      'select',
      {
        class: 'pip-chip-select',
        onChange: (e) => {
          filters.stage = e.target.value || null;
          renderList();
        }
      },
      [
        h('option', { value: '' }, 'All stages'),
        ...['new', 'active', 'resolved', 'archived'].map((s) => h('option', { value: s }, STAGE_LABEL[s]))
      ]
    );

    const tags = allTagNames();
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
          renderList();
        }
      },
      [
        h('option', { value: 'created_desc' }, 'Newest'),
        h('option', { value: 'created_asc' }, 'Oldest'),
        h('option', { value: 'stage_changed_desc' }, 'Recently touched'),
        h('option', { value: 'title_asc' }, 'Title A–Z')
      ]
    );

    const search = h('input', {
      class: 'pip-search',
      type: 'search',
      placeholder: 'search…',
      oninput: (e) => {
        filters.search = e.target.value;
        renderList();
      }
    });
    search.value = filters.search;
    stageSelect.value = filters.stage || '';
    tagSelect.value = filters.tag || '';
    sortSelect.value = filters.sort;

    return h('div', { class: 'pip-toolbar' }, [stageSelect, tagSelect, sortSelect, search]);
  }

  function openOutcomeSheet(item) {
    let makeTask = false;
    const outcomeInput = h('textarea', { rows: '4', placeholder: 'What happened / what did you decide?' });
    const taskTitleInput = h('input', {
      type: 'text',
      placeholder: 'Task title',
      value: item.title,
      style: 'display:none'
    });
    const taskCheckbox = h('input', { type: 'checkbox', id: 'mk-task' });
    taskCheckbox.addEventListener('change', () => {
      makeTask = taskCheckbox.checked;
      taskTitleInput.style.display = makeTask ? 'block' : 'none';
    });

    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, 'RESOLVE'),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Outcome'), outcomeInput]),
        h('div', { class: 'pip-field', style: 'flex-direction:row;align-items:center;gap:6px;' }, [
          taskCheckbox,
          h('label', { for: 'mk-task', style: 'margin:0' }, 'Turn into a task')
        ]),
        h('div', { class: 'pip-field' }, [taskTitleInput]),
        h('div', { class: 'pip-sheet-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() }, 'CANCEL'),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--primary',
              onClick: () => {
                resolveWithOutcome(item.id, outcomeInput.value.trim());
                if (makeTask && taskTitleInput.value.trim()) {
                  const taskId = createTask({
                    title: taskTitleInput.value.trim(),
                    notesMd: outcomeInput.value.trim(),
                    fromInboxItemId: item.id
                  });
                  linkResolvedTask(item.id, taskId);
                }
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

  function openComposeSheet() {
    const titleInput = h('input', { type: 'text', placeholder: 'Title' });
    const bodyInput = h('textarea', { rows: '5', placeholder: 'Markdown notes…' });
    const tagsInput = h('input', { type: 'text', placeholder: 'tags, comma, separated' });

    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, 'NEW NOTE'),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Title'), titleInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Body (markdown)'), bodyInput]),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Tags'), tagsInput]),
        h('div', { class: 'pip-sheet-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() }, 'CANCEL'),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--primary',
              onClick: () => {
                if (!titleInput.value.trim() && !bodyInput.value.trim()) {
                  scrim.remove();
                  return;
                }
                createInboxItem({
                  title: titleInput.value.trim() || bodyInput.value.trim().slice(0, 60),
                  bodyMd: bodyInput.value.trim(),
                  source: 'me',
                  tags: tagsInput.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
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

  function actionsFor(item, cardEl) {
    const actions = [];
    if (item.stage === 'new') {
      actions.push(
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--primary',
            onClick: () => {
              setStage(item.id, 'active');
              pulse(cardEl);
            }
          },
          'ACTIVATE'
        )
      );
      actions.push(
        h('button', { class: 'pip-action-btn', onClick: async () => { await collapseOut(cardEl); archiveItem(item.id); } }, 'ARCHIVE')
      );
    } else if (item.stage === 'active') {
      actions.push(
        h(
          'button',
          { class: 'pip-action-btn pip-action-btn--primary', onClick: () => openOutcomeSheet(item) },
          'RESOLVE'
        )
      );
      actions.push(
        h('button', { class: 'pip-action-btn', onClick: async () => { await collapseOut(cardEl); archiveItem(item.id); } }, 'ARCHIVE')
      );
    } else if (item.stage === 'resolved') {
      actions.push(
        h('button', { class: 'pip-action-btn', onClick: async () => { await collapseOut(cardEl); archiveItem(item.id); } }, 'ARCHIVE')
      );
      actions.push(
        h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => { setStage(item.id, 'active'); pulse(cardEl); } }, 'REOPEN')
      );
    } else {
      actions.push(
        h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => { setStage(item.id, 'new'); pulse(cardEl); } }, 'RESTORE')
      );
    }
    return actions;
  }

  function card(item) {
    const cardEl = h('div', { class: 'pip-card' });
    const actionsWrap = h('div', { class: 'pip-card-actions' });
    cardEl.append(
      h('div', { class: 'pip-card-top' }, [
        h('div', { class: 'pip-card-title' }, item.title || '(untitled)'),
        h('div', { class: 'pip-stage', dataset: { stage: item.stage } }, STAGE_LABEL[item.stage])
      ]),
      h('div', { class: 'pip-card-body', html: marked.parse(item.body_md || '') }),
      item.outcome_md
        ? h('div', { class: 'pip-card-body', html: `<em>Outcome:</em> ${marked.parseInline(item.outcome_md)}` })
        : null,
      item.tags.length
        ? h('div', { class: 'pip-tag-row' }, item.tags.map((t) => h('span', { class: 'pip-tag' }, `#${t}`)))
        : null,
      h('div', { class: 'pip-card-meta' }, `${item.source === 'claude' ? 'from Claude · ' : ''}${fmtDate(item.created_at)}`),
      actionsWrap
    );
    actionsWrap.append(...actionsFor(item, cardEl));
    return cardEl;
  }

  function renderList() {
    listContainer.innerHTML = '';
    const items = listInboxItems(filters);
    if (!items.length) {
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [
          h('div', { class: 'pip-empty-glyph' }, '🗒️'),
          h('div', {}, 'Inbox is empty.')
        ])
      );
      return;
    }
    const list = h('div', { class: 'pip-card-list' }, items.map(card));
    listContainer.appendChild(list);
    staggerIn(list.children);
  }

  const fab = h('button', { class: 'pip-fab', title: 'Quick add', onClick: openComposeSheet }, '+');
  el.appendChild(fab);

  // Toolbar (selects + search) is built once so typing in the search box
  // never loses focus — only the card list below it re-renders on data changes.
  body.append(buildToolbar(), listContainer);
  renderList();
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
