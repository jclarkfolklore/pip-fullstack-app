import { marked } from 'marked';
import { h, fmtDate } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { staggerIn, collapseOut } from '../../lib/animations.js';
import { onChange } from '../../api/client.js';
import {
  listInboxItems,
  createInboxItem,
  setStage,
  resolveInboxItem,
  archiveItem,
  stageCounts,
  SOURCE_TYPES
} from '../../api/inboxRepo.js';
import { allTagNames } from '../../api/tagsRepo.js';
import { listProjects } from '../../api/projectsRepo.js';

export const kind = 'inbox';

marked.setOptions({ breaks: true });

const SOURCE_ICON = {
  manual: 'tag',
  chat: 'chat',
  monday: 'monday',
  ado: 'ado',
  email: 'mail',
  screenshot: 'camera'
};

const SOURCE_LABEL = {
  manual: 'manual',
  chat: 'chat',
  monday: 'Monday',
  ado: 'ADO',
  email: 'email',
  screenshot: 'screenshot'
};

export async function renderTile(ctx) {
  const counts = await stageCounts();
  const badge = counts.new > 0 ? h('div', { class: 'pip-tile-badge' }, String(counts.new)) : null;
  return h(
    'button',
    { class: 'pip-tile', dataset: { widget: 'inbox' }, onClick: (e) => ctx.open('inbox', e.currentTarget) },
    [
      badge,
      icon('inbox', { size: 20, className: 'pip-tile-icon' }),
      h('div', { class: 'pip-tile-sub' }, counts.active ? `${counts.active} in progress` : 'nothing pending'),
      h('div', { class: 'pip-tile-label' }, 'INBOX')
    ]
  );
}

const STAGE_LABEL = { new: 'NEW', active: 'ACTIVE', resolved: 'RESOLVED', archived: 'ARCHIVED' };

export function renderFull(ctx) {
  const filters = { stage: null, tag: null, project: null, search: '', sort: 'created_desc' };
  let projectsById = {};

  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
    h('div', { class: 'pip-view-title' }, 'INBOX')
  ]);

  const body = h('div', { class: 'pip-view-body' });
  const toolbarHost = h('div');
  const listContainer = h('div');
  el.append(header, body);

  async function buildToolbar() {
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

    const [tags, projects] = await Promise.all([allTagNames(), listProjects()]);
    projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));

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
    projectSelect.value = filters.project || '';
    sortSelect.value = filters.sort;

    toolbarHost.appendChild(h('div', { class: 'pip-toolbar' }, [stageSelect, projectSelect, tagSelect, sortSelect, search]));
  }

  function openOutcomeSheet(item) {
    const outcomeInput = h('textarea', { rows: '4', placeholder: 'What happened / what did you decide?' });
    const taskRows = h('div', { class: 'pip-task-rows' });

    function addTaskRow(value = '') {
      const input = h('input', { type: 'text', placeholder: 'Task title' });
      input.value = value;
      const row = h('div', { class: 'pip-task-row' }, [
        input,
        h('button', { class: 'pip-task-row-remove', title: 'Remove', onClick: () => row.remove() }, [icon('close', { size: 10 })])
      ]);
      taskRows.appendChild(row);
      input.focus();
    }

    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, 'RESOLVE'),
        h('div', { class: 'pip-field' }, [h('label', {}, 'Outcome'), outcomeInput]),
        h('div', { class: 'pip-field' }, [
          h('label', {}, 'Tasks to create (optional — this item can spawn any number)'),
          taskRows,
          h('button', { class: 'pip-action-btn', onClick: () => addTaskRow() }, '+ ADD TASK')
        ]),
        h('div', { class: 'pip-sheet-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: () => scrim.remove() }, 'CANCEL'),
          h(
            'button',
            {
              class: 'pip-action-btn pip-action-btn--primary',
              onClick: async () => {
                const taskTitles = [...taskRows.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
                await resolveInboxItem(item.id, { outcomeMd: outcomeInput.value.trim(), taskTitles });
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

  function openComposeSheet() {
    const titleInput = h('input', { type: 'text', placeholder: 'Title' });
    const bodyInput = h('textarea', { rows: '5', placeholder: 'Markdown notes…' });
    const tagsInput = h('input', { type: 'text', placeholder: 'tags, comma, separated' });
    const sourceTypeSelect = h(
      'select',
      { class: 'pip-chip-select' },
      SOURCE_TYPES.map((s) => h('option', { value: s }, SOURCE_LABEL[s] || s))
    );
    const sourceUrlInput = h('input', { type: 'url', placeholder: 'https:// link back to the source (optional)' });
    const projectSelect = h(
      'select',
      { class: 'pip-chip-select' },
      [h('option', { value: '' }, 'No project'), ...Object.values(projectsById).map((p) => h('option', { value: p.id }, p.name))]
    );

    const scrim = h('div', { class: 'pip-sheet-scrim' }, [
      h('div', { class: 'pip-sheet' }, [
        h('div', { class: 'pip-sheet-title' }, 'NEW ITEM'),
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
                await createInboxItem({
                  title: titleInput.value.trim() || bodyInput.value.trim().slice(0, 60),
                  bodyMd: bodyInput.value.trim(),
                  source: 'me',
                  sourceType: sourceTypeSelect.value || 'manual',
                  sourceUrl: sourceUrlInput.value.trim() || null,
                  projectId: projectSelect.value || null,
                  tags: tagsInput.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
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

  function actionsFor(item, cardEl) {
    const actions = [];
    if (item.stage === 'new') {
      actions.push(
        h(
          'button',
          {
            class: 'pip-action-btn pip-action-btn--primary',
            onClick: async () => {
              await setStage(item.id, 'active');
              renderList();
            }
          },
          'ACTIVATE'
        )
      );
      actions.push(
        h('button', { class: 'pip-action-btn', onClick: async () => { await collapseOut(cardEl); await archiveItem(item.id); } }, 'ARCHIVE')
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
        h('button', { class: 'pip-action-btn', onClick: async () => { await collapseOut(cardEl); await archiveItem(item.id); } }, 'ARCHIVE')
      );
    } else if (item.stage === 'resolved') {
      actions.push(
        h('button', { class: 'pip-action-btn', onClick: async () => { await collapseOut(cardEl); await archiveItem(item.id); } }, 'ARCHIVE')
      );
      actions.push(
        h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: async () => { await setStage(item.id, 'active'); renderList(); } }, 'REOPEN')
      );
    } else {
      actions.push(
        h('button', { class: 'pip-action-btn pip-action-btn--ghost', onClick: async () => { await setStage(item.id, 'new'); renderList(); } }, 'RESTORE')
      );
    }
    return actions;
  }

  function card(item) {
    const cardEl = h('div', { class: 'pip-card' });
    const actionsWrap = h('div', { class: 'pip-card-actions' });
    const sourceIcon = icon(SOURCE_ICON[item.source_type] || 'tag', { size: 11 });
    const project = item.project_id ? projectsById[item.project_id] : null;
    const metaParts = [
      h('span', { class: 'pip-card-meta-source' }, [sourceIcon, ` ${SOURCE_LABEL[item.source_type] || item.source_type}`]),
      project ? ` · ${project.name}` : '',
      ` · ${fmtDate(item.created_at)}`
    ];
    const metaEl = h('div', { class: 'pip-card-meta' }, metaParts);
    if (item.source_url) {
      metaEl.appendChild(
        h('a', { class: 'pip-card-source-link', href: item.source_url, target: '_blank', rel: 'noopener' }, [
          icon('link', { size: 10 }),
          ' open source'
        ])
      );
    }
    cardEl.append(
      ...[
        h('div', { class: 'pip-card-top' }, [
          h('div', { class: 'pip-card-title' }, item.title || '(untitled)'),
          h('div', { class: 'pip-stage', dataset: { stage: item.stage } }, STAGE_LABEL[item.stage])
        ]),
        h('div', { class: 'pip-card-body', html: marked.parse(item.body_md || '') }),
        item.outcome_md
          ? h('div', { class: 'pip-card-body', html: `<em>Outcome:</em> ${marked.parseInline(item.outcome_md)}` })
          : null,
        item.resolvedTasks && item.resolvedTasks.length
          ? h(
              'div',
              { class: 'pip-tag-row' },
              item.resolvedTasks.map((t) => h('span', { class: 'pip-tag' }, `→ ${t.title}`))
            )
          : null,
        item.tags.length
          ? h('div', { class: 'pip-tag-row' }, item.tags.map((t) => h('span', { class: 'pip-tag' }, `#${t}`)))
          : null,
        metaEl,
        actionsWrap
      ].filter(Boolean)
    );
    actionsWrap.append(...actionsFor(item, cardEl));
    return cardEl;
  }

  async function renderList() {
    const items = await listInboxItems(filters);
    listContainer.innerHTML = '';
    if (!items.length) {
      listContainer.appendChild(
        h('div', { class: 'pip-empty' }, [
          icon('inbox', { size: 24, className: 'pip-empty-glyph' }),
          h('div', {}, 'Inbox is empty.')
        ])
      );
      return;
    }
    const list = h('div', { class: 'pip-card-list' }, items.map(card));
    listContainer.appendChild(list);
    staggerIn(list.children);
  }

  const fab = h('button', { class: 'pip-fab', title: 'Quick add', onClick: openComposeSheet }, [icon('plus', { size: 18, color: '#fff' })]);
  el.appendChild(fab);

  // Toolbar (selects + search) is built once, asynchronously (tags/projects
  // need a fetch), so typing in the search box never loses focus — only the
  // card list below it re-renders on data changes.
  body.append(toolbarHost, listContainer);
  buildToolbar().then(renderList);
  const unsubscribe = onChange(renderList);

  return { el, destroy: unsubscribe };
}
