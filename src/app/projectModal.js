// Project detail — everything about one project in a single view.
//
// The point: a project is the thing that ties work together, but until now
// clicking one did nothing. Inbox items, tasks, notes and journal entries all
// carry a project_id, so the relationships already existed — they just had
// nowhere to be seen.
//
// Deliberately reads from /projects/:id/contents rather than the search
// index. Search answers "what matches these words"; this answers "what
// belongs here", and a project whose items happen to contain no matching text
// still has its work. There's a filter box on top for narrowing once you're
// in, which is the part search is actually good at.

import { h, fmtDate, fmtDateTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openModal, confirmDestructive } from './modal.js';
import { openTicketModal } from './ticketModal.js';
import { attachmentSections } from './attachmentViews.js';
import { listAttachments } from '../api/attachmentsRepo.js';
import { projectContents, listContacts, deleteContact } from '../api/projectsRepo.js';

// entity kind -> how to title it and which glyph it gets. Journal entries have
// no title, so their date stands in.
const KINDS = [
  { key: 'inbox', label: 'INBOX', glyph: 'inbox', entityType: 'inbox', title: (r) => r.title || '(untitled)' },
  { key: 'tasks', label: 'TASKS', glyph: 'tasks', entityType: 'task', title: (r) => r.title },
  { key: 'notes', label: 'NOTES', glyph: 'note', entityType: 'note', title: (r) => r.title || '(untitled)' },
  { key: 'journal', label: 'JOURNAL', glyph: 'book', entityType: 'journal', title: (r) => fmtDateTime(r.created_at) }
];

function stateOf(row) {
  return row.stage || row.status || null;
}

// Two lines of plain text under the title. Markdown is stripped rather than
// rendered — at this size headings and bullets are noise, and the point is a
// sense of what the item is, not a faithful rendering of it.
function previewOf(row) {
  const md = row.body_md || row.notes_md || row.details_md || '';
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function contactRow(contact, onRemoved) {
  const lines = [contact.role, contact.org].filter(Boolean).join(' · ');
  const reach = [
    contact.email ? h('a', { class: 'pip-att-link-host', href: `mailto:${contact.email}` }, contact.email) : null,
    contact.handle ? h('span', { class: 'pip-att-link-host' }, contact.handle) : null
  ].filter(Boolean);

  const remove = h('button', { class: 'pip-action-btn pip-action-btn--ghost', title: 'Remove contact' }, [
    icon('close', { size: 9 })
  ]);
  remove.addEventListener('click', async () => {
    const ok = await confirmDestructive({
      title: 'Remove this contact?',
      what: contact.name,
      consequence: 'Removes them from this project only. Nothing else is affected.',
      confirmLabel: 'REMOVE'
    });
    if (!ok) return;
    await deleteContact(contact.id);
    onRemoved();
  });

  return h('div', { class: 'pip-contact' }, [
    h('div', { class: 'pip-contact-main' }, [
      h('div', { class: 'pip-contact-name' }, contact.name),
      lines ? h('div', { class: 'pip-contact-role' }, lines) : null,
      reach.length ? h('div', { class: 'pip-contact-reach' }, reach) : null
    ].filter(Boolean)),
    remove
  ]);
}

export function openProjectModal(project, { onChanged = null } = {}) {
  const filterInput = h('input', {
    class: 'pip-search',
    type: 'search',
    placeholder: 'filter this project…'
  });

  const contactsHost = h('div', { class: 'pip-ticket-section' });
  const attachHost = h('div', { class: 'pip-ticket-attachments' });
  const contentsHost = h('div', { class: 'pip-project-contents' });

  let loaded = { inbox: [], tasks: [], notes: [], journal: [] };

  function drawContents() {
    const q = filterInput.value.trim().toLowerCase();
    contentsHost.innerHTML = '';

    let shown = 0;
    for (const kind of KINDS) {
      const rows = (loaded[kind.key] || []).filter((r) => {
        if (!q) return true;
        const hay = `${kind.title(r)} ${r.body_md || r.notes_md || ''}`.toLowerCase();
        return hay.includes(q);
      });
      if (!rows.length) continue;
      shown += rows.length;

      contentsHost.appendChild(
        h('div', { class: 'pip-ticket-section' }, [
          h('div', { class: 'pip-ticket-section-label' }, `${kind.label} (${rows.length})`),
          h(
            'div',
            { class: 'pip-project-rows' },
            rows.map((row) => {
              const state = stateOf(row);
              const preview = previewOf(row);
              const item = h('button', { class: 'pip-project-row' }, [
                h('div', { class: 'pip-project-row-glyph' }, [icon(kind.glyph, { size: 13 })]),
                h('div', { class: 'pip-project-row-main' }, [
                  h('div', { class: 'pip-project-row-top' }, [
                    h('span', { class: 'pip-project-row-title' }, kind.title(row)),
                    row.source_ref ? h('span', { class: 'pip-project-row-ref' }, row.source_ref) : null
                  ].filter(Boolean)),
                  preview ? h('div', { class: 'pip-project-row-preview' }, preview) : null
                ].filter(Boolean)),
                h('div', { class: 'pip-project-row-side' }, [
                  state ? h('span', { class: 'pip-project-row-state' }, state) : null,
                  h('span', { class: 'pip-project-row-date' }, fmtDate(row.created_at || row.updated_at))
                ].filter(Boolean))
              ]);
              // Each item opens its own detail view, attachments and all.
              item.addEventListener('click', () =>
                openTicketModal(row, {
                  entityType: kind.entityType,
                  title: kind.title(row)
                })
              );
              return item;
            })
          )
        ])
      );
    }

    if (!shown) {
      contentsHost.appendChild(
        h('div', { class: 'pip-ticket-empty' }, q ? 'Nothing in this project matches.' : 'Nothing assigned to this project yet.')
      );
    }
  }

  async function loadContacts() {
    const contacts = await listContacts(project.id).catch(() => []);
    contactsHost.innerHTML = '';
    if (!contacts.length) return;
    contactsHost.append(
      h('div', { class: 'pip-ticket-section-label' }, `KEY CONTACTS (${contacts.length})`),
      h('div', { class: 'pip-contact-list' }, contacts.map((c) => contactRow(c, loadContacts)))
    );
  }

  const c = project.counts || {};
  const modal = openModal({
    title: project.name,
    body: [
      h('div', { class: 'pip-project-head' }, [
        h('span', { class: 'pip-project-status', dataset: { status: project.status || 'open' } }, (project.status || 'open').toUpperCase()),
        h('span', { class: 'pip-project-counts' }, `${c.inbox || 0} inbox · ${c.tasks || 0} tasks · ${c.notes || 0} notes · ${c.journal || 0} journal`)
      ]),
      contactsHost,
      attachHost,
      filterInput,
      contentsHost
    ],
    onClose: () => {
      if (onChanged) onChanged();
    }
  });

  filterInput.addEventListener('input', drawContents);

  projectContents(project.id)
    .then(({ contents }) => {
      loaded = contents;
      drawContents();
    })
    .catch((err) => {
      contentsHost.appendChild(h('div', { class: 'pip-ticket-empty' }, `Couldn't load: ${err.message}`));
    });

  loadContacts();

  listAttachments('project', project.id)
    .then((list) => {
      if (!attachHost.isConnected || !list.length) return;
      for (const node of attachmentSections(list, { onOpenImage: (a) => window.open(a.src, '_blank', 'noopener') })) {
        attachHost.appendChild(node);
      }
    })
    .catch(() => {});

  return modal;
}
