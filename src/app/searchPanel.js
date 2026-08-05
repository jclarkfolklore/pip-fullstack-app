import { h, fmtDate, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { search } from '../api/searchRepo.js';
import { onChange } from '../api/client.js';

const TYPE_TO_WIDGET = { task: 'tasks', note: 'notes', inbox: 'inbox' };

const SOURCE_ICON = {
  manual: 'tag',
  chat: 'chat',
  monday: 'monday',
  ado: 'ado',
  email: 'mail',
  screenshot: 'camera'
};

// `onOpen` is the fully-composed click behavior from createSearchWidget below
// — it both navigates (with a highlight target so the destination widget
// scrolls to and flashes this exact row) and, on the mobile overlay, closes
// search first so the result is actually visible instead of hidden behind it.
function resultCard(row, onOpen) {
  const typeIcon = row.type === 'task' ? 'tasks' : row.type === 'note' ? 'note' : SOURCE_ICON[row.sourceType] || 'inbox';
  const card = h('button', { class: 'pip-search-result', onClick: onOpen }, [
    icon(typeIcon, { size: 14, className: 'pip-search-result-icon' }),
    h('div', { class: 'pip-search-result-body' }, [
      h('div', { class: 'pip-search-result-title' }, row.title),
      h('div', { class: 'pip-search-result-snippet' }, (row.snippet || '').slice(0, 90)),
      h('div', { class: 'pip-search-result-meta' }, `${row.meta || ''} · ${fmtDate(row.date)}`)
    ])
  ]);
  return card;
}

// One factory, mounted twice: once into the always-in-DOM desktop aside
// (CSS hides it below the breakpoint), once into a throwaway full-screen
// overlay opened from the bottom nav on narrow viewports.
export function createSearchWidget(ctx, { onClose = null } = {}) {
  const resultsEl = h('div', { class: 'pip-search-results' });
  const emptyState = h('div', { class: 'pip-search-empty' }, 'Type to search notes and tasks…');
  resultsEl.appendChild(emptyState);

  const input = h('input', {
    class: 'pip-search-input',
    type: 'search',
    placeholder: 'search…'
  });

  function openResult(row) {
    // On mobile this closes the overlay first — otherwise the view navigates
    // underneath while the (now stale) results stay on top, invisible change.
    // On desktop there's no onClose, so the panel just stays open as usual.
    if (onClose) onClose();
    ctx.open(TYPE_TO_WIDGET[row.type] || 'inbox', null, { highlightId: row.id });
  }

  async function runSearch() {
    const q = input.value.trim();
    resultsEl.innerHTML = '';
    if (!q) {
      resultsEl.appendChild(h('div', { class: 'pip-search-empty' }, 'Type to search notes and tasks…'));
      // Clearing back to empty is "exiting search" on the always-open desktop
      // panel (which has no close button) — release any live highlight here
      // rather than leaving it dangling until the widget's own fade finishes.
      ctx.clearHighlight();
      return;
    }
    const rows = await search(q);
    if (!rows.length) {
      resultsEl.appendChild(h('div', { class: 'pip-search-empty' }, 'No matches.'));
      return;
    }
    for (const row of rows) resultsEl.appendChild(resultCard(row, () => openResult(row)));
  }

  input.addEventListener('input', debounce(runSearch, 150));
  const unsubscribe = onChange(runSearch);

  const header = h('div', { class: 'pip-search-header' }, [
    icon('search', { size: 14 }),
    h('span', { class: 'pip-search-title' }, 'SEARCH')
  ]);
  if (onClose) {
    header.appendChild(
      h(
        'button',
        {
          class: 'pip-search-close',
          onClick: () => {
            ctx.clearHighlight();
            onClose();
          }
        },
        [icon('close', { size: 12 })]
      )
    );
  }

  const el = h('div', { class: 'pip-search-widget' }, [header, input, resultsEl]);

  return {
    el,
    focus: () => input.focus(),
    destroy: unsubscribe
  };
}

export function mountDesktopSearchPanel(container, ctx) {
  const widget = createSearchWidget(ctx);
  container.appendChild(widget.el);
  return widget;
}

export function openMobileSearchOverlay(screenEl, ctx) {
  const overlay = h('div', { class: 'pip-search-overlay' });
  const widget = createSearchWidget(ctx, {
    onClose: () => {
      widget.destroy();
      overlay.remove();
    }
  });
  overlay.appendChild(widget.el);
  screenEl.appendChild(overlay);
  widget.focus();
}
