// Narrative — the layer that decides what STORY Clu3 is telling.
//
// A mood is a single point; a story has shape. "Overdue work" as a mood is one
// alarmed expression held forever. As a story it's: sitting quietly, catching
// sight of something, the alarm landing, then bracing into it — which is both
// more legible and more watchable, and it's what the sprite sheet is actually
// good at.
//
// The split that makes this work:
//
//   SHAPE is structural and context-free. An arc says "start low, spike at
//   beat three, don't resolve" as a trajectory of offsets through axis space.
//   It knows nothing about inboxes.
//
//   CONTENT is contextual. The workspace supplies a base context (roughly:
//   how things are), and the arc bends it beat by beat.
//
// So the same arc tells a different story depending on the day, and the same
// situation can be told with different arcs. Neither is hardcoded to the
// other. Beats are then filled by clu3Sequencer, which picks a combo (or
// improvises a run) matching each beat's bent context.

const AXES = ['valence', 'arousal', 'engagement'];

function clamp(v) {
  return Math.max(-1, Math.min(1, v));
}

// Apply a beat's offsets to the base context, merging any tag emphasis.
function bend(base, beat) {
  const axes = {};
  for (const k of AXES) axes[k] = clamp((base.axes?.[k] ?? 0) + (beat.d?.[k] ?? 0));
  const tags = { ...(base.tags || {}) };
  for (const [tag, weight] of Object.entries(beat.tags || {})) {
    tags[tag] = Math.max(tags[tag] || 0, weight);
  }
  return { axes, tags, role: beat.role };
}

// Arc shapes. `d` offsets the base axes for that beat; `tags` emphasises
// associations the beat needs regardless of the base. `hold` scales how long
// the beat lingers (1 = normal).
//
// Not every story resolves — `unresolved: true` marks arcs that deliberately
// end mid-tension, which is the honest shape for a problem that hasn't gone
// away just because Clu3 finished emoting about it.
export const ARCS = {
  // Nothing is happening, and that's fine.
  quiet: {
    beats: [
      { role: 'settle', d: { arousal: -0.15 }, hold: 1.2 },
      { role: 'drift', d: { arousal: -0.4, engagement: -0.3 }, tags: { drifting: 0.7 }, hold: 1.4 },
      { role: 'rest', d: { arousal: -0.6, engagement: -0.4 }, tags: { resting: 0.8, peaceful: 0.5 }, hold: 1.6 }
    ]
  },

  // Something new turned up.
  arrival: {
    beats: [
      { role: 'before', d: { arousal: -0.3, engagement: -0.2 }, hold: 1.1 },
      { role: 'notice', d: { arousal: 0.55, engagement: 0.5 }, tags: { noticing: 1, alert: 0.8 }, hold: 0.7 },
      { role: 'react', d: {}, hold: 1 },
      { role: 'settle', d: { arousal: -0.3 }, hold: 1.2 }
    ]
  },

  // Something got finished.
  accomplishment: {
    beats: [
      { role: 'before', d: { arousal: -0.1 }, hold: 0.9 },
      { role: 'recognise', d: { valence: 0.3, arousal: 0.4, engagement: 0.4 }, tags: { noticing: 0.7 }, hold: 0.8 },
      { role: 'delight', d: { valence: 0.5, arousal: 0.45, engagement: 0.5 }, tags: { delighted: 1, satisfied: 0.8 }, hold: 1.1 },
      { role: 'settle', d: { valence: 0.25, arousal: -0.35 }, tags: { content: 0.8, relief: 0.6 }, hold: 1.4 }
    ]
  },

  // Things slipped while you weren't looking. Ends braced, not resolved.
  deterioration: {
    unresolved: true,
    beats: [
      { role: 'unaware', d: { arousal: -0.25, engagement: -0.1 }, hold: 1.1 },
      { role: 'catchSight', d: { valence: -0.4, arousal: 0.4, engagement: 0.4 }, tags: { noticingBad: 1, dismay: 0.7 }, hold: 0.7 },
      { role: 'alarm', d: { valence: -0.6, arousal: 0.7, engagement: 0.4 }, tags: { alarm: 1, distress: 0.7 }, hold: 0.8 },
      { role: 'brace', d: { valence: -0.35, arousal: 0.3 }, tags: { bracing: 0.9, gritted: 0.7 }, hold: 1.3 }
    ]
  },

  // Ongoing effort with no end in sight.
  grind: {
    unresolved: true,
    beats: [
      { role: 'dig-in', d: { arousal: 0.35, engagement: 0.4 }, tags: { effort: 0.9, striving: 0.7 }, hold: 1 },
      { role: 'strain', d: { valence: -0.3, arousal: 0.5 }, tags: { enduring: 1, gritted: 0.8 }, hold: 1.1 },
      { role: 'weary', d: { valence: -0.2, arousal: -0.25 }, tags: { tired: 0.8, spent: 0.6 }, hold: 1.3 }
    ]
  },

  // Tension letting go.
  recovery: {
    beats: [
      { role: 'held', d: { valence: -0.3, arousal: 0.45 }, tags: { gritted: 0.8, effort: 0.7 }, hold: 0.9 },
      { role: 'release', d: { valence: 0.35, arousal: -0.2 }, tags: { relief: 1, unwinding: 0.8 }, hold: 1.1 },
      { role: 'ease', d: { valence: 0.4, arousal: -0.5 }, tags: { content: 0.8, cozy: 0.6 }, hold: 1.4 }
    ]
  },

  // Reaching for your attention.
  appeal: {
    beats: [
      { role: 'wait', d: { arousal: -0.2 }, hold: 1 },
      { role: 'reach', d: { arousal: 0.45, engagement: 0.7 }, tags: { reaching: 1, inviting: 0.7 }, hold: 0.9 },
      { role: 'hope', d: { valence: 0.3, engagement: 0.6 }, tags: { eager: 0.8, hopeful: 0.7 }, hold: 1 },
      { role: 'relent', d: { arousal: -0.3, engagement: -0.3 }, hold: 1.2 }
    ]
  },

  // Something small and sudden, over as fast as it started.
  blip: {
    beats: [
      { role: 'calm', d: { arousal: -0.2 }, hold: 1.1 },
      { role: 'startle', d: { arousal: 0.8, engagement: 0.5 }, tags: { startled: 1, caughtOffGuard: 0.8 }, hold: 0.5 },
      { role: 'recover', d: { arousal: -0.1 }, tags: { recovering: 0.8, flustered: 0.5 }, hold: 1 }
    ]
  },

  // Fed up and turning away from it.
  withdrawal: {
    unresolved: true,
    beats: [
      { role: 'endure', d: { valence: -0.3, arousal: 0.3 }, tags: { irritated: 0.8 }, hold: 0.9 },
      { role: 'flare', d: { valence: -0.45, arousal: 0.6 }, tags: { flare: 0.9, outburst: 0.7 }, hold: 0.7 },
      { role: 'turn-away', d: { valence: -0.3, engagement: -0.6 }, tags: { withdrawn: 1, sulking: 0.8 }, hold: 1.3 }
    ]
  }
};

// Which arcs suit which mood, when the workspace gives no stronger signal.
// Several per mood on purpose — the same standing state shouldn't always be
// narrated the same way.
const MOOD_ARCS = {
  content: ['quiet', 'accomplishment', 'recovery'],
  happy: ['accomplishment', 'appeal', 'blip'],
  proud: ['accomplishment', 'recovery'],
  curious: ['arrival', 'appeal', 'blip'],
  busy: ['grind', 'arrival', 'recovery'],
  concerned: ['deterioration', 'grind', 'appeal'],
  alarmed: ['deterioration', 'blip', 'withdrawal'],
  sleepy: ['quiet', 'recovery']
};

// `change` describes what actually HAPPENED, and outranks the standing mood
// when present — a story is about events, not states. Fields are all
// optional, so this degrades gracefully to mood-only until the server-side
// signals are wired through.
export function chooseArc({ mood = 'content', change = {} } = {}) {
  if (change.wentOverdue) return 'deterioration';
  if (change.completed) return 'accomplishment';
  if (change.arrived) return 'arrival';
  if (change.longIdle) return 'appeal';
  if (change.released) return 'recovery';

  const options = MOOD_ARCS[mood] || MOOD_ARCS.content;
  return options[Math.floor(Math.random() * options.length)];
}

// Turn an arc shape plus a base context into concrete per-beat contexts.
export function buildArc(arcId, base) {
  const arc = ARCS[arcId] || ARCS.quiet;
  return {
    id: arcId,
    unresolved: !!arc.unresolved,
    beats: arc.beats.map((b) => ({ ...bend(base, b), hold: b.hold ?? 1 }))
  };
}

export function arcIds() {
  return Object.keys(ARCS);
}
