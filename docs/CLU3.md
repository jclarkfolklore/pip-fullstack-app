# Clu3

Clu3 is the cat in the top-right panel: an ambient, emotive companion that
reflects the state of the workspace back at you with a scene, a line, and
sometimes a link into the app.

**Clu3 is not a chatbot.** There is no conversation, no input box, no LLM call
in the loop. Clu3 is a rules engine plus a message queue plus a sprite stage.

This file is the contract for extending them. If you're a Claude session
picking this up: **improving Clu3 is expected to be an ongoing job**, and
almost everything you'll want to change is declarative data, not mechanism.

## Architecture

```
server/clu3/signals.js   senses  — DB -> a flat bag of FACTS (tunable
                                    thresholds at the top of the file)
server/clu3/rules.js     content — declarative observations: when to speak,
                                    what mood, what to say, where to link
server/clu3/engine.js    mechanism — pure: signals + rules -> one expression.
                                    Tone gating and line rotation live here.
server/repo/clu3Repo.js  composition — reads DB/tone/queue, calls the engine
server/routes/clu3.js    HTTP

src/lib/sprites.js       engine  — pixel grid layers -> one SVG stage
src/lib/clu3Atlas.js     art     — every sprite: cat, room, props, symbols
src/lib/clu3Scenes.js    content — mood -> a staged scene
src/lib/faces.js         art     — the detailed 16x16 close-up ('face' mode)
src/app/clu3Panel.js     the panel + update loop
```

The split that matters: **mechanism changes rarely, content changes often.**
`rules.js`, `clu3Atlas.js` and `clu3Scenes.js` are the files you'll actually
edit. Touching `engine.js` or `sprites.js` usually means you're adding a new
_capability_, not new behaviour.

## How the expression is chosen

1. If an authored message is pending (see below), that wins outright.
2. Otherwise every rule whose `minTone` the current tone setting allows is
   evaluated; the highest-`priority` match wins.
3. The winning rule's `lines` array is rotated on a slow timer (~45s) so Clu3
   doesn't read as a static label.
4. `rules.js` ends with a `priority: 0` catch-all, so there is always a match.

Mood is **never** faked. `energy` gives Clu3 momentum — it decays when you step
away and recovers when you engage — but it's computed from a recency-weighted
window of real `activity_log` events, so it behaves like an inner state while
remaining a pure function of things that actually happened.

## Adding an observation

Append to `RULES` in `server/clu3/rules.js`:

```js
{
  id: 'my-thing',            // stable; also seeds line rotation
  priority: 50,              // higher wins
  minTone: 'balanced',       // 'sparse' | 'balanced' | 'chatty'
  when: (s) => s.tasks.overdue > 2,
  mood: 'concerned',         // or (s) => 'concerned'
  lines: [
    (s) => `${s.tasks.overdue} past due.`,
    () => `Want to triage?`
  ],
  action: { kind: 'tasks', label: 'TASKS' }   // optional; routes to a widget
}
```

`action.kind` must be a registered widget kind (`src/app/widgetRegistry.js`).

**Voice:** warm, brief, a little playful. Offers rather than orders — "want to
look?" not "do this now." Never guilt-trip, never manufacture urgency, never
use emoji (the global no-emoji rule applies; the sprites carry the feeling).
Lines want to fit ~50 characters.

Check your work without a browser:

```bash
curl -s localhost:4288/api/clu3 | python3 -m json.tool
```

The response includes `ruleId` and the whole `signals` bag, so you can see
exactly why Clu3 said what it said.

## Adding a mood

1. `MOOD_PARTS` in `src/lib/faces.js` — eyes + mouth for the close-up.
2. `SCENES` in `src/lib/clu3Scenes.js` — a staged scene.
3. `MOODS` in `server/repo/clu3Repo.js` — so the API accepts it on authored
   messages.

Miss step 3 and `POST /api/clu3/messages` will reject the mood.

## Adding art

New sprites go in `src/lib/clu3Atlas.js` as arrays of equal-length strings
(`#` is on). For sparse or repeating art use `gridFrom(w, h, points)` /
`hline(w, pattern)` from `sprites.js` — long hand-typed rows are easy to
miscount by one character.

Scenes place sprites on a **36x22** canvas, ground line at `y=20`:

```js
{ sprite: 'catSit', x: 13, y: 5, tone: 'ink', motion: 'bob' }
```

Tones: `ink` (foreground) · `dim` (set dressing) · `faint` (distant texture) ·
`cut` (opaque background fill — use this to knock holes in an ink shape, like
eyes on a dark cat; a translucent tone cannot lighten an opaque one beneath
it).

Motion is a CSS class, `pip-sp-<motion>`, defined in `src/styles/device.css` —
so animation costs nothing per frame in JS. Existing: `bob`, `sway`,
`breathe`, `float`(`-late`), `twinkle`(`-late`), `flash`(`-late`), `jitter`,
`nudge`, `pulse-soft`, `flicker`, `tick`. All are disabled under
`prefers-reduced-motion`.

The stage is a general-purpose display, not just a portrait — scenes can show
props, symbols, effects, or any useful graphic. Prefer the environment;
face-only (`mode: 'face'`) is for when expression alone is the point. The user
can toggle modes from the panel header.

## Speaking directly (the message queue)

The rules engine covers the baseline. When a session does something specific
worth mentioning, leave Clu3 a line:

```bash
curl -s -X POST localhost:4288/api/clu3/messages \
  -H 'Content-Type: application/json' \
  -d '{"body":"Split that Monday item into 3 tasks.","mood":"proud",
       "actionKind":"tasks","actionLabel":"TASKS","ttlMinutes":180}'
```

- `ttlMinutes` matters. A note about today's work should not still be on
  screen tomorrow — always set one unless it's genuinely evergreen.
- Authored messages are dismissible in the UI; rule lines aren't (they'd just
  be recomputed anyway).
- Keep the queue meaningful. This is not a notification firehose — if a rule
  could have said it, let the rule say it.

Endpoints: `GET/POST /api/clu3/messages`, `POST /api/clu3/messages/:id/dismiss`,
`DELETE /api/clu3/messages/:id`, `GET/PATCH /api/clu3/tone`.

## The workday pulse (scheduled)

`scripts/clu3-pulse.js` runs a few times across the working day (9:15am →
5:15pm, every 2 hours, weekdays) via
`scripts/com.folklore.clu3-pulse.plist`. It reads the live signal bag and
synthesises a **cross-cutting digest** — the "shape of your day" summary a
single rule can't express, because each rule speaks to one condition while the
pulse weighs everything at once and picks the most useful thing.

It stays silent when the day is unremarkable, clears its previous message
before posting, and sets a TTL shorter than the gap to the next run so a stale
digest never lingers.

Run it by hand any time:

```bash
node scripts/clu3-pulse.js
```

**Why a local launchd job and not a cloud routine:** the PIP server binds
`127.0.0.1` only, so nothing off this machine can reach the API. **Why no
LLM:** it has to be cheap, deterministic, and work offline.

To extend it, edit `composePulse()` — the ordering of its branches _is_ the
algorithm (urgency → friction → load → encouragement).

## Deliberate decisions

- **Clu3 never writes to `activity_log`.** Metrics filters by event type so it
  wouldn't skew, but `recentActivity()` doesn't — Clu3 chatter would drown
  real work history. Clu3 is chrome, not work.
- **No LLM in the render loop.** An always-on ambient panel shouldn't depend
  on a network call that can cost money, hang, or fail.
- **Tone is a user setting**, not a guess (Settings → "Clu3 — how much they
  talk"). Default `balanced`.
