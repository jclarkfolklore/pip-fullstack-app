# CLAUDE.md

Guidance for Claude Code working in this repository. Read this before
making changes — it covers commands, architecture, data-model conventions,
and what you can and can't safely do here.

## What this is

PIP is Key's personal/team organization and work-log tool: an Inbox (triage
lifecycle), Tasks, Notes (reference material, no lifecycle), and Projects
(first-class — everything else can optionally belong to one), plus a
Metrics view derived from an append-only activity log. It spans multiple
workboards/projects, not just one list, and is meant to accumulate real
work history over time.

It's a full-stack app: an Express + better-sqlite3 backend running locally
on this machine, and a webpack-bundled frontend that talks to it over
`fetch()` + Server-Sent Events. It was rearchitected from an earlier
static/file://-only version specifically so Claude could get real, direct
access to the data — see "Interacting with the running app" below.

## Commands

```
npm install       # once per machine — better-sqlite3 is a native addon,
                   # compiled for this OS/arch, so it can't be shipped pre-built
npm run build      # production frontend build → server/public/
npm run watch      # rebuild frontend on save (no server)
npm run server     # start the backend at http://127.0.0.1:4288
```

```
npm test           # unit + integration, ~1s, no browser or build needed
npm run test:e2e   # real browser against a real server (build first)
npm run lint       # correctness only; Prettier owns formatting
npm run format     # apply Prettier
npm run test:all   # lint + format:check + unit + e2e
```

**Run `npm test` after any change to `server/` or `src/lib/`.** It's fast
enough to run constantly. Run `npm run test:e2e` before committing UI work.

See `docs/TESTING.md` for what's covered and why. Three things worth knowing
before you write a test here:

- Tests run against **real SQLite** via `PIP_DB_PATH`, never mocks — the bugs
  worth catching are in migrations, CHECK constraints and cascade behaviour,
  and a mock reproduces all three incorrectly.
- **Never assert art.** Structure (grids rectangular, every mood drawable) is
  fair game; appearance is not.
- If you fix a bug, add a matching entry to `scripts/pip-mutation-check.js`.
  `npm run test:mutation` breaks the code deliberately and fails if the suite
  stays green — it caught a test of mine that was passing for the wrong
  reason.

## Repository layout

```
server/            backend — Express + better-sqlite3
  index.js         entrypoint: binds 127.0.0.1 only, serves server/public/,
                    mounts the API, starts the drops watcher
  db.js            opens data/pip.sqlite (WAL mode), runs schema + migrations
  schema.js        the data model — table definitions + migrations
  repo/            one file per entity (projects, inbox, tasks, notes, tags,
                    activity, search, layout) — routes call these, nothing
                    else touches raw SQL
  routes/          REST endpoints, one file per resource, + events.js (SSE)
  dropsWatcher.js   auto-imports data/drops/*.md every few seconds
  lib/frontmatter.js  CommonJS twin of src/lib/frontmatter.js (backend is
                       CommonJS, frontend is bundled ESM — can't share directly)
  public/          webpack output lands here — gitignored, rebuild with `npm run build`

src/               frontend source
  index.js         boots the app, mounts the shell
  api/             fetch-based client, one file per entity, function names
                    mirror server/repo/. client.js owns the shared SSE
                    connection (`onChange`) that drives live refresh.
  app/             shell.js (chrome), dashboard.js (grid + view transitions),
                    widgetRegistry.js, searchPanel.js
  widgets/         one folder per widget: inbox/, tasks/, notes/, projects/,
                    metrics/, overview/
  lib/             dom helpers, animejs helpers, frontmatter parser, the
                    pixel icon system (icons.js)

docs/CLAUDE-INTEGRATION.md   for a Claude session WITHOUT local shell access
                              (e.g. a cloud Cowork session) — read that
                              instead of this file in that situation.
docs/CLU3.md                 Clu3, the companion panel — how the rules engine,
                              sprite/scene system and message queue work, and
                              how to extend them. READ THIS before changing
                              anything under server/clu3/ or the Clu3 art.
```

Beyond the four entities there's also **Clu3** (`server/clu3/`, the panel at the
top-right) and a **3-day forecast** (`server/weather/`, Open-Meteo + NWS
alerts, no API keys). Both are chrome rather than work content: they live in
the shell, not the dashboard grid, and neither writes to `activity_log`.

`data/` (the live `pip.sqlite` and the `drops/` folder) lives inside this
repo, at `data/pip.sqlite` / `data/drops/`, and is tracked in git. This is a
personal/private app rather than shipped software, so committing the live
database is an accepted tradeoff — the git history doubles as a backup.
The WAL/SHM sidecar files (`data/pip.sqlite-wal`, `data/pip.sqlite-shm`) are
transient and gitignored; only the main `.sqlite` file is tracked.

## Data model (server/schema.js is authoritative — this is a summary)

- `projects` — id, name (unique), color, archived, sort_order. No seeded
  default project — starts empty until the user creates one.
- `inbox_items` — id, title, body_md, source, source_type, source_url,
  project_id, stage (`new|active|resolved|archived`), outcome_md,
  created_at, stage_changed_at, import_hash. Resolving can spawn any
  number of tasks (not just one) — see `tasks.from_inbox_item_id` below.
- `tasks` — id, title, notes_md, status (`open|doing|done`), project_id,
  due_at, created_at, completed_at, from_inbox_item_id — the one-to-many
  link back to the inbox item a task was decomposed from, if any.
- `notes` — id, title, body_md, source*, project_id, pinned, created_at,
  updated_at, import_hash — no lifecycle, just reference material
- `journal_entries` — id, body_md, created_at, updated_at — a personal
  work journal (experiences, interactions, reflections). No title, no
  lifecycle, not tied to a project; distinct from Notes (reference
  material) and Inbox (things to triage).
- `tags` + `entity_tags` (entity_type `inbox`|`task`|`note`, entity_id) —
  one polymorphic tag system shared across those three (journal entries
  aren't tagged)
- `activity_log` — id, entity_type, entity_id, event_type, detail_json,
  occurred_at — append-only; Metrics is computed entirely from this, not
  from the mutable "current state" columns above
- `widgets` — dashboard tile layout (id, kind, title, glyph, sort_order,
  enabled, group_name) — the grid reads this, so hiding/reordering/
  regrouping tiles is a data change, not a code change. group_name buckets
  tiles into dashboard sections (see GROUPS in `src/app/widgetRegistry.js`).
- `app_meta` — key/value (currently just `schema_version`)

`source_type` (on `inbox_items`/`notes`) is one of `manual`, `chat`,
`monday`, `ado`, `email`, `screenshot`.

## Conventions

- **UI never writes SQL.** `src/widgets/*` and `src/app/*` call
  `src/api/*.js`, which calls the Express routes, which call
  `server/repo/*.js`, which is the only layer that touches `better-sqlite3`
  directly. Keep new features on that path.
- **Every meaningful mutation logs an activity event** via
  `server/repo/activityRepo.js`'s `logEvent(entityType, entityId, eventType, detail)`.
  This is what Metrics is derived from — a mutation that skips this is
  invisible to Metrics and to any future "what happened when" question.
- **Widget contract**: a widget module exports `kind`, `renderTile(ctx)`
  (dashboard tile), and `renderFull(ctx)` (full-screen view, returns
  `{ el, destroy? }`). Register new widgets in `src/app/widgetRegistry.js`
  and add a row to `SEED_WIDGETS` in `server/schema.js`.
- **No emoji, anywhere.** All glyphs go through `icon(name, opts)` in
  `src/lib/icons.js` (hand-authored 8×8 pixel grids, not a real icon pack —
  a deliberate licensing/fit choice, easy to swap later).
- **Live refresh, not manual re-render.** Widgets subscribe to
  `onChange()` from `src/api/client.js` (a shared SSE connection) rather
  than polling themselves. After a mutation your own widget triggered, also
  call its local render function directly for instant feedback — don't
  rely solely on the SSE round-trip, which has a small poll interval
  (`server/routes/events.js`).
- **Schema changes** go through `MIGRATIONS` in `server/schema.js`
  (`{version, statements[]}`) plus a `SCHEMA_VERSION` bump, AND a matching
  update to `SCHEMA_SQL` so fresh databases get the same shape. Indexes belong
  in `SCHEMA_INDEXES`, which runs _after_ migrations — an index on a
  migration-added column in `SCHEMA_SQL` breaks every existing database while
  passing on a fresh one. Migrations apply in a transaction and abort on any
  error that isn't a known idempotent no-op; never edit one that's already
  applied. See `docs/TESTING.md`.

## Interacting with the running app

You're Claude Code, running locally on this machine — you have real shell
access, unlike a cloud-based Claude session working on this same project.
That means you can:

- Start/stop it yourself: `npm run server` in a terminal you control, or
  check if the LaunchAgent already has it running: `launchctl list | grep
folklore.pip`.
- Restart it after a code change: if it's running under the LaunchAgent,
  `launchctl kickstart -k gui/$(id -u)/com.folklore.pip`; if it's running in
  a terminal the user started, ask them to Ctrl-C and re-run rather than
  killing a process you didn't start.
- Hit the API directly for testing: `curl http://127.0.0.1:4288/api/health`,
  etc. — no file-bridge workaround needed.

### Mutate through the API, not raw SQL

**Every write goes through `server/routes/*.js` (or a `data/drops/` file for
creating new inbox items/notes) — never a raw `db.prepare(...)` script or
`sqlite3` `UPDATE`/`DELETE`/`INSERT`.** The routes → `server/repo/*.js` path
is the only layer that reliably calls `activityRepo.logEvent(...)`
alongside the actual mutation; a raw SQL edit changes the "current state"
columns but silently skips the log, so Metrics and any future "what
happened when" question can't see it. It also skips whatever validation the
repo layer does (e.g. `deleteProject` vs. just deleting the row). Direct SQL
is fine for **read-only** inspection (`sqlite3 data/pip.sqlite "SELECT
..."`) any time. The full CRUD surface already exists per entity — list
(`GET /api/inbox` etc.), get by id, create, update, delete, plus
entity-specific actions (`POST /api/inbox/:id/stage`, `/resolve`,
`/archive`; `POST /api/tasks/:id/status`) — reach for those first.

Reserve direct `data/pip.sqlite` edits for the narrow case a route
genuinely can't do yet — and even then, add the route/repo function instead
if it's something you'll want again, rather than leaving it a one-off.
Actual schema changes always go through `MIGRATIONS` in `server/schema.js`
(see Conventions above), never a hand-run `ALTER TABLE`.

For the common case of "add a new inbox item or note," writing a markdown
drop file into `data/drops/` (see `data/drops/README.md` for the
format) is simpler than composing API calls by hand — the running server
auto-imports it within a few seconds, idempotent on the note's own `id`.

If you're a Claude session _without_ local shell access to this machine
(e.g. a cloud Cowork session reaching this project through a file bridge),
none of the process/network access above applies to you — read
`docs/CLAUDE-INTEGRATION.md` instead, which covers the file-only workflow.

## Known limitations / judgment calls already made

- Pixel icons are hand-built (`src/lib/icons.js`), not IBM's actual Carbon
  Design System set — a licensing/fit decision, not an oversight.
- The screen is 4:3 below an ~860px viewport width and true 16:9 at/above
  it, rather than strict 16:9 everywhere — 16:9 at every width letterboxes
  down to a cramped strip on a typical phone. One-line revert in
  `src/styles/device.css` if that's ever wanted.
- Search results open the right widget (Inbox/Tasks/Notes) but don't yet
  deep-link to the specific card — a reasonable next step if search sees
  heavy use.
- No automated tests yet (see Commands above).
