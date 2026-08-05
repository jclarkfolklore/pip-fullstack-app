# Handoff — 2026-08-05

Picking up after a session got cut off. Written from the actual tree state, not
from memory. Read `CLAUDE.md` first for architecture/conventions; this file only
covers **what's in flight right now**.

## Tree state

- Branch `master`, **in sync with `origin/master`** (nothing unpushed).
- `npm run build` passes.
- Server is running and healthy on http://127.0.0.1:4288.
- Remote: https://github.com/jclarkfolklore/pip-fullstack-app.git

Everything through the Clu3 companion, the 3-day forecast, the 2x art
re-authoring, and the monday-sync skill is **committed and pushed**. Last five:

```
a83e301 Add monday-sync skill; fix live refresh for in-app changes
cf11ee7 Re-author Clu3's art at 2x resolution
23402ca Make the forecast glanceable
a921968 Add Clu3 companion panel and 3-day forecast
701bdf4 Add Settings/Journal widgets, group dashboard, fix data-integrity bugs
```

## Uncommitted work — complete and verified, just not committed

Three modified files, two logical changes. Both are finished; the session ended
before committing, not mid-edit.

### 1. Tasks widget redesigned as a grouped card grid

`src/widgets/tasks/tasksWidget.js`, `src/styles/widgets.css`

Replaced the status dropdown + single full-width list with sections in work
order — **IN PROGRESS → TODO → DONE** — laid out as a responsive card grid
(`auto-fill, minmax(190px, 1fr)`).

- "TODO" rather than "OPEN" — open reads as a state, these are the not-started ones.
- `DONE` is collapsed behind a `SHOW DONE (n)` toggle. It's the biggest and least
  actionable group (currently 15 of 23 tasks), so it stays out of the way.
- Per-card status chip removed — the section heading already says the status.
- `doing` cards get an accent border; `done` cards dim to 0.62 and strike through.
- Notes clamp to 2 lines so one verbose task can't stretch its row.
- Overdue meta turns accent-colored.
- DELETE became a ghost icon button so the primary action reads first.
- One `listTasks({project})` call, grouped client-side — the sections need all
  three statuses at once, so one request beats three.

**Verified in-browser**: sections render with correct counts (IN PROGRESS · 2,
TODO · 6, DONE · 15), the toggle flips label/visibility both ways, done cards
show struck-through with REOPEN.

### 2. monday-sync exclusion list

`.claude/skills/monday-sync/SKILL.md` — adds an **Excluded boards** section:
"FLKR – PROJ – Rock 'Em Sock 'Em" (`18418466592`) and its subitems board
(`18418466596`), excluded per Key on 2026-08-05 as not in use. Also skips
template/reference boards (`TEMP —`, `Temp —`, `* Template`, `Users`,
`Job Roles`, `Client Register`, `Project Register`, `* Portal`).

Not exercised against the live API — see the auth note below.

**First decision on resume:** commit and push these, or keep iterating on the
Tasks layout first. Nothing blocks committing.

## Open backlog

These are real `open` tasks in the app's own PIP project — the app is its own
issue tracker, so check there rather than trusting this list to stay current:

| Task | Note |
|---|---|
| Enable the Clu3 pulse LaunchAgent | `scripts/com.folklore.clu3-pulse.plist` → `~/Library/LaunchAgents`. **Left deliberately for Key** — persistent change to his machine, needs his password. |
| Deep-link search results to the specific card | Known limitation: a result opens the right widget but doesn't scroll to or highlight the match. |
| Add ADO as a sync source | ADO isn't reachable from this environment. Needs a bridge, or a manual/paste-driven path into `scripts/pip-upsert.js` using an `ado-` id prefix. |

## Decisions already made — don't re-litigate

**Clu3's contract** (full detail in `docs/CLU3.md`, read before touching
`server/clu3/` or the art):

- **Brain**: deterministic rules engine for the always-on baseline, plus a
  `clu3_messages` queue Claude POSTs to during sessions. No live LLM call on the
  loop — rejected for cost/latency/failure on an ambient panel.
- **Tone**: chatty in *presence*, sparse in *pressure*. It rotates observations
  so it feels alive but stays out of the accountability-coach register. A tone
  dial lives in Settings rather than being hardcoded.
- **Care mechanic**: Clu3 has real momentum (`energy` decays when you're away,
  recovers on wins) but it's computed from a trailing `activity_log` window — so
  it behaves like an inner state while never fabricating a feeling.
- **Signals watched**: overdue tasks, staleness, wins/streaks, journal gaps.
- Clu3 is shell chrome, not a dashboard tile — no `widgets` row, and it doesn't
  write to `activity_log`.

**Project-wide standards** (also in `CLAUDE.md`):

- **All mutations go through the API or a drop file — never raw SQL.** Raw SQL
  skips `activityRepo.logEvent`, which makes the change invisible to Metrics.
  Read-only `sqlite3` inspection is fine any time.
- **No emoji anywhere.** Glyphs are hand-authored pixel grids (`src/lib/icons.js`
  at 8x8, `src/lib/clu3Atlas.js` for Clu3 at 2x on a 72x44 stage).
- **Everything displayed must be real data** — no placeholder or invented values.
- Schema changes go through `MIGRATIONS` in `server/schema.js` plus a version
  bump, never a hand-run `ALTER TABLE`.

## Running it

```bash
npm run server
```

Then http://127.0.0.1:4288. `npm run watch` rebuilds the frontend on save.
If it's running under the LaunchAgent instead:

```bash
launchctl kickstart -k gui/$(id -u)/com.folklore.pip
```

There's no test suite — verify by exercising the API or driving the browser.

## Environment note

The **monday.com and Slack MCP connectors need re-authorization** — they're
listed as requiring auth, and OAuth can't be completed non-interactively. Until
Key authorizes them (claude.ai connector settings, or `/mcp` in an interactive
terminal), the monday-sync skill can't actually reach monday, so change #2 above
stays unexercised.
