# PIP — a Tamagotchi-styled productivity device

A personal dashboard that lives entirely in your browser: no server, no
backend, no account. It's a real SQLite database running client-side, wrapped
in a Tamagotchi/Digimon-style LCD device shell.

## Running it

Just open `dist/index.html` by double-clicking it. That's it — no `npm
install`, no server, works offline. Bookmark that file or drag it to your
dock/home screen for quick access.

If you ever want to develop on it (see "Developing" below), you'll need
Node.js and to run `npm install` once inside this folder.

## What's actually in here

```
src/               source — edit these, not dist/
  index.js         boots the app: opens the db, mounts the shell
  styles/          plain CSS, themeable via custom properties (variables.css)
  db/
    schema.js      the data model — table definitions, lives independent of any UI
    client.js      sql.js wrapper (init, run/all/get helpers, change notifications)
    persistence.js IndexedDB autosave + .sqlite file export/import
    repo/          one file per "entity" — inboxRepo, tasksRepo, layoutRepo.
                   Widgets talk to these, never to raw SQL directly.
  app/
    router.js      tiny hash router (#/inbox, #/tasks, ...)
    shell.js       the device chrome — bezel, screen, physical buttons
    dashboard.js   the home-screen grid + tile↔full-view transitions
    widgetRegistry.js  maps a widget "kind" to its module
  widgets/         one folder per widget: inbox/, tasks/, pacing/, overview/
  lib/             small dependency-free helpers (dom, animations, frontmatter parser)
dist/              the built app — this is what you actually open/run
inbox/drops/       where Claude (or you) drop markdown notes to import
```

The point of this split: the **data model** (`db/`) doesn't know the UI
exists, and the **UI** (`widgets/`, `app/`) never writes raw SQL — it calls
repo functions. That's what makes it safe to keep reshaping the interface
over time without risking the data, and vice versa.

## Adding a new widget

1. Make a folder under `src/widgets/yourthing/`.
2. Export `kind`, `renderTile(ctx)` (the dashboard tile) and `renderFull(ctx)`
   (the full-screen view, returns `{ el, destroy? }`).
3. Register it in `src/app/widgetRegistry.js`.
4. Add a row for it to `SEED_WIDGETS` in `src/db/schema.js` (or insert one via
   `layoutRepo.js` — the dashboard reads its tile list from the `widgets`
   table, so ordering/enabling is just data).
5. Rebuild (`npm run build`).

`pacing` and `overview` currently ship as intentionally thin — `overview` has
real numbers, `pacing` is a labeled placeholder — both are meant to grow once
we've actually lived with the Inbox/Tasks loop for a while.

## The Inbox lifecycle

Every inbox item moves through: **new → active → resolved → archived**
(with a "reopen" path back). Resolving can optionally spin off a linked
Task. Items carry tags and a markdown body (rendered with `marked`).

## How notes from Claude get in (`inbox/drops/`)

Because this is a fully static, serverless app, nothing here can reach into
your browser's storage automatically. So the convention is a folder-based
handoff:

- Claude writes one `.md` file per note into `inbox/drops/`, formatted like:

  ```
  ---
  id: "9f2c...-a real uuid"
  title: "Short title"
  tags: ["work", "follow-up"]
  source: "claude"
  createdAt: "2026-08-04T18:00:00Z"
  ---
  The body of the note, in markdown.
  ```

- On the Inbox screen, tap **IMPORT** and pick the `inbox/drops` folder.
  Every `.md` file in it gets parsed and inserted as a `new` item.
- Importing is **idempotent** — it keys off the `id` in the frontmatter, so
  re-selecting the same folder never creates duplicates. Safe to import
  often.
- You can also add notes directly in the app with the **+** button — no
  Claude round-trip required.

## Data & backups

Day-to-day storage is **IndexedDB**, scoped to wherever this `index.html`
file lives — it autosaves on every change, no action needed, and survives
reloads/restarts.

Because this app is opened via `file://` (no server), the browser can't
silently overwrite the original `.sqlite` file on disk — every **EXPORT
.sqlite** tap triggers a real download of a portable, standard SQLite file.
Use it to:
- back up your data somewhere durable,
- move it to another device,
- hand it to Claude to inspect between chat sessions (a real `.sqlite` file,
  openable with any SQLite tool).

**IMPORT** (next to Export, at the bottom of the dashboard) loads a `.sqlite`
file back in, replacing the current data after a confirmation prompt.

## Theming

Tap the ✦ button to cycle screen tints (default sage LCD → amber → mono →
night). All of it is CSS custom properties in `src/styles/variables.css` —
add a new `[data-theme='name']` block there and it's in the rotation.

## Developing

```
npm install       # once
npm run build     # production build → dist/
npm start         # dev server with live reload (webpack-dev-server)
npm run watch     # rebuild dist/ on save, no server
```

Two build-specific things worth knowing if you touch the config:

- **No runtime code-splitting.** Everything bundles into one
  `pip.bundle.js`. Since the shipped app opens via `file://`, dynamic
  `import()`/chunk fetches are unreliable there — so "code splitting" here
  means modular *source* files, not lazy-loaded chunks. Keep new widgets as
  static imports in `widgetRegistry.js`.
- **sql.js's `.wasm` and the pixel fonts are inlined as base64** (see the
  `asset/inline` rules in `webpack.config.js`), so nothing ever needs a
  network fetch to a local file — Chrome blocks `fetch()`/XHR to `file://`
  resources, but inline `data:` URIs work everywhere.

## This is meant to evolve

Nothing here is precious. Tell Claude what's annoying, missing, or wrong
about how you actually use it day to day, and it'll reshape the relevant
widget/table — that's the whole point of keeping the data model and the UI
decoupled.
