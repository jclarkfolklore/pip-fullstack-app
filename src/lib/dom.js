export function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
    } else {
      node.setAttribute(key, value);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const kid of kids) {
    if (kid == null) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

// A rendered table (markdown or a mammoth DOCX conversion) can be wider than
// its container — a wide Confluence export table is the case that motivated
// this. `<table>` can't scroll itself without breaking column layout, so it
// needs a wrapper with its own overflow-x, applied once after the HTML is
// injected rather than duplicated at every markdown/prose render call site.
export function wrapProseTables(container) {
  for (const table of container.querySelectorAll('table')) {
    if (table.parentElement?.classList.contains('pip-prose-table-wrap')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'pip-prose-table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  }
  return container;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(container, node) {
  clear(container);
  container.appendChild(node);
  return node;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Clock time only (e.g. "2:41 PM") — for "last updated at" readouts where the
// date is implicitly "today" and full fmtDateTime would be more than needed.
export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

// A widget's chosen sort order (or any small per-widget preference) should
// survive a reload — otherwise "pick a sort" is something you do every
// session instead of once. Falls back to `fallback` on first run, private
// browsing, or any other reason localStorage isn't available.
export function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (_) {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    /* private browsing, storage disabled, or quota — losing the preference
       is fine, breaking the widget over it is not */
  }
}

// Same idea as readPref/writePref, for a list rather than a single value —
// e.g. which projects are toggled off in a filter. A corrupted or missing
// stored value degrades to "nothing hidden" rather than breaking the widget.
export function readPrefList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function writePrefList(key, list) {
  writePref(key, JSON.stringify(list));
}

export function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Shows a small inline error line inside a compose sheet (e.g. a duplicate
// project name, or the server being briefly unreachable) instead of the
// sheet just silently closing on a failed save.
export function showSheetError(sheetEl, message) {
  let errEl = sheetEl.querySelector('.pip-sheet-error');
  if (!errEl) {
    errEl = h('div', { class: 'pip-sheet-error' });
    const actions = sheetEl.querySelector('.pip-sheet-actions');
    if (actions) sheetEl.insertBefore(errEl, actions);
    else sheetEl.appendChild(errEl);
  }
  errEl.textContent = message;
}
