// Detail view for a synced ticket (monday / ADO), rendered in the app's shared
// modal. Works for both tasks and inbox items — since migration v8 they carry
// the same source columns, so one renderer covers both.
//
// The point of this view is to answer "what am I actually supposed to do?"
// without leaving PIP: the upstream description and acceptance criteria, the
// ticket metadata, and a link out for anything this doesn't capture.

import { marked } from 'marked';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openModal } from './modal.js';
import { attachmentSections } from './attachmentViews.js';
import { listAttachments } from '../api/attachmentsRepo.js';

const SOURCE_ICON = {
  manual: 'tag',
  chat: 'chat',
  monday: 'monday',
  ado: 'ado',
  email: 'mail',
  screenshot: 'camera'
};

const SOURCE_NAME = { monday: 'monday.com', ado: 'Azure DevOps' };

function prose(md) {
  const el = h('div', { class: 'pip-ticket-prose' });
  el.innerHTML = marked.parse(md);
  // Anything we render from upstream opens in a new tab rather than replacing
  // the app.
  for (const a of el.querySelectorAll('a')) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  return el;
}

function section(label, node) {
  return h('div', { class: 'pip-ticket-section' }, [
    h('div', { class: 'pip-ticket-section-label' }, label),
    node
  ]);
}

function metaGrid(meta) {
  const cells = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === null || value === undefined || value === '') continue;
    cells.push(h('div', { class: 'pip-ticket-meta-key' }, key));
    cells.push(h('div', {}, Array.isArray(value) ? value.join(', ') : String(value)));
  }
  if (!cells.length) return null;
  return h('div', { class: 'pip-ticket-meta-grid' }, cells);
}

function safeParse(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

// `record` is any entity row (task, inbox item, note, journal entry).
// `extra` lets the caller add rows to the meta grid that only it knows
// (project name, local status). `entityType` enables the attachments section —
// omit it and the modal simply doesn't show one.
export function openTicketModal(record, { extra = {}, entityType = null, title = null } = {}) {
  const meta = safeParse(record.source_meta_json) || {};
  const body = [];

  if (record.source_ref) {
    const sourceLabel = SOURCE_NAME[record.source_type] || record.source_type || 'source';
    body.push(
      h(
        'a',
        { class: 'pip-ticket-ref-link', href: record.source_url || '#', target: '_blank', rel: 'noopener' },
        [
          icon(SOURCE_ICON[record.source_type] || 'tag', { size: 11 }),
          ` ${sourceLabel} ${record.source_ref} — open`
        ]
      )
    );
  }

  const grid = metaGrid({ ...meta, ...extra });
  if (grid) body.push(section('DETAILS', grid));

  if (record.details_md) {
    body.push(section('FROM THE TICKET', prose(record.details_md)));
  } else if (record.source_ref) {
    body.push(
      section(
        'FROM THE TICKET',
        h('div', { class: 'pip-ticket-empty' }, 'No description synced yet — re-run the sync to pull it in.')
      )
    );
  }

  const ownNotes = record.notes_md || record.body_md;
  if (ownNotes) body.push(section(record.source_ref ? 'YOUR NOTES' : 'CONTENT', prose(ownNotes)));

  // Attachments load after the modal opens rather than blocking it — the
  // prose is what you came for, and a slow list shouldn't hold it up.
  const attachHost = h('div', { class: 'pip-ticket-attachments' });
  body.push(attachHost);

  const modal = openModal({ title: title || record.title || 'Detail', body });

  if (entityType) {
    listAttachments(entityType, record.id)
      .then((list) => {
        if (!attachHost.isConnected || !list.length) return;
        // Clicking a thumbnail opens it full-size in its own tab; a
        // lightbox inside a modal is a second overlay for little gain.
        for (const node of attachmentSections(list, {
          onOpenImage: (a) => window.open(a.src, '_blank', 'noopener')
        })) {
          attachHost.appendChild(node);
        }
      })
      .catch((err) => console.warn('[pip] attachments failed to load:', err.message));
  }

  return modal;
}
