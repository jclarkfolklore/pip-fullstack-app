---
name: monday-sync
description: Sync work between monday.com and PIP. Scans monday.com for items assigned to Key and comments/tags mentioning him, brings them into PIP as inbox items and tasks reflecting their real upstream state, and pushes completions/replies/status changes back to monday.com. Use when the user asks to check monday, sync monday, pull in their work, "what do I need to do", or to push their PIP updates back to monday at end of day.
---

# monday-sync

Two directions, always run separately and explicitly:

- **PULL** — monday.com → PIP. Read-only against monday. Safe to run any time.
- **PUSH** — PIP → monday.com. Writes to a shared system. **Requires
  per-change confirmation** (see Push below).

Default to PULL unless the user clearly asked to push.

## Excluded boards

**Do not sync these.** Skip them when gathering, and don't create PIP records
from them:

| Board                                       | Id          | Reason                              |
| ------------------------------------------- | ----------- | ----------------------------------- |
| FLKR – PROJ – Rock 'Em Sock 'Em             | 18418466592 | Not in use — Key's call, 2026-08-05 |
| Subitems of FLKR – PROJ – Rock 'Em Sock 'Em | 18418466596 | same board                          |

Also skip template and reference boards, which hold no real assignments:
anything named `TEMP —`, `Temp —`, `* Template`, plus `Users`, `Job Roles`,
`Client Register`, `Project Register`, and the `* Portal` custom objects.

## Setup facts

- Key's monday user id is **101807615** (`get_user_context` to confirm).
- PIP API is `http://127.0.0.1:4288`, local-only. Start it with
  `npm run server` from the repo root if it isn't up (`/api/health`).
- **All PIP writes go through the API**, never raw SQL — see CLAUDE.md. The
  deterministic write path is `scripts/pip-upsert.js`.

## PULL: monday → PIP

### 1. Find the person columns

Monday boards are template-derived, so the same person-column id repeats
across many boards. Get them all at once rather than board by board:

```graphql
query {
  boards(limit: 100, state: active, order_by: used_at) {
    id
    name
    type
    columns(types: [people]) {
      id
    }
  }
}
```

Group boards by column id, then query each group in one call. Known ids as of
last run: `task_owner` (DEV boards), `people0` (TIX boards),
`multiple_person_mm0tamkb` (PROJ), `multiple_person_mm0x2x11` (MAINT),
`multiple_person_mm0t3p30` (RAID), `multiple_person_mm0tz70e` (LINK),
`epic_owner` (Epics), `people1` (Bugs Queue). Re-derive rather than trusting
this list — boards get added.

### 2. Fetch assigned items

Per group, filtering to Key:

```graphql
boards(ids: [...]) { id name items_page(limit: 50, query_params: {rules: [
  {column_id: "task_owner", compare_value: ["person-101807615"], operator: any_of}
]}) { items { id name } } }
```

Then fetch status/priority/due for the matched ids. **Include subitem boards**
— on project boards the real assignments often live on subitems, not parents.

### 3. Fetch mentions and tags

`search` with `searchType: UPDATES`, `searchTerm: "Key Clark"`. Returns the
update body, `itemId`, `boardId`, `creatorId`. Then look up each item's current
status — **a mention on an item that's since been closed usually needs no
action**, and saying so is more useful than listing it.

Monday's notification feed is not exposed by the API, so update-text search is
the available proxy for "tagged in". Say so rather than implying full coverage.

### 4. Normalise and upsert

Build a JSON array and pipe it to the upsert script:

```bash
node scripts/pip-upsert.js --dry-run < /tmp/monday-sync.json   # inspect first
node scripts/pip-upsert.js < /tmp/monday-sync.json
```

Record shape is documented at the top of `scripts/pip-upsert.js`. The rules
that matter:

- **`id` must be `monday-<itemId>`** for work items and
  `monday-update-<updateId>` for mentions. This is what makes re-running safe
  and what lets PUSH map back to monday. Never invent a random id.
- **`state`** is the state _in monday_, not what you wish it were. Pass
  `"done"` for anything Done/closed upstream — the script resolves or completes
  it locally so PIP never shows fake open work.
- **`kind`**: `task` for something Key does, `inbox` for something needing
  triage or a reply (mentions are almost always `inbox`).
- **`project`** by client name (e.g. `Best Buy`, `Inspire`, `WildFire`) —
  created on demand.
- `sourceType: "monday"`, and always set `sourceUrl` to the pulse URL.
- Tag mentions with `mention` so they're filterable in PIP.

### 4b. Assets and updates — bring them in, don't leave them on the board

A monday item's **files column and its update thread routinely hold the thing
that makes the work doable** — a mockup, an annotated screenshot, a client's
"actually, make it blue" reply. Syncing the title and status alone means going
back to the board to do the work, which defeats the point.

**Assets.** monday exposes files through the API — request them alongside the
item rather than scraping:

```graphql
items (ids: [ITEM_ID]) {
  assets { id name url public_url file_extension file_size }
  updates { id body created_at creator { name } assets { id name url public_url } }
}
```

Prefer `public_url` when present — it needs no auth, so PIP can fetch it
directly and store the bytes. When only `url` is available it is
session-protected: fetch it in the authenticated browser page and save via the
DOM, exactly as `ado-sync` describes (top-level `await`, and Chrome blocks
multiple automatic downloads until the site is allowed).

Attach each to the PIP record, reading from disk so bytes never pass through
the conversation:

```bash
node -e "
const fs=require('fs');
const b64=fs.readFileSync(process.argv[1]).toString('base64');
fetch('http://127.0.0.1:4288/api/attachments',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({entityType:'task',entityId:'monday-<itemId>',kind:'image',data:b64,
    mime:'image/png',title:'<what it shows>',source:'monday'})}).then(r=>console.log(r.status));
" <file>
```

Non-image files (PDFs, docs, video) attach as **links** with their name and
`public_url` — PIP stores images, not arbitrary binaries.

**Place them inline, where they sat upstream.** Attaching an image is only half
the job — a PIP card should read like the source ticket, not like a wall of
text with a gallery bolted underneath. After attaching, rewrite `detailsMd` to
reference each image at the point it appeared:

```markdown
![State dropdown open — native option list renders at ~2x the site type scale](/api/attachments/<id>/raw)

_State dropdown open — native option list renders at ~2x the site type scale_
```

The `src` is `/api/attachments/<id>/raw`, returned as `src` on the attachment.
The italic line under the image renders as its caption.

The detail modal skips any attachment already referenced inline, so an inline
image appears **once, in position** — while anything not referenced still shows
in the gallery below. That's deliberate: an attachment that renders nowhere is
a floating asset, which is the thing to avoid even when the row is valid. Never
delete an attachment without also removing its inline reference, or the
markdown points at nothing.

**Caption by content, not filename.** `title` should say what the asset shows
— _"Annotated mockup: revised CTA placement"_ — never
`Screenshot_2026-04-16.png`. If the update body around the asset explains it,
use that wording.

### 4c. Updates and replies — often where the real requirement lives

The update thread is monday's discussion, and on client boards it is frequently
**more current than the item itself**: scope changes, approvals and rejections
land as replies while the item's own fields go stale.

Fold what matters into `detailsMd` under a `## Updates` heading, each entry
attributed and dated (_"Corey Singleton, 2026-08-05: ..."_). Include anything
that changes scope, priority, acceptance or ownership; skip acknowledgements
and reaction-only replies.

**Where an update contradicts the item's own fields, say so explicitly** rather
than quietly preferring one. A ticket that disagrees with itself is exactly
what the person doing the work needs to be told.

Mentions of Key inside updates are already handled in step 3 — this is about
capturing the surrounding thread as _context_ on the item, not creating another
inbox entry for it.

### 5. Report

Summarise in the chat, grouped as: **needs action now**, **waiting on
someone else**, **closed upstream, no action**. Lead with anything overdue.
Don't just say "synced N items."

State per item **how many assets were attached and how many updates were folded
in**, and call out any asset that was found but could NOT be stored (auth,
size, unsupported type). A silent miss sends Key back to the board for exactly
the file the sync was meant to save him fetching.

## PUSH: PIP → monday

**Every monday write needs explicit confirmation from Key in chat, per change.**
Posting a comment or flipping a status is visible to colleagues and clients —
it is not reversible by you. Show the exact item, the exact new value or the
exact comment text, and wait for a clear yes. Approval for one item is not
approval for the rest.

Never push:

- anything whose PIP id doesn't start with `monday-` (it didn't come from there)
- a status you inferred rather than one Key stated
- a reply drafted from your own assumptions about what happened

Procedure:

1. Read PIP for changes since the last sync — resolved inbox items and
   completed tasks whose ids start with `monday-`.
2. Recover the monday id by stripping the prefix.
3. Present the proposed changes as a list and ask which to apply.
4. For each approved one:
   - status change → `change_item_column_values`
   - reply to a tag/comment → `create_update`
5. Report what actually landed. If a write fails, say so — don't retry silently.

## Other sources

PIP is the aggregation point, not a monday mirror. ADO isn't reachable from
here and some of Key's work is personal and on no board at all. Those arrive
as `sourceType: "ado"` / `"manual"` / `"chat"` with a non-`monday-` id prefix
(e.g. `ado-12345`) and are created the same way — `pip-upsert.js` is
source-agnostic. PUSH ignores them by design.

## Cadence

Good default: PULL at the start of the day, PUSH at the end. `clu3-pulse.js`
already surfaces what's stale/overdue in between, so this skill doesn't need
to run on a timer.
