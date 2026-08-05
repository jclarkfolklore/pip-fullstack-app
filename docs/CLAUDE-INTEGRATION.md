# How Claude works with PIP (no local shell access)

**If you're Claude Code, working directly in this repo on the machine that
runs PIP, read `CLAUDE.md` at the repo root instead — you have real shell
access there (start/stop the server, curl the API, run npm scripts), and
that file covers all of that. This doc is for the other case:** a Claude
session with no shell on this machine — e.g. a cloud Cowork session
reaching this project only through a file bridge. That session (with no
memory of building this) needs to pick up work on or interact with PIP's
data through files alone. Read this before doing anything with the database
in that situation.

## What this is

PIP is Key's personal/team organization tool: an Inbox (triage lifecycle),
Tasks, Notes (reference material, no lifecycle), and Projects (first-class —
everything can optionally belong to one), plus a Metrics view derived from an
append-only activity log. It spans multiple workboards/projects and is meant
to accumulate real work history over time, not just be a todo list.

It's a full-stack app now: Express + better-sqlite3 backend, served locally
on Key's Mac, with a frontend that talks to it over `fetch()` + Server-Sent
Events. This replaced an earlier static/file://-only version — the rewrite
happened specifically so Claude could have real, direct access to the data.

## Where things live

Relative to the project folder (`/Users/key/Documents/Claude/Projects/ToDo/`
on Key's Mac):

```
ToDo/                 ← repo root (git-tracked)
  data/
    pip.sqlite       ← the real database. This is what you read/write directly.
    drops/           ← drop .md files here for auto-import (see below)
    drops/processed/ ← drops the server has already ingested
  server/           ← Express + better-sqlite3 backend
  src/              ← frontend (webpack-bundled, served by the backend)
  docs/CLAUDE-INTEGRATION.md  ← this file
```

`data/` lives inside the repo alongside the code and is tracked in git —
this is a personal/private app, not shipped software, so there's no need to
keep it physically separate; the WAL/SHM sidecar files are gitignored, only
`pip.sqlite` itself is tracked.

## How to read/act on the data directly (the main thing you'll do)

You (Claude) do not have network access to the server's HTTP API from a
cloud session — only the user's own browser, on their Mac, can reach
`http://127.0.0.1:4288`. What you *do* have is the device bridge's file
tools, and `data/pip.sqlite` is a real, standard SQLite file. That's the
actual integration point:

1. Stage `data/pip.sqlite` into your workspace via the device bridge.
2. Query or modify it directly — Python's built-in `sqlite3` module, or
   Node's `better-sqlite3` (already a dependency in `todo-app/`), both work
   fine on a plain `.sqlite` file. Use a short-lived connection, not a
   long-held one.
3. If you wrote to it, commit the file back via the device bridge.

The running server notices — it polls SQLite's own `PRAGMA data_version`
(bumped by ANY commit to the file, including yours, from a completely
separate process) roughly twice a second and pushes a live-refresh event to
any open browser tab. You do not need to restart the server or tell it
anything after editing the file; it picks up your change on its own,
usually within a second or two.

If the server happens to be down when you edit the file, that's fine too —
SQLite doesn't care, and the next `npm run server` will just see your
changes.

### Schema (server/schema.js is authoritative — this is a summary)

- `projects` — id, name (unique), color, archived, sort_order
- `inbox_items` — id, title, body_md, source, source_type, source_url,
  project_id, stage (`new|active|resolved|archived`), outcome_md,
  created_at, stage_changed_at, resolved_task_id, import_hash
- `tasks` — id, title, notes_md, status (`open|doing|done`), project_id,
  due_at, created_at, completed_at, from_inbox_item_id
- `notes` — id, title, body_md, source*, project_id, pinned, created_at,
  updated_at, import_hash (no lifecycle — just reference material)
- `tags` + `entity_tags` (entity_type is `inbox`|`task`|`note`, entity_id) —
  polymorphic tagging across all three
- `activity_log` — id, entity_type, entity_id, event_type, detail_json,
  occurred_at — the append-only work-log Metrics is computed from. Write to
  this too if you make a change by hand, so the history stays accurate
  (event_type values in use: `inbox_created`, `inbox_stage_changed`,
  `inbox_resolved`, `inbox_archived`, `inbox_updated`, `task_created`,
  `task_completed`, `task_status_changed`, `task_updated`, `note_created`,
  `note_updated`, `project_created`, `project_updated`, `project_deleted`)
- `widgets` — dashboard tile layout (id, kind, title, glyph, sort_order,
  enabled) — the grid reads this, so hiding/reordering tiles is just a
  data change
- `app_meta` — key/value (currently just `schema_version`)

`source_type` (on inbox_items/notes) is one of `manual`, `chat`, `monday`,
`ado`, `email`, `screenshot`.

### The easier path for adding new items: drops

For "create a new inbox item/note" specifically (not edits, not status
changes), you don't need to touch the database directly — write a markdown
file with frontmatter into `data/drops/` (see `data/drops/README.md` for the
exact format) and the running server auto-imports it within a few seconds,
idempotent on the note's own `id`. This is easier and safer than direct SQL
for the common case; reach for direct file edits when you need to update,
resolve, or delete something that already exists, or when the server isn't
running and you don't want to wait.

## Running / restarting the server

Claude cannot start, stop, or restart a process on Key's Mac directly — no
tool here reaches into a running process on that machine. What you *can* do:
edit the code in the repo, then tell Key what to run. The commands:

- First-time setup (Key runs this once): `npm install`
- Manual start: `npm run server` (from the repo root), or double-click
  `scripts/pip-start.sh`
- Always-on setup (recommended, one-time): install
  `scripts/com.folklore.pip.plist` as a LaunchAgent —
  ```
  cp scripts/com.folklore.pip.plist ~/Library/LaunchAgents/
  launchctl load ~/Library/LaunchAgents/com.folklore.pip.plist
  ```
  This makes it start on login and restart automatically if it crashes.
- After you ship a code update, the running process needs a restart to pick
  it up. If it's running under launchd:
  `launchctl kickstart -k gui/501/com.folklore.pip` (Key's UID may differ —
  `id -u` on the Mac gets the real number). If Key is just running it
  manually in a terminal, they Ctrl-C and re-run `npm run server`.

Editing the database file directly (the main workflow above) needs none of
this — it works whether the server is running or not.

## Future automations / cron jobs

The user's stated plan is to eventually add scheduled automations that work
with this data. Given the constraints above, those should be built as
Claude-side scheduled tasks (`create_trigger`) that, on firing, use the
device bridge to read/write `data/pip.sqlite` directly — the same pattern
described above — rather than anything that calls the local server's HTTP
API over a network, since a cloud-side scheduled task can't reach
`127.0.0.1` on Key's Mac.
