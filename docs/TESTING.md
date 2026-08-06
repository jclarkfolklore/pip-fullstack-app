# Testing

## Running

```
npm test              # unit + integration — fast, no browser, no build needed
npm run test:e2e      # real browser against a real server (needs npm run build)
npm run test:mutation # verifies the suite can actually fail
npm run test:touch    # mobile touch scrolling
npm run lint          # correctness only
npm run format:check  # Prettier
npm run test:all      # lint + format + unit + e2e
```

`npm test` is the one to run constantly — it finishes in about a second.
Everything else is slower and belongs before a commit rather than on save.

## How it's built

**Framework: `node:test`, no test dependencies.** The awkward part is that
`server/` is CommonJS while `src/` is ESM bundled by webpack, and Node parses
`src/lib/*.js` as CJS unless told otherwise. A nested `src/package.json`
containing `{"type": "module"}` solves it. Vitest would also have solved it, at
the cost of a dependency tree and a config file, and nothing else it offers is
needed here.

**Real SQLite, never mocks.** `tests/helpers/db.mjs` gives each test a
throwaway database via the existing `PIP_DB_PATH` override. This is deliberate:
the bugs worth catching are in migration ordering, CHECK constraints and
cascade behaviour, and a mock reproduces all three incorrectly by construction.

One subtlety in the helper — `schema.js` is deliberately **not** cleared from
the require cache between tests. It holds no database handle, and keeping it
cached is what allows a test to mutate `MIGRATIONS` to simulate a broken
migration. Clearing it would hand `db.js` a pristine copy and the simulation
would silently do nothing.

## What's covered, and why those things

Ordered by (likelihood × silence × cost) — how likely it is to break, how
quietly it breaks, and how expensive the damage is.

| Area               | Tests | Why it ranks                                                                      |
| ------------------ | ----- | --------------------------------------------------------------------------------- |
| Migrations         | 10    | Broke startup once. Silent on fresh databases, so local dev never sees it.        |
| Attachments        | 12    | Polymorphic reference — SQLite can't cascade, so every guarantee is hand-written. |
| Clu3 engine        | 17    | Generative: a wrong result still renders as a plausible cat.                      |
| Workflows          | 10    | Where assumptions _between_ functions break.                                      |
| Inactive semantics | 8     | The same exclusion repeated in ten places.                                        |
| `activity_log`     | 6     | A missed log corrupts history permanently and invisibly.                          |
| Search / snapshot  | 8     | Both drift silently when something new is added.                                  |
| E2E                | 21    | Whether any of it actually works in a browser.                                    |
| Asset ingest       | 8     | Idempotency a skill can only promise in prose.                                    |
| Skills             | 7     | Whether a skill's claims are still true.                                          |

## Conventions

**Test behaviour, not implementation.** The `activity_log` tests run the
mutation and read the table rather than grepping for `logEvent` — a call can
exist in a file and not fire on the path taken.

**Encode intent, not uniformity.** Not everything should log: Clu3 messages are
chrome, widget layout is UI config. The tests assert the _intended_ set, so
they'd fail if Clu3 started logging too. "Everything logs" would be wrong in
both directions.

**Compare sources of truth to each other.** The attachment test reads the CHECK
constraint out of `sqlite_master` and compares it to the repo's `ENTITY_TYPES`
rather than restating either. Those two drifted once already; restating them
would just add a third place to forget.

**Never assert art.** "Pose 42 looks sad" isn't a test — a deliberate redesign
would fail it while being better. Structure is fair game: every pose a combo
references exists, every grid is rectangular, every mood produces drawable
layers.

**Always test the mirror case.** "Held items aren't stale" passes trivially if
staleness is broken for everything, so there's a matching test that a live item
_is_ stale.

## Mutation checking

`npm run test:mutation` breaks the code in six specific ways and fails if the
suite stays green. A passing suite proves nothing on its own — tests that
assert the wrong thing are also green.

It earned this on the first run: the index-ordering test was passing for the
wrong reason. Its fixture had no `journal_entries` table, so `SCHEMA_SQL`
created it complete with the column the index needed. The real bug requires a
database where that table already exists _without_ it. The test looked correct,
passed, and protected nothing.

When a mutation's anchor text no longer matches, that counts as a **failure**,
not a skip — a stale check silently protects nothing.

## Migrations

No migration tool (umzug, db-migrate, Knex were considered). They standardise
the runner, but the failure actually hit was ordering between `SCHEMA_SQL` and
`MIGRATIONS` — a property of this codebase's design that no tool addresses.
The runner in `server/db.js` was hardened instead:

- **Per-version transaction.** A failure rolls the whole version back rather
  than leaving a shape matching no version.
- **Narrow tolerance list.** Only genuinely idempotent errors (duplicate
  column, already exists) are ignored. Previously _every_ error was caught and
  the version stamped as applied regardless — a half-applied migration recorded
  as complete, which is the most dangerous thing that can happen here.
- **`schema_migrations` table.** Version, checksum and timestamp per migration,
  with a warning if an already-applied migration is later edited.

### Adding one

1. Append `{version, statements[]}` to `MIGRATIONS` and bump `SCHEMA_VERSION`.
   A test asserts these stay in step.
2. Update `SCHEMA_SQL` to match, so fresh databases get the same shape. A test
   compares a migrated database against a fresh one.
3. Indexes go in `SCHEMA_INDEXES`, which runs _after_ migrations.
4. Never edit an applied migration — the checksum will warn, and two databases
   claiming the same version can end up different shapes.

## Testing skills

A skill is a prompt, so it can never be deterministic the way a function is —
the model's interpretation is not testable. But most of what actually goes
wrong with one isn't interpretation. It's the skill confidently referencing a
script that was renamed, an endpoint that moved, or a snippet that stopped
working, and those are all checkable. Two levers:

**Move mechanical work into scripts.** Anything a skill describes step by step
is work that drifts. `scripts/pip-ingest-assets.js` replaced roughly a page of
prose about attaching and inlining images; the skill now says "run this", and
`tests/ingest-assets.test.mjs` pins behaviour prose could only hope for —
idempotency, validate-before-write, rejecting a caption that's just a filename.

**Test the seam** (`tests/skills.test.mjs`). Every referenced path exists,
every referenced endpoint is mounted, frontmatter matches the directory, and
the JS snippets embedded in the markdown are _executed against fixtures_ — not
merely parsed. That last one immediately caught a real bug in `ado-sync`: the
discussion extractor called `d.replace(...)` without assigning the result, so
every extracted comment kept its editor boilerplate. The snippet read correctly
and had been wrong since it was written.

## Adding tests

Put integration tests in `tests/*.test.mjs` and use `withDb()`. Put browser
tests in `tests/e2e/*.e2e.mjs`. If you're testing something that has broken
before, add a matching entry to `scripts/pip-mutation-check.js` — that's what
proves the new test actually works.
