# PIP — a universal organization + work-log tool

A personal/team dashboard for staying on top of things across multiple
projects and workboards: an Inbox (triage lifecycle), Tasks, Notes
(reference material), and Projects, plus a Metrics view built from a real
work-history log. Styled as a pixelated, LED-lit device screen.

This is a **full-stack app**: a real Express + SQLite server running
locally, and a browser frontend that talks to it. It replaced an earlier
static/file://-only version specifically so Claude could get direct, live
access to the data.

If you're working on this with Claude Code, it reads `CLAUDE.md` at this
repo's root automatically — commands, architecture, conventions, and how it
should interact with the running app all live there. This README is the
human-facing tour; `CLAUDE.md` is the agent-facing one. (For a Claude
session without local shell access to this machine — e.g. cloud Cowork —
see `docs/CLAUDE-INTEGRATION.md` instead.)

## Running it

First time only:

```
npm install
```

Then either:

- **One-off**: `npm run server`, then open `http://127.0.0.1:4288` in a
  browser.
- **Always on (recommended)**: install the LaunchAgent so it starts on
  login and restarts itself if it ever crashes:
  ```
  cp scripts/com.folklore.pip.plist ~/Library/LaunchAgents/
  launchctl load ~/Library/LaunchAgents/com.folklore.pip.plist
  ```
  After that, `http://127.0.0.1:4288` is just always there. Bookmark it.

If you change the frontend source and want the build to update:
`npm run build` (one-off) or `npm run watch` (rebuilds on save).

## What's actually in here

```
server/            the backend — Express + better-sqlite3
  index.js         entrypoint: binds 127.0.0.1 only, serves the built
                    frontend, mounts the API, starts the drops watcher
  db.js            opens data/pip.sqlite (WAL mode), runs schema + migrations
  schema.js         the data model — table definitions + migrations
  repo/             one file per entity — projects, inbox, tasks, notes,
                    tags, activity, search, layout. Routes call these,
                    never raw SQL directly.
  routes/           REST endpoints, one file per resource, + events.js (SSE)
  dropsWatcher.js   auto-imports data/drops/*.md every few seconds
  lib/frontmatter.js  minimal YAML-frontmatter parser (CommonJS twin of
                       src/lib/frontmatter.js — Node backend vs. bundled
                       frontend can't share an ESM module directly)
  public/           built frontend lands here (webpack output) — gitignored

src/                frontend source
  index.js          boots the app, mounts the shell
  api/              fetch-based client — one file per entity, mirrors
                     server/repo/ function names. client.js also owns the
                     shared SSE connection (onChange) that makes the UI
                     live-refresh.
  app/
    shell.js        console chrome — screen, status bar, bottom nav
    dashboard.js    home-screen grid + tile↔full-view transitions
    widgetRegistry.js  maps a widget "kind" to its module
    searchPanel.js  cross-entity search — desktop side panel + mobile overlay
  widgets/          one folder per widget: inbox/, tasks/, notes/,
                     projects/, metrics/, overview/
  lib/              dom helpers, animejs helpers, frontmatter parser, the
                     pixel icon system

data/               tracked in git (personal/private app — see CLAUDE.md)
  pip.sqlite         the real, live database
  drops/             drop .md files here — auto-imported, no button needed
```

The data model (`server/`) doesn't know the UI exists, and the UI
(`src/widgets/`, `src/app/`) never writes SQL — it calls the fetch-based
`src/api/` client, which mirrors the server's `repo/` functions. That split
is what makes it safe to keep reshaping either side without risking the
other.

## The four entities

- **Inbox** — things to triage. Lifecycle: **new → active → resolved →
  archived** (with a reopen path back). Resolving can spin off a linked
  Task. Carries tags, a project, a markdown body, and a source (see below).
- **Tasks** — status: **open → doing → done**. Can belong to a project.
- **Notes** — plain reference material. No lifecycle — just create, edit,
  pin, delete. For the "store notes and whatnot" use case that doesn't fit
  a triage flow.
- **Projects** — first-class, not just a tag. Everything above can
  optionally belong to one; a Projects widget shows counts per project.
  Deleting a project un-assigns its items rather than deleting them.

All three content types (Inbox/Tasks/Notes) share one tag system
(`entity_tags`) and one cross-entity search.

## Multi-source ingestion

Every inbox item and note carries a `source_type` — `manual`, `chat`,
`monday`, `ado`, `email`, `screenshot` — which drives its pixel icon and
feeds the Metrics "by source" breakdown, plus an optional `source_url` that
renders as a clickable "open source" link on the card.

The **drops** folder (`data/drops/`) is how Claude turns something you hand
it — a Monday item, an ADO work item, a screenshot, an email, or you just
describing something in chat — into a real Inbox item or Note: Claude
writes a small markdown file with frontmatter, and the running server
auto-imports it within a few seconds. No button, no manual step. See
`data/drops/README.md` for the exact format.

For anything beyond creating a new item — resolving something, changing a
status, correcting a typo, bulk cleanup — Claude edits `data/pip.sqlite`
directly. It's a real SQLite file; see `docs/CLAUDE-INTEGRATION.md`.

## Work log & Metrics

Every meaningful state change is appended to `activity_log` — separate from
the mutable "current state" columns, so it survives an item's state
changing again later. That's the basis for Metrics:

- resolved-per-day bar chart, last 7 days
- average time-to-resolve (from the log, not an overwritable column)
- current inbox/task/note snapshot counts
- breakdown by project and by source type
- top tags

Intentionally a first pass, not a finished analytics suite — the natural
place to grow as more kinds of data flow in.

## Search

One implementation (`src/app/searchPanel.js` + `server/repo/searchRepo.js`,
via `GET /api/search`), mounted two ways: an always-visible panel on the
right at ≥860px viewport width, or a full-screen overlay on mobile opened
via the bottom-nav search icon. Searches inbox items, tasks, notes, and
tags in one unified list. Known limitation: a result opens the right widget
but doesn't yet deep-link to that specific card.

## Visual design: pixel icons, no emoji, unbounded LED screen

Every glyph — nav buttons, tile icons, source badges — is a hand-authored
8×8 pixel icon (`src/lib/icons.js`), rendered as SVG rather than emoji.
Custom-built rather than an actual "Carbon" icon pack, for licensing/fit
reasons; swapping is a one-file change if you'd rather use a real pack.

The screen is unbounded — no device bezel/shell — and responsive: a single
column with the screen on top and a bottom icon-button nav bar below 860px,
becoming a row with a search side panel on the right at ≥860px. Aspect
ratio is 4:3 below that breakpoint and true 16:9 at/above it (16:9 at every
width would letterbox down to a cramped strip on a typical phone) — a
one-line change in `src/styles/device.css` if you'd rather have strict 16:9
everywhere.

## Live refresh

The frontend holds one shared Server-Sent Events connection
(`GET /api/events`). The server polls SQLite's own `PRAGMA data_version` —
which changes on ANY commit to the file, from any process — and pushes a
refresh signal to every open tab. This is what makes the UI update live
when Claude edits the database directly, with no reload needed.

## Backups

**EXPORT BACKUP .sqlite** at the bottom of the dashboard downloads a
timestamped copy of the live database (flushing the WAL first, so it's a
complete, openable-anywhere file) — for whenever you want a point-in-time
backup, separate from the live `data/pip.sqlite`.

## Theming

Tap the theme icon in the bottom nav to cycle screen tints (sage → amber →
mono → night). CSS custom properties in `src/styles/variables.css` — add a
`[data-theme='name']` block there to add one.

## This is meant to evolve

Nothing here is precious. Tell Claude what's missing or wrong about how you
actually use it, and it'll reshape the relevant widget/table — hand it a
Monday item, an ADO work item, a screenshot, an email, or a rough note in
chat, and it can turn that into a drop file and/or extend the app if the
current widgets don't already fit.
