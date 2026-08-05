Drop `.md` files here and the running PIP server picks them up automatically
— usually within 3 seconds, no button, no UI action. Processed files move
into `processed/` so this folder stays a clean "pending" queue.

Format (frontmatter + markdown body):

```
---
id: "a-stable-unique-id"
title: "Short title"
kind: "inbox"
tags: ["work", "follow-up"]
source: "claude"
sourceType: "monday"
sourceUrl: "https://folklore-digital.monday.com/boards/.../pulses/12704488282"
project: "Best Buy"
createdAt: "2026-08-05T18:00:00Z"
---
The body of the note, in markdown.
```

Field notes:

- `id` — required for idempotency. Reuse the same id and re-dropping the
  file never creates a duplicate (it's a no-op if the id already exists).
  A stable id derived from the source (e.g. the Monday item id, or a hash of
  an email thread) is ideal.
- `kind` — `inbox` (default) or `note`. Inbox items go through the
  new → active → resolved → archived lifecycle; notes are just reference
  material with no lifecycle.
- `sourceType` — one of `manual`, `chat`, `monday`, `ado`, `email`,
  `screenshot`. Drives the pixel icon shown on the card and the Metrics
  "by source" breakdown.
- `sourceUrl` — optional link back to the original item; shown as a
  clickable "open source" link on the card.
- `project` — optional, matched by name (case-insensitive). First mention
  creates the project; everything after matches the existing one. Omit for
  unassigned.
- `tags` — optional array.

This is the main Claude → app pipeline. For anything beyond "create a new
item" — resolving something, changing a status, deleting, correcting a
typo — Claude edits `data/pip.sqlite` directly (it's a real SQLite file);
see `todo-app/docs/CLAUDE-INTEGRATION.md` for the how-to and the current
schema.
