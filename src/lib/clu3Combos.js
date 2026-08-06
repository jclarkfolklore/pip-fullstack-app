// Clu3's combos — the vocabulary of movement, and the web of meaning over it.
//
// A COMBO is an ordered run of poses from the sprite sheet (see
// clu3Quantize.js for the numbering, and the sheet preview button on the
// panel to look them up). Every combo here loops.
//
// The important idea: a combo has NO fixed meaning. Instead it carries
//
//   field — weighted, overlapping associations. Fuzzy on purpose. A combo is
//           allowed to be 0.8 exhausted AND 0.6 defeated AND 0.5 peaceful at
//           once, because which of those it reads as depends on what else is
//           true at the time.
//
//   axes  — continuous coordinates (valence / arousal / engagement). These
//           give combos a POSITION relative to each other, which is what lets
//           the engine find sensible neighbours it was never explicitly told
//           about. Authoring 35x35 transitions by hand would be miserable and
//           would go stale the moment a combo changed.
//
// Combo IDs describe what the BODY DOES, never what it means ('welling', not
// 'sad'). If the id carried the emotion, a fixed meaning would creep straight
// back in and the whole point would be lost. Meaning is assigned at selection
// time by clu3Sequencer, from field + live workspace context — so the same
// combo can read as content in one moment and resigned in another.
//
// Ranges came from reviewing the sheet directly: first and last frame, all
// frames between, in order. Overlapping ranges are deliberate — poses shared
// between combos are what make this a graph rather than a list.

// Inclusive range of pose numbers.
function range(from, to) {
  const out = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

// prettier-ignore
export const COMBOS = [
  { id: 'idleBreath',    poses: range(0, 4),
    field: { neutral: 0.9, calm: 0.7, present: 0.6, attentive: 0.4 },
    axes:  { valence: 0.05, arousal: -0.25, engagement: 0.1 } },

  { id: 'openUp',        poses: range(0, 10),
    field: { expressive: 0.8, talkative: 0.7, warming: 0.6, escalating: 0.5, playful: 0.5 },
    axes:  { valence: 0.35, arousal: 0.5, engagement: 0.8 } },

  { id: 'laughOut',      poses: range(5, 10),
    field: { animated: 0.8, delighted: 0.7, loud: 0.7, playful: 0.6, boisterous: 0.5 },
    axes:  { valence: 0.5, arousal: 0.75, engagement: 0.85 } },

  { id: 'lookAround',    poses: range(11, 18),
    field: { noticing: 0.7, shifting: 0.6, unsettled: 0.4, wistful: 0.4 },
    axes:  { valence: -0.05, arousal: 0.15, engagement: 0.5 } },

  { id: 'perkUp',        poses: range(14, 16),
    field: { noticing: 0.9, alert: 0.8, curious: 0.7, startled: 0.4 },
    axes:  { valence: 0.1, arousal: 0.6, engagement: 0.8 } },

  { id: 'welling',       poses: range(17, 24),
    field: { sinking: 0.8, grief: 0.7, overwhelmed: 0.7, hurt: 0.6 },
    axes:  { valence: -0.8, arousal: 0.4, engagement: -0.2 } },

  { id: 'cryToFloor',    poses: range(21, 29),
    field: { spent: 0.8, exhausted: 0.8, defeated: 0.7, surrender: 0.6 },
    axes:  { valence: -0.6, arousal: -0.2, engagement: -0.6 } },

  { id: 'flopDown',      poses: range(25, 29),
    field: { drained: 0.8, givingUp: 0.8, flopping: 0.7, resigned: 0.6 },
    axes:  { valence: -0.4, arousal: -0.4, engagement: -0.7 } },

  { id: 'lieStill',      poses: range(27, 29),
    field: { resting: 0.9, still: 0.8, asleep: 0.6, calm: 0.5, peaceful: 0.5 },
    axes:  { valence: 0.0, arousal: -0.9, engagement: -0.8 } },

  { id: 'turnAway',      poses: range(30, 35),
    field: { sulking: 0.8, withdrawn: 0.7, guarded: 0.6, irritated: 0.6 },
    axes:  { valence: -0.5, arousal: 0.3, engagement: -0.5 } },

  { id: 'nibble',        poses: range(36, 37),
    field: { selfSoothing: 0.6, distracted: 0.5, mundane: 0.5, consoling: 0.5 },
    axes:  { valence: -0.15, arousal: -0.1, engagement: 0.2 } },

  { id: 'boilUp',        poses: range(36, 43),
    field: { frustration: 0.85, struggle: 0.8, mounting: 0.7, effort: 0.7 },
    axes:  { valence: -0.55, arousal: 0.7, engagement: 0.5 } },

  { id: 'unclench',      poses: range(43, 46),
    field: { relief: 0.8, unwinding: 0.7, easing: 0.7, satisfied: 0.5 },
    axes:  { valence: 0.45, arousal: -0.2, engagement: 0.3 } },

  { id: 'cozy',          poses: range(44, 47),
    field: { content: 0.9, cozy: 0.7, warm: 0.6, sleepy: 0.5 },
    axes:  { valence: 0.6, arousal: -0.4, engagement: 0.2 } },

  { id: 'slacken',       poses: range(46, 49),
    field: { bored: 0.8, drifting: 0.7, idle: 0.7, listless: 0.5 },
    axes:  { valence: -0.05, arousal: -0.6, engagement: -0.3 } },

  { id: 'jolt',          poses: range(50, 52),
    field: { startled: 0.85, caughtOffGuard: 0.8, flustered: 0.7, bashful: 0.4 },
    axes:  { valence: 0.0, arousal: 0.85, engagement: 0.7 } },

  // 55/56 are the outline-only "ghost" frames — they read as a fade-out, which
  // is why this run ends by vanishing rather than resolving.
  { id: 'spinOut',       poses: range(53, 56),
    field: { overwhelmed: 0.8, fading: 0.8, dizzy: 0.7, dissociating: 0.6 },
    axes:  { valence: -0.5, arousal: 0.3, engagement: -0.6 } },

  { id: 'lightUp',       poses: range(57, 60),
    field: { delighted: 0.85, eager: 0.8, inviting: 0.7, affectionate: 0.7 },
    axes:  { valence: 0.85, arousal: 0.6, engagement: 0.9 } },

  { id: 'deadpanBreak',  poses: range(61, 66),
    field: { disrupted: 0.7, deadpan: 0.6, irritated: 0.6, wry: 0.5 },
    axes:  { valence: -0.3, arousal: 0.45, engagement: 0.3 } },

  { id: 'shakeItOff',    poses: range(63, 68),
    field: { recovering: 0.7, flustered: 0.6, warming: 0.6, bashful: 0.6 },
    axes:  { valence: 0.3, arousal: 0.35, engagement: 0.5 } },

  { id: 'greet',         poses: range(69, 72),
    field: { friendly: 0.8, welcoming: 0.7, casual: 0.7, easygoing: 0.6 },
    axes:  { valence: 0.6, arousal: 0.15, engagement: 0.75 } },

  { id: 'softenDown',    poses: range(73, 78),
    field: { shy: 0.7, fond: 0.6, settling: 0.6, tired: 0.5 },
    axes:  { valence: 0.35, arousal: -0.3, engagement: 0.35 } },

  { id: 'lowEbb',        poses: range(76, 81),
    field: { quiet: 0.7, muted: 0.6, gentle: 0.5, pleased: 0.4 },
    axes:  { valence: 0.2, arousal: -0.45, engagement: 0.2 } },

  { id: 'sour',          poses: range(81, 84),
    field: { souring: 0.8, disappointed: 0.7, wincing: 0.7, jolted: 0.5 },
    axes:  { valence: -0.5, arousal: 0.5, engagement: 0.4 } },

  { id: 'spikeAlarm',    poses: range(83, 86),
    field: { alarm: 0.9, escalating: 0.8, distress: 0.8, panic: 0.7 },
    axes:  { valence: -0.75, arousal: 0.9, engagement: 0.6 } },

  { id: 'crashOut',      poses: range(86, 90),
    field: { collapse: 0.8, crash: 0.8, spent: 0.7, stunned: 0.6 },
    axes:  { valence: -0.5, arousal: -0.1, engagement: -0.5 } },

  { id: 'amble',         poses: range(91, 96),
    field: { everyday: 0.8, unhurried: 0.7, atEase: 0.6, lounging: 0.6 },
    axes:  { valence: 0.25, arousal: -0.5, engagement: 0.15 } },

  { id: 'holdSteady',    poses: range(97, 100),
    field: { neutral: 0.9, plain: 0.8, steady: 0.7, waiting: 0.5 },
    axes:  { valence: 0.0, arousal: -0.2, engagement: 0.25 } },

  { id: 'flareUp',       poses: range(100, 103),
    field: { flare: 0.8, outburst: 0.7, embarrassed: 0.7, regret: 0.5 },
    axes:  { valence: -0.4, arousal: 0.7, engagement: 0.5 } },

  { id: 'sink',          poses: range(104, 105),
    field: { sad: 0.9, downcast: 0.8, quietHurt: 0.7 },
    axes:  { valence: -0.7, arousal: -0.35, engagement: -0.2 } },

  { id: 'catchSight',    poses: range(106, 107),
    field: { noticingBad: 0.75, dismay: 0.7, concern: 0.6 },
    axes:  { valence: -0.45, arousal: 0.35, engagement: 0.55 } },

  { id: 'brace',         poses: range(106, 110),
    field: { bracing: 0.8, strain: 0.8, coping: 0.7, gritted: 0.7 },
    axes:  { valence: -0.55, arousal: 0.6, engagement: 0.5 } },

  { id: 'reachOut',      poses: range(111, 112),
    field: { reaching: 0.9, striving: 0.7, yearning: 0.6, effortful: 0.6 },
    axes:  { valence: -0.05, arousal: 0.5, engagement: 0.8 } },

  { id: 'grind',         poses: range(113, 116),
    field: { enduring: 0.85, effort: 0.8, gritted: 0.8, determined: 0.6 },
    axes:  { valence: -0.35, arousal: 0.6, engagement: 0.6 } },

  { id: 'windDown',      poses: range(117, 120),
    field: { drowsy: 0.85, windingDown: 0.8, peaceful: 0.7, sated: 0.5 },
    axes:  { valence: 0.45, arousal: -0.75, engagement: -0.2 } }
];

export const COMBO_BY_ID = Object.fromEntries(COMBOS.map((c) => [c.id, c]));

// Authored transition overrides.
//
// Almost every transition is DERIVED from axis distance (see affinity below),
// so this list stays short by design: it exists only where geometry would get
// it wrong. Two cases qualify —
//
//   1. runs that share frames or continue each other's motion, where the art
//      itself implies the join (welling -> cryToFloor picks up mid-cry)
//   2. deliberate hard cuts, where the jump SHOULD feel abrupt and distance
//      would otherwise suppress it (holdSteady -> spikeAlarm)
//
// Values are affinities in 0..1 and win over the derived score.
export const EDGES = {
  welling: { cryToFloor: 0.95, sink: 0.7 },
  cryToFloor: { lieStill: 0.9, flopDown: 0.85 },
  flopDown: { lieStill: 0.95 },
  lieStill: { windDown: 0.8, amble: 0.5 },
  windDown: { lieStill: 0.85 },
  boilUp: { unclench: 0.9, grind: 0.8 },
  grind: { unclench: 0.85, brace: 0.8 },
  brace: { grind: 0.85, crashOut: 0.6 },
  unclench: { cozy: 0.9, slacken: 0.7 },
  cozy: { windDown: 0.8, slacken: 0.7 },
  jolt: { perkUp: 0.8, shakeItOff: 0.75 },
  perkUp: { lookAround: 0.85, lightUp: 0.7 },
  catchSight: { brace: 0.85, sour: 0.7 },
  sour: { spikeAlarm: 0.8 },
  spikeAlarm: { crashOut: 0.85, spinOut: 0.7 },
  crashOut: { lieStill: 0.9 },
  spinOut: { lieStill: 0.7 },
  flareUp: { turnAway: 0.75, shakeItOff: 0.7 },
  turnAway: { sink: 0.7, nibble: 0.6 },
  nibble: { amble: 0.7 },
  openUp: { laughOut: 0.95 },
  laughOut: { greet: 0.75, cozy: 0.6 },
  lightUp: { greet: 0.85, laughOut: 0.8 },
  greet: { idleBreath: 0.7, softenDown: 0.7 },
  softenDown: { lowEbb: 0.9, cozy: 0.7 },
  lowEbb: { slacken: 0.8, windDown: 0.75 },
  reachOut: { grind: 0.8, lightUp: 0.6 },
  // Hard cuts — abrupt on purpose; derived distance would bury these.
  idleBreath: { jolt: 0.6, perkUp: 0.7 },
  holdSteady: { spikeAlarm: 0.55, catchSight: 0.75 },
  amble: { slacken: 0.8, holdSteady: 0.7 }
};

const AXES = ['valence', 'arousal', 'engagement'];

// Normalised 0..1, where 1 means "same point in axis space".
function axisCloseness(a, b) {
  let sum = 0;
  for (const k of AXES) {
    const d = (a.axes[k] ?? 0) - (b.axes[k] ?? 0);
    sum += d * d;
  }
  // Max possible distance across 3 axes each spanning -1..1.
  const max = Math.sqrt(AXES.length * 4);
  return 1 - Math.sqrt(sum) / max;
}

// Cosine-ish overlap of two weighted association sets.
function fieldOverlap(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of Object.entries(a.field)) {
    na += v * v;
    if (b.field[k]) dot += v * b.field[k];
  }
  for (const v of Object.values(b.field)) nb += v * v;
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

// How natural is a -> b? Authored edges win; otherwise blend position and
// shared associations. Weighted toward position because axes were assigned
// with the transitions in mind, while fields are intentionally fuzzy.
export function affinity(a, b) {
  if (a.id === b.id) return 0;
  const authored = EDGES[a.id] && EDGES[a.id][b.id];
  if (authored !== undefined) return authored;
  return 0.65 * axisCloseness(a, b) + 0.35 * fieldOverlap(a, b);
}

// Dev guard: a bad pose number renders as a blank frame, which is easy to miss.
if (typeof console !== 'undefined') {
  const bad = COMBOS.filter((c) => c.poses.some((p) => p < 0 || p > 120));
  if (bad.length) console.warn('[clu3] combos with out-of-range poses:', bad.map((c) => c.id).join(', '));
  const unknown = Object.entries(EDGES).flatMap(([from, tos]) =>
    [from, ...Object.keys(tos)].filter((id) => !COMBO_BY_ID[id])
  );
  if (unknown.length)
    console.warn('[clu3] EDGES references unknown combos:', [...new Set(unknown)].join(', '));
}
