---
name: ado-sync
description: Pull Key's assigned Azure DevOps work items into PIP, with full ticket detail (description + acceptance criteria), a link back, and honest status. Use when the user asks to check ADO, sync ADO/Azure DevOps, pull in their tickets, "what's on my board", or shares an ADO board/taskboard URL.
---

# ado-sync

**PULL only — ado.dev → PIP.** There is no PUSH direction yet (unlike
monday-sync): nothing writes back to Azure DevOps. If Key asks for that later,
build it the way monday-sync's PUSH works (explicit per-change confirmation,
never inferred status) rather than skipping confirmation because "it's just
ADO."

## Why this needs the real browser

ADO isn't reachable by API from this environment — no PAT, no MCP connector.
The only path in is Key's own logged-in session, so this **must** use
`mcp__claude-in-chrome__*` (his real Chrome, already authenticated), never the
sandboxed `mcp__Claude_Browser__*` tools — that browser has no ADO cookies and
will just hit a Microsoft login wall that can't be completed non-interactively.

## Setup facts

- Org: `InspireSleep`, project: `Website`, team: `US Website Development Team`.
- PIP API is `http://127.0.0.1:4288`, local-only. Start it with
  `npm run server` from the repo root if it isn't up (`/api/health`).
- **All PIP writes go through the API**, never raw SQL — see CLAUDE.md. The
  deterministic write path is `scripts/pip-upsert.js`.
- Migration v8/v9 added `source_ref`/`source_url`/`details_md`/
  `source_meta_json` to both `tasks` and `inbox_items` — every ADO record
  should use all four, not just title/status.

## 1. Find what's assigned to Key

Two views, pick based on what Key asks for:

- **Everything actionable, any sprint** — the backlog board filtered to him:
  `https://dev.azure.com/InspireSleep/Website/_boards/board/t/US%20Website%20Development%20Team/Backlog%20items?System.AssignedTo=%40me`
  Columns before `Done` are the live set; anything already in `Done` is
  finished upstream and shouldn't be pulled in fresh.
- **Current sprint only** — the sprint taskboard, e.g.:
  `https://dev.azure.com/InspireSleep/Website/_sprints/taskboard/US%20Website%20Development%20Team/Website/Development%20Backlog/Dev%20Sprint%20<name>%20(<n>)`
  Confirm `Person: @Me` is applied (it usually already is). **Collapsed rows
  on this view are collapsed _because_ they're not assigned to Key** — the
  filter reveals other people's items when expanded. Only the already-expanded
  rows-with-a-card are his; don't expand rows to go looking for more.

Use `get_page_text` after navigating — it returns the whole board's text in
one call, work item numbers included, cheaper than screenshotting every
column. Cross-check counts against what Key states he expects (e.g. "should
be 10 ready") before proceeding — a mismatch means the wrong view or a stale
filter, not that he's wrong.

## 2. Get full ticket detail, not just the title

A title-only sync is exactly the kind of dead end this skill exists to avoid.
For every work item, navigate to
`https://dev.azure.com/InspireSleep/Website/_workitems/edit/<id>` and
`get_page_text` it. Pull out:

- **Description** and **Acceptance Criteria** sections — compose into
  `detailsMd` as markdown (`## Description`, `## Acceptance Criteria` with a
  `-` list). Trim ADO's page chrome (Save/Follow/Details/Approval
  Details/Deployment/Development/Related Work boilerplate at the bottom).
- `sourceMeta`: at minimum `Type` (User Story/Bug), `Area`, `Sprint`
  (iteration path), `Board state`. Add `Figma`, `Confirmed device`, or similar
  when the ticket has them — these render in PIP's ticket-detail modal
  (`src/app/ticketModal.js`) as a meta grid.
- If a ticket's discussion shows dev work already merged/approved but the
  board column hasn't caught up (a linked child "Front-End Work" item marked
  Done, or PR comments saying "approved by QA"), note that in `sourceMeta` —
  it's real signal for the status mapping below, and worth being able to see
  later without re-opening the ticket.
- Batch navigate+get_page_text calls with `browser_batch` (one round trip for
  N items) rather than one call pair per item.

## 2b. Images and attachments — pull them in, don't leave them on the board

Screenshots in an ADO description are frequently **the clearest statement of
the bug**. "The dropdown is too big" is a paragraph; the screenshot showing it
at twice the width of its neighbours is unambiguous. Leaving them behind means
going back to the board to do the work, which is the whole thing PIP exists to
avoid.

**Find them.** Attachment images are `<img>` tags whose src contains
`_apis/wit/attachments`:

```js
[...document.querySelectorAll('img')]
  .filter((m) => /_apis\/wit\/attachments/.test(m.src))
  .map((m) => ({
    file: decodeURIComponent((m.src.match(/fileName=([^&]+)/) || [])[1] || ''),
    w: m.naturalWidth,
    h: m.naturalHeight,
    src: m.src
  }));
```

**Getting the bytes.** These URLs are auth-protected — a fetch from anywhere
else hits a login wall, and PIP's own image fetcher will degrade them to links.
The page is authenticated, so fetch there and save via the DOM:

```js
// TOP-LEVEL await, not an async IIFE. The tool returns the last expression;
// an IIFE hands back an un-awaited Promise, so a following navigation kills
// the download mid-flight and it silently never lands.
const g = [...document.querySelectorAll('img')].filter((m) => /_apis\/wit\/attachments/.test(m.src));
const id = location.pathname.split('/').pop();
for (let k = 0; k < g.length; k++) {
  const b = await (await fetch(g[k].src, { credentials: 'include' })).blob();
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u;
  a.download = `pip-ado-${id}-${k + 1}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  await new Promise((s) => setTimeout(s, 700));
}
```

> **Chrome blocks this after the first file.** Downloading more than one file
> automatically needs per-site permission. The fetches still succeed and report
> real byte counts, so it looks like it worked — **check the filesystem, don't
> trust the return value.** If nothing landed, ask the user to allow automatic
> downloads for `dev.azure.com` (Settings → Privacy and security → Site
> Settings → Automatic downloads, or the address-bar icon). Never change that
> setting yourself.

Then hand the files to **`scripts/pip-ingest-assets.js`**, which attaches them,
places them inline and refuses to do either twice:

```bash
cat > /tmp/assets.json <<'JSON'
[
  {
    "entityType": "task",
    "entityId": "ado-183767",
    "file": "/Users/key/Downloads/pip-ado-183767-1.png",
    "title": "State dropdown open — native option list at ~2x the site type scale"
  }
]
JSON
node scripts/pip-ingest-assets.js --dry-run < /tmp/assets.json   # inspect first
node scripts/pip-ingest-assets.js < /tmp/assets.json
```

Use the script rather than posting to `/api/attachments` by hand. It reads
bytes from disk (so images never pass through the conversation), is idempotent
on (entity, caption) so a re-sync can't duplicate, validates every record
before writing anything so a bad one can't half-ingest, and **rejects a caption
that is just the filename**. Its behaviour is pinned by
`tests/ingest-assets.test.mjs`; prose describing the same steps is not.

**Caption them properly.** `title` must say what the image _shows_, not repeat
the filename — "Screenshot 2026-04-16 at 10.16.21 AM.png" tells a future reader
nothing. Look at the image and describe it: _"State dropdown rendering at ~2x
the width of the adjacent Sort dropdown"_. If ADO has caption text near the
image, use that instead. Someone reading the PIP card should know which
screenshot is which without opening all of them.

PIP caps images at 8MB, and the API body limit is 12mb to hold that once
base64 inflates it by ~4/3. A payload over the limit returns **413 with the
actual sizes** — if you see a bare 500 "internal error" instead, something else
is wrong and the server log has it. Anything genuinely over 8MB stays a link,
and say so in the report.

## 2c. Read the discussion — it often changes the work

Comments routinely narrow, expand or contradict the ticket body, and a sync
that reads only the description hands over detail that is already wrong. Real
examples from this board:

- QA re-testing and finding **only one of the two reported issues reproduces**
  — half the ticket evaporated in a comment.
- QA pinning the true cause: _"tied to iOS 26, not iPhone 17 Pro hardware"_ —
  which changes the entire test matrix.
- A reporter pasting a **rewritten description** into a comment because the
  original was wrong. The body is stale; the comment is the real ticket.

The discussion sits after a `Discussion` heading in the page text:

```js
const t = document.body.innerText;
const i = t.lastIndexOf('\nDiscussion\n');
let d = i >= 0 ? t.slice(i + 12) : '';
const j = d.indexOf('\nDetails\n');
if (j >= 0) d = d.slice(0, j);
d = d.replace(/Markdown supported\.|Paste or select files to insert\.|switch to HTML editor/g, '').trim();
```

Existing comments carry no distinctive CSS class — don't try to select them by
class, slice the page text.

Fold what matters into `detailsMd` under a `## Discussion` heading, attributed
and dated (_"QA (Kyle Johnson), 2026-08-05: ..."_). Skip acknowledgements and
thanks; include anything that changes scope, reproduction, environment or
priority. **Where a comment contradicts the description, say so explicitly**
rather than silently preferring one — the person doing the work needs to know
the ticket disagrees with itself.

Comments can carry images too; the extractor above catches them since it scans
the whole page. Note in the caption when an image came from the discussion
rather than the description.

## 3. Map board state to PIP

Everything imports as a **task** (`kind: "task"`) — these are assigned dev
work with a status, not things needing triage.

| ADO column        | `status`         | `state` |
| ----------------- | ---------------- | ------- |
| Ready             | `open`           | `open`  |
| Ready for Release | `doing`          | `open`  |
| Done              | — (already done) | `done`  |

`state: "done"` is what tells `pip-upsert.js` to mark it resolved/completed —
use it only for genuinely-Done-upstream items, not Ready for Release (the
work is done but it hasn't shipped; `doing` says that honestly).

**Never let a sync move a task backward** (`pip-upsert.js`'s status
reconciliation only moves forward: open→doing→done, checked by rank). If
Key already marked something `done` locally and the board still says Ready
for Release, that's the release lagging, not a reason to revert his own
completion. Don't fight this by passing a different `status` to force it —
it's enforced in the script for exactly this reason.

## 4. Required fields — enforced, not optional

`pip-upsert.js` **aborts the whole run** if a record has `sourceType: "ado"`
without both `sourceRef` and `sourceUrl` — this isn't a style preference, it's
a hard validation. Always set:

```jsonc
{
  "id": "ado-183767", // REQUIRED: "ado-" + the work item number
  "kind": "task",
  "title": "…", // the work item title, verbatim
  "project": "Inspire",
  "sourceType": "ado",
  "sourceRef": "183767", // REQUIRED: bare number, shown on the card
  "sourceUrl": "https://dev.azure.com/InspireSleep/Website/_workitems/edit/183767", // REQUIRED
  "sourceMeta": {
    "Type": "User Story",
    "Area": "Frontend Development",
    "Sprint": "…",
    "Board state": "Ready"
  },
  "detailsMd": "## Description\n…\n\n## Acceptance Criteria\n- …",
  "tags": ["ado", "frontend"], // "ado" always; add "frontend"/"contentful"/"post-launch" etc. to match existing tag conventions
  "status": "open",
  "state": "open"
}
```

`id` must be `ado-<number>` — that's what makes re-running idempotent and
what lets a later re-sync backfill `detailsMd`/`sourceRef` onto a task that
was imported before those columns existed (the script's `changes` diff
includes `ref`, `url`, `details`).

## 5. Dry-run, then run

```bash
node scripts/pip-upsert.js --dry-run < /tmp/ado-sync.json   # inspect first
node scripts/pip-upsert.js < /tmp/ado-sync.json
```

Read the dry-run output before running for real — it names every create vs.
update and, since the fix above, will never silently print a backward status
move.

## 6. Watch for duplicate tickets

ADO tickets sometimes get filed twice for the same underlying bug (seen: two
FAD-dropdown tickets, `180913` and `183767`, same fix, same Figma reference).
Import both faithfully rather than merging — silently dropping one loses a
real work item id — but flag the overlap in `sourceMeta.Note` on one of them
and mention it in your report so Key can close one upstream himself.

## 7. Report

Group by what changed: **newly imported**, **backfilled with detail**
(existing tasks that got `detailsMd`/`sourceRef` for the first time), **status
advanced**. State the final open/doing count and whether it matches what Key
expected going in.

Also state, per ticket, **how many images were attached and how many comments
were folded in** — and call out explicitly any ticket where images were found
but could NOT be stored (download blocked, over 8MB). A silent miss there is
expensive: it sends Key back to the board for exactly the asset the sync was
meant to save him fetching.
