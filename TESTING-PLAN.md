# Testing — audit, plan, execution log

**TEMPORARY.** Working document for adding the test suite. Delete once the
work is confirmed and the durable parts have moved into `CLAUDE.md` /
`docs/TESTING.md`.

---

## 1. Audit findings

Measured, not assumed — 2026-08-06.

| Metric                        | Value                                  |
| ----------------------------- | -------------------------------------- |
| JS files (excl. build output) | 97                                     |
| Lines of code                 | 12,452                                 |
| API endpoints                 | 68 across 15 route files               |
| Repo modules                  | 11                                     |
| Mutating repo functions       | 40                                     |
| Migrations                    | 10 (v2–v11, no gaps), 36 statements    |
| Existing tests                | 1 (`pip-touch-test.js`, written today) |
| Lint / format config          | none                                   |

### 1.1 Confirmed gaps

**Three delete paths write no `activity_log` entry.**
`inboxRepo.deleteItem`, `notesRepo.deleteNote`, `tasksRepo.deleteTask` mutate
and never call `logEvent`. The creation event survives, the deletion doesn't —
so Metrics reads a deleted task as created-but-never-finished, permanently, and
"what happened to that item" is unanswerable. This is a real bug, found by the
audit rather than by use.

Of the 14 mutating functions without `logEvent`, the other 11 are correct and
should stay that way — Clu3 messages (chrome, not work history, per
`CLAUDE.md`), widget layout (UI config), and tag/file helpers that run inside
an already-logged operation. A test must encode the _intended_ set, not
"everything logs", or it will be wrong in both directions.

**`// prettier-ignore` comments exist in two files with no Prettier
configured** (`weatherArt.js`, `clu3Combos.js`). They currently protect
hand-aligned pixel grids from a formatter that isn't running. Whatever
formatter lands must honour them, or the art gets reflowed into noise.

### 1.2 Confirmed healthy

Worth stating, because these are the places I expected to find rot:

- **Attachment cleanup**: all five delete paths call `deleteForEntity`.
  The reference is polymorphic so SQLite cannot cascade — the guarantee is
  entirely in the repo layer, and it currently holds.
- **Inactive exclusion**: consistent across `inboxRepo` (7 sites) and
  `clu3/signals.js` (3 sites).
- **Search shaping**: `search()` and `searchIndex()` both go through one
  `SOURCES` array and one `collect()`. No duplication to drift.
- **Migrations**: contiguous v2–v11, and indexes now run after migrations
  (fixed today).

### 1.3 Risk ranking

What actually breaks, ordered by (likelihood × silence × cost):

| #   | Risk                            | Why it ranks here                                                      |
| --- | ------------------------------- | ---------------------------------------------------------------------- |
| 1   | Migration breaks an existing DB | Killed startup today. Silent on fresh DBs, so local dev never sees it. |
| 2   | Mutation stops logging          | Corrupts history permanently. Nothing surfaces it.                     |
| 3   | Attachment orphans              | No FK cascade; one missed call leaks files forever.                    |
| 4   | Inactive leaks into counts      | Enforced in 10 separate places.                                        |
| 5   | Snapshot drift                  | New endpoint not in `ENDPOINTS` → silently broken demo.                |
| 6   | Clu3 non-determinism            | Built to be deterministic, never verified.                             |
| 7   | Mobile scroll regression        | Happened today. Passes computed-style checks.                          |
| 8   | Search parity                   | Shared today — a test locks that in.                                   |

---

## 2. Strategy

### 2.1 Framework — `node:test`, zero new dependencies

The complication: `server/` is CommonJS, `src/` is ESM-syntax bundled by
webpack, and `package.json` declares no `type`. Node therefore parses
`src/lib/*.js` as CJS and refuses the `import` statements.

**Approach:** add `src/package.json` containing `{"type": "module"}`. A nested
package.json scoping one directory as ESM is a standard Node mechanism, costs
nothing, and lets `node:test` import the frontend's pure modules directly.

Chosen over Vitest because the only thing Vitest buys here is that resolution,
and it costs a dependency tree plus a config file. **Verify the webpack build
still passes immediately after adding it** — if it breaks, fall back to Vitest
and record why here.

### 2.2 Test database

`PIP_DB_PATH` already exists as an override. Each integration test gets a
throwaway SQLite file, so tests run against **real SQLite** rather than mocks.
That matters: the bugs found today were in migration ordering and cascade
behaviour, neither of which a mock reproduces.

### 2.3 Scope

**Test:** data integrity, lifecycle workflows, pure logic, and the interactions
that have already regressed once.

**Don't test:** pixel grids, scene composition, exact copy. Asserting art is
churn — a deliberate redesign would "fail" while looking better. The one
exception is _structural_ checks that catch real breakage: grid rectangularity,
and every mood resolving to drawable art.

---

## 3. Plan

Six phases. Each ends green before the next starts.

| Phase | Content                                                        | Layer    |
| ----- | -------------------------------------------------------------- | -------- |
| 0     | ESM resolution spike + build verification                      | infra    |
| 1     | Harness: temp-DB helper, fixtures, `npm test`                  | infra    |
| 2     | Data integrity — migrations, logging, attachments, inactive    | server   |
| 3     | Workflows — lifecycles, sync idempotency, snapshot             | server   |
| 4     | Pure logic — Clu3 engine, quantize, frontmatter, search parity | frontend |
| 5     | Migration hardening — transactional, fail-loud, checksummed    | server   |
| 6     | E2E — real browser against a real server                       | e2e      |
| 7     | Lint + format, honouring `prettier-ignore`                     | tooling  |
| 8     | Quality gate + docs                                            | —        |

### Phase 5 — why hardening rather than a migration tool

Evaluated umzug, db-migrate and Knex. **Recommendation: no tool.** They
standardise the _runner_, but the failure we actually hit today was ordering
between `SCHEMA_SQL` and `MIGRATIONS` — a property of this codebase's design
that no tool addresses, and which a test already covers.

The current runner does have three genuine defects, all fixable in ~50 lines:

1. **A blanket `try/catch` swallows every error, then stamps the version as
   applied anyway.** A half-applied migration is recorded as complete. This is
   the most dangerous thing in the data layer.
2. **No transaction.** A version that fails partway leaves the database in a
   state matching no version.
3. **No record of what ran.** A single integer can't distinguish "v9 applied
   cleanly" from "v9 threw four errors that were ignored", and an edited
   already-applied migration goes unnoticed.

Fix: per-version transaction, an explicit narrow list of tolerated
(genuinely idempotent) errors instead of catching everything, a
`schema_migrations` table recording version + checksum + timestamp, and a loud
warning if an applied migration's checksum changes.

### Phase 2 detail — the highest-value tests

- **Migrations**: build a DB at each historical version, migrate, assert final
  shape matches a fresh `SCHEMA_SQL` build. Assert idempotency by running
  twice. This is the #1 risk and the test that would have caught today's bug.
- **Logging contract**: assert the _intended_ logging set (see 1.1) rather than
  "all mutations log". Will fail on the three delete paths — that's the point;
  fix them as part of this phase.
- **Attachments**: delete each parent type, assert rows and files both gone;
  assert `sweepOrphans` catches a manually orphaned row.
- **Inactive**: held item excluded from `stageCounts`, staleness, Clu3 signals,
  and stage filters.

---

## 4. Execution log

Appended as work lands. `-` pending, `~` in progress, `x` done.

- [x] Phase 0 — ESM spike. `src/package.json` with `{"type":"module"}` works;
      webpack build and CJS server both unaffected. **Zero new dependencies** —
      Vitest not needed.
- [x] Phase 1 — harness. `tests/helpers/db.mjs` (temp DB per test via
      `PIP_DB_PATH` + require-cache clearing), 4 self-tests proving isolation.
      `npm test` / `npm run test:watch` added.
- [x] Phase 2 — data integrity
  - [x] migrations (6 tests) — incl. direct regression test for today's
        index-before-migration startup bug
  - [x] activity_log contract (6 tests) — **exposed and fixed 3 real bugs**:
        `deleteTask`, `deleteNote`, `deleteItem` wrote no log entry, so deleted
        work vanished from history. Now log, capturing the title _before_
        deleting so the entry is useful.
  - [x] attachments (12 tests) — all 5 parents delete rows AND files; sweep
        finds orphans and spares live rows; repo ENTITY_TYPES compared
        _directly against the DB CHECK_ rather than restating it, since those
        two drifted once already; unreachable image degrades to a link.
  - [x] inactive semantics (8 tests) — held items excluded from counts,
        filters, and Clu3 signals; sort last under every sort; stage untouched
        by the hold; reactivate restores the original stage. Includes the
        mirror case (a live item IS pending/stale) so the exclusions can't
        pass by the signal being broken for everything.
        **Phase 2 total: 32 tests.**
- [ ] Phase 3 — workflows
- [ ] Phase 4 — pure logic
- [x] Phase 3 — workflows (10 tests)
- [x] Phase 4 — pure logic: Clu3 engine (17), search parity + snapshot drift +
      frontmatter (8). **Exposed a 4th real bug**: clu3Quantize's JSON import
      lacked the spec-required `with { type: 'json' }`. Webpack tolerates its
      absence, so the module simply could not load outside the bundler.
- [x] Phase 5 — migration hardening. No tool (see rationale above). Runner is
      now transactional, fails loudly on non-idempotent errors, and records
      version + checksum in `schema_migrations`, backfilled for the live DB.
- [x] Phase 6 — E2E (21 tests): real Chrome, real server, throwaway seeded DB.
- [x] Phase 7 — lint + format. Zero errors. Found and removed 5 pieces of dead
      code; checked `activeModule` in case it meant a missing destroy() (it
      didn't). Formatting landed as its own commit; verified the pixel art
      survived by hashing the combo pose sequences.
- [x] Phase 8 — quality gate. ALL CRITERIA MET, including the important one:
      `npm run test:mutation` breaks the code 6 ways and all 6 are caught.
      **It immediately found a test passing for the wrong reason** — the
      index-ordering fixture had no `journal_entries` table, so SCHEMA_SQL
      created it complete and the index never had the chance to fail. Fixture
      corrected to a v10 shape where the table predates the column.

---

## 5. Quality gate

Before this file is deleted, all of:

1. `npm test` green from a clean checkout
2. `npm run lint` and `npm run format:check` green
3. Every bug the suite exposed is fixed, or recorded as a known gap
4. A deliberately introduced regression is caught (verify the tests actually
   fail — a suite that can't fail proves nothing)
5. Durable content moved to `docs/TESTING.md` + `CLAUDE.md`
6. `TESTING-PLAN.md` deleted
