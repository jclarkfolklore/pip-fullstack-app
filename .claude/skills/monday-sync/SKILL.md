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
query { boards(limit: 100, state: active, order_by: used_at) {
  id name type columns(types: [people]) { id } } }
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
- **`state`** is the state *in monday*, not what you wish it were. Pass
  `"done"` for anything Done/closed upstream — the script resolves or completes
  it locally so PIP never shows fake open work.
- **`kind`**: `task` for something Key does, `inbox` for something needing
  triage or a reply (mentions are almost always `inbox`).
- **`project`** by client name (e.g. `Best Buy`, `Inspire`, `WildFire`) —
  created on demand.
- `sourceType: "monday"`, and always set `sourceUrl` to the pulse URL.
- Tag mentions with `mention` so they're filterable in PIP.

### 5. Report

Summarise in the chat, grouped as: **needs action now**, **waiting on
someone else**, **closed upstream, no action**. Lead with anything overdue.
Don't just say "synced N items."

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
