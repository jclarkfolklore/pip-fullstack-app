// Clu3's personality, as data.
//
// THIS IS THE FILE TO EDIT when Clu3 should notice something new or say
// something better. Adding an observation means appending one object here —
// no engine changes. See docs/CLU3.md for the full contract.
//
// Each rule:
//   id       unique, stable (used for line rotation + debugging)
//   priority higher wins; first match after sorting is what Clu3 expresses
//   minTone  lowest tone setting at which this rule may speak:
//              'sparse'   -> always eligible (things that genuinely matter)
//              'balanced' -> default level and above
//              'chatty'   -> only when the user has asked for company
//   when(s)  predicate over the signals bag (see signals.js)
//   mood     a mood key, or (s) => moodKey  (see src/lib/faces.js)
//   lines    array of strings or (s) => string. The engine rotates through
//            them on a slow timer so Clu3 doesn't feel like a static label.
//   action   optional { kind, label } — renders a chip that routes to a
//            widget. `kind` must be a registered widget kind.
//
// VOICE: warm, brief, a little playful. Offers rather than orders — "want to
// look?" not "do this now." Never guilt-trips, never fakes urgency, never
// uses emoji (pixel faces carry the feeling; see the global no-emoji rule).
// Lines want to fit ~50 characters — the panel is small.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const RULES = [
  // ---- things that genuinely need attention -------------------------------
  {
    id: 'overdue',
    priority: 100,
    minTone: 'sparse',
    when: (s) => s.tasks.overdue > 0,
    mood: (s) => (s.tasks.overdue >= 3 ? 'alarmed' : 'concerned'),
    lines: [
      (s) => `${plural(s.tasks.overdue, 'task is', 'tasks are')} past due.`,
      (s) => `Overdue: ${s.tasks.overdue}. Want to look?`,
      (s) =>
        s.tasks.oldestOverdue
          ? `"${s.tasks.oldestOverdue.title}" slipped by. Still on?`
          : `${s.tasks.overdue} past due — worth a peek.`
    ],
    action: { kind: 'tasks', label: 'TASKS' }
  },
  {
    id: 'stale-inbox',
    priority: 90,
    minTone: 'sparse',
    when: (s) => s.inbox.staleCount > 0,
    mood: 'concerned',
    lines: [
      (s) =>
        s.inbox.oldestStale
          ? `"${s.inbox.oldestStale.title}" has sat ${s.inbox.oldestStale.days}d.`
          : `${plural(s.inbox.staleCount, 'item', 'items')} going quiet.`,
      (s) => `${plural(s.inbox.staleCount, 'item is', 'items are')} aging in the inbox.`,
      (s) => `Some inbox items are getting dusty (${s.inbox.staleCount}).`
    ],
    action: { kind: 'inbox', label: 'INBOX' }
  },
  {
    id: 'stalled-tasks',
    priority: 85,
    minTone: 'sparse',
    when: (s) => s.tasks.stalled > 0,
    mood: 'concerned',
    lines: [
      (s) => `${plural(s.tasks.stalled, 'task has', 'tasks have')} been mid-flight a while.`,
      (s) => `Still doing ${s.tasks.stalled}? Might need a nudge.`
    ],
    action: { kind: 'tasks', label: 'TASKS' }
  },

  // ---- pressure ----------------------------------------------------------
  {
    id: 'busy-inbox',
    priority: 70,
    minTone: 'sparse',
    when: (s) => s.inbox.new >= s.thresholds.BUSY_INBOX,
    mood: 'busy',
    lines: [
      (s) => `${s.inbox.new} new in the inbox. Busy one.`,
      (s) => `Inbox is filling up — ${s.inbox.new} waiting.`,
      (s) => `${s.inbox.new} to sort through when you're ready.`
    ],
    action: { kind: 'inbox', label: 'INBOX' }
  },

  // ---- wins -------------------------------------------------------------
  {
    id: 'wins-today',
    priority: 60,
    minTone: 'balanced',
    when: (s) => s.wins.today > 0,
    mood: 'proud',
    lines: [
      (s) => `${plural(s.wins.today, 'thing', 'things')} done today. Good.`,
      (s) => `That's ${s.wins.today} cleared. I'm impressed.`,
      (s) => `${s.wins.today} down today. Keep going.`
    ],
    action: { kind: 'metrics', label: 'METRICS' }
  },
  {
    id: 'streak',
    priority: 55,
    minTone: 'balanced',
    when: (s) => s.wins.streak >= 2,
    mood: 'happy',
    lines: [
      (s) => `${s.wins.streak} days running. Nice rhythm.`,
      (s) => `Day ${s.wins.streak} of showing up.`
    ],
    action: { kind: 'metrics', label: 'METRICS' }
  },

  // ---- gentle upkeep -----------------------------------------------------
  {
    id: 'journal-gap',
    priority: 45,
    minTone: 'balanced',
    when: (s) =>
      s.journal.total > 0 &&
      s.journal.daysSinceLast !== null &&
      s.journal.daysSinceLast >= s.thresholds.JOURNAL_GAP_DAYS,
    mood: 'curious',
    lines: [
      (s) => `Journal's been quiet ${s.journal.daysSinceLast} days.`,
      () => `Anything worth writing down lately?`
    ],
    action: { kind: 'journal', label: 'JOURNAL' }
  },
  {
    id: 'first-journal',
    priority: 40,
    minTone: 'balanced',
    when: (s) => s.journal.total === 0 && !s.isEmptyWorkspace,
    mood: 'curious',
    lines: [
      () => `You've got no journal entries yet.`,
      () => `The journal's empty. Want to start one?`
    ],
    action: { kind: 'journal', label: 'JOURNAL' }
  },

  // ---- onboarding / empty ------------------------------------------------
  {
    id: 'empty-workspace',
    priority: 35,
    minTone: 'sparse',
    when: (s) => s.isEmptyWorkspace,
    mood: 'curious',
    lines: [
      () => `Nothing here yet. Hand me something?`,
      () => `Blank slate. I'm ready when you are.`,
      () => `Empty workspace. Feels full of potential.`
    ],
    action: { kind: 'inbox', label: 'INBOX' }
  },

  // ---- ambient / company (only at higher tones) --------------------------
  {
    id: 'in-flight',
    priority: 25,
    minTone: 'chatty',
    when: (s) => s.tasks.active > 0,
    mood: 'content',
    lines: [
      (s) => `${plural(s.tasks.active, 'task', 'tasks')} on the go.`,
      (s) => `Tracking ${s.tasks.active} for you.`,
      (s) => (s.tasks.doing > 0 ? `${s.tasks.doing} in progress right now.` : `${s.tasks.open} queued up.`)
    ],
    action: { kind: 'tasks', label: 'TASKS' }
  },
  {
    id: 'quiet-evening',
    priority: 20,
    minTone: 'balanced',
    when: (s) => s.isAllClear && s.hour >= s.thresholds.QUIET_HOUR,
    mood: 'sleepy',
    lines: [
      () => `All clear. Quiet night — I'll keep watch.`,
      () => `Nothing pending. Rest up.`
    ]
  },
  {
    id: 'all-clear',
    priority: 15,
    minTone: 'sparse',
    when: (s) => s.isAllClear,
    mood: 'happy',
    lines: [
      () => `Nothing pending. Nice.`,
      () => `Inbox clear, no tasks due. Enjoy it.`,
      () => `All caught up.`
    ]
  },

  // ---- fallback (must always match) --------------------------------------
  {
    id: 'idle',
    priority: 0,
    minTone: 'sparse',
    when: () => true,
    mood: 'content',
    lines: [
      (s) => `${plural(s.inbox.pending, 'item', 'items')} pending, ${s.tasks.active} active.`,
      () => `Here and watching.`,
      () => `Nothing urgent from where I sit.`
    ]
  }
];

module.exports = { RULES };
