// Turns context into movement: picks combos, chains them into phrases, and
// hands out one pose per frame.
//
// The shape of the problem: 35 combos, ~8 recurring moods, and a panel that's
// visible all day. Picking the single best-matching combo for a mood would be
// correct and unbearable — you'd see the same loop every time. So selection is
// deliberately probabilistic, and combos are strung into PHRASES (3-6 combos)
// so the same mood produces a different performance each time it comes round.
//
//   context  -> a target point in axis space + weighted tags
//   score    -> how well a combo matches that target, minus how recently it ran
//   phrase   -> a chain of combos walked across the affinity graph
//   frame    -> one pose, handed to the renderer
//
// Combo length never affects selection. A 2-pose run and a 9-pose run compete
// purely on meaning, otherwise long combos would quietly dominate simply by
// covering more ground.
//
// EVERYTHING adjustable lives in TUNING. Change numbers there rather than
// editing logic — that's the whole reason it's a single object.

import { COMBOS, COMBO_BY_ID, affinity } from './clu3Combos.js';
import { improvise } from './clu3PoseSense.js';

// Playback timing lives here rather than in the panel, so the live Clu3 and
// the sheet preview can't drift apart.
//
// One frame. Everything about how fast Clu3 reads comes off this number.
export const FRAME_MS = 456;

// A beat of stillness when one combo hands over to the next. Without it the
// frames run together and a phrase reads as one continuous twitch instead of
// a sequence of gestures — the pause is what makes the seam legible.
export const COMBO_GAP_MS = 320;

export const TUNING = {
  // How the three scoring terms trade off. Should roughly sum to 1.
  weights: {
    axis: 0.55, // closeness to the context's target point
    field: 0.3, // overlap with the context's active tags
    novelty: 0.15 // bonus for not having run recently
  },

  // Random nudge added to every score before ranking. This is what stops the
  // same combo winning every time the same context recurs. Raise for a more
  // erratic Clu3, lower for a more predictable one.
  jitter: 0.09,

  // Sample from the best N rather than always taking the winner.
  topK: 6,

  // How many combos make up one phrase.
  phrase: { min: 3, max: 6 },

  // How many times a combo loops before the phrase advances.
  dwell: { min: 2, max: 4 },

  // Combos seen in the last `memory` picks are penalised by up to `penalty`,
  // scaled by how recent they are.
  recency: { memory: 8, penalty: 0.5 },

  // Within a phrase, how much the next combo may wander from the context
  // target vs. simply following the strongest affinity edge. 0 = hug the
  // target, 1 = follow the graph wherever it leads.
  drift: 0.35,

  // Chance that a slot in a phrase is IMPROVISED — a run of poses composed on
  // the spot from what the authored combos taught (clu3PoseSense.js) rather
  // than replayed from clu3Combos.js. The authored set is a base to build on,
  // not a ceiling; this is the dial for how far past it Clu3 goes.
  //   0    only authored combos
  //   0.35 mostly familiar, occasionally something new  (default)
  //   1    every slot invented
  improvisation: 0.35,

  // Shape of an improvised run. `flow` trades "these frames animate together"
  // (learned adjacency) against "these frames suit the mood" — high values
  // look smoother, low values are more expressive but can twitch.
  improv: { minLength: 3, maxLength: 7, flow: 0.6 }
};

const AXES = ['valence', 'arousal', 'engagement'];

// Target points for the moods the rules engine already produces, so wiring
// this up is "feed me the mood" rather than "rewrite the rules engine".
// Tags are soft hints — they bias selection without pinning it to one combo.
export const MOOD_CONTEXT = {
  content: { axes: { valence: 0.35, arousal: -0.35, engagement: 0.2 }, tags: { content: 1, calm: 0.8, atEase: 0.6 } },
  happy: { axes: { valence: 0.7, arousal: 0.45, engagement: 0.75 }, tags: { delighted: 1, playful: 0.7, friendly: 0.7 } },
  proud: { axes: { valence: 0.7, arousal: 0.3, engagement: 0.6 }, tags: { satisfied: 1, relief: 0.7, warm: 0.5 } },
  curious: { axes: { valence: 0.15, arousal: 0.55, engagement: 0.8 }, tags: { noticing: 1, alert: 0.8, curious: 0.9 } },
  busy: { axes: { valence: -0.2, arousal: 0.6, engagement: 0.6 }, tags: { effort: 1, striving: 0.7, enduring: 0.6 } },
  concerned: { axes: { valence: -0.5, arousal: 0.4, engagement: 0.45 }, tags: { concern: 1, bracing: 0.7, dismay: 0.6 } },
  alarmed: { axes: { valence: -0.75, arousal: 0.85, engagement: 0.6 }, tags: { alarm: 1, distress: 0.8, panic: 0.7 } },
  sleepy: { axes: { valence: 0.2, arousal: -0.8, engagement: -0.4 }, tags: { drowsy: 1, resting: 0.9, peaceful: 0.6 } }
};

export function contextForMood(mood) {
  return MOOD_CONTEXT[mood] || MOOD_CONTEXT.content;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function axisCloseness(comboAxes, targetAxes) {
  let sum = 0;
  for (const k of AXES) {
    const d = (comboAxes[k] ?? 0) - (targetAxes[k] ?? 0);
    sum += d * d;
  }
  return 1 - Math.sqrt(sum) / Math.sqrt(AXES.length * 4);
}

// How much of the context's active tags this combo's field covers. Normalised
// by the CONTEXT's weight total, not the combo's — otherwise a combo with a
// long field would score lower just for being descriptive.
function tagMatch(combo, tags) {
  let hit = 0;
  let total = 0;
  for (const [tag, weight] of Object.entries(tags || {})) {
    total += weight;
    if (combo.field[tag]) hit += weight * combo.field[tag];
  }
  return total ? hit / total : 0;
}

function noveltyFor(comboId, recent) {
  const idx = recent.indexOf(comboId);
  if (idx === -1) return 1;
  // idx 0 is the most recent pick, so it takes the full penalty.
  const staleness = idx / Math.max(1, recent.length);
  return 1 - TUNING.recency.penalty * (1 - staleness);
}

export function scoreCombo(combo, context, recent = []) {
  const { weights, jitter } = TUNING;
  const a = axisCloseness(combo.axes, context.axes || {});
  const f = tagMatch(combo, context.tags);
  const n = noveltyFor(combo.id, recent);
  const base = weights.axis * a + weights.field * f + weights.novelty * n;
  return base + (Math.random() - 0.5) * 2 * jitter;
}

// Weighted pick from the top-K scorers — not argmax, so the same context
// yields different performances.
export function pickCombo(context, recent = [], exclude = new Set()) {
  const ranked = COMBOS.filter((c) => !exclude.has(c.id))
    .map((c) => ({ combo: c, score: scoreCombo(c, context, recent) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TUNING.topK);

  if (!ranked.length) return COMBOS[0];

  const floor = Math.min(...ranked.map((r) => r.score));
  const shifted = ranked.map((r) => ({ ...r, w: Math.max(0.0001, r.score - floor + 0.05) }));
  const total = shifted.reduce((sum, r) => sum + r.w, 0);

  let roll = Math.random() * total;
  for (const r of shifted) {
    roll -= r.w;
    if (roll <= 0) return r.combo;
  }
  return shifted[shifted.length - 1].combo;
}

let improvCount = 0;

// Wraps an improvised run so it presents the same surface as an authored
// combo — everything downstream treats the two identically.
function improvisedCombo(context) {
  const run = improvise(context, TUNING.improv);
  if (!run || !run.poses.length) return null;
  improvCount += 1;
  return {
    id: `improv-${improvCount}`,
    improvised: true,
    poses: run.poses,
    field: run.field,
    axes: run.axes
  };
}

// A phrase is a walk across the affinity graph, pulled toward the context.
// `drift` decides how much each step follows the art's own connections versus
// snapping back to what the context wants; `improvisation` decides how often a
// step is invented instead of recalled.
export function buildPhrase(context, recent = []) {
  const length = randInt(TUNING.phrase.min, TUNING.phrase.max);
  const used = new Set();
  const phrase = [];

  const maybeImprovise = () => (Math.random() < TUNING.improvisation ? improvisedCombo(context) : null);

  let current = maybeImprovise() || pickCombo(context, recent, used);
  phrase.push(current);
  if (!current.improvised) used.add(current.id);

  while (phrase.length < length) {
    const invented = maybeImprovise();
    if (invented) {
      phrase.push(invented);
      current = invented;
      continue;
    }

    const candidates = COMBOS.filter((c) => !used.has(c.id));
    if (!candidates.length) break;

    const scored = candidates.map((c) => {
      const contextual = scoreCombo(c, context, recent);
      const connected = affinity(current, c);
      return { combo: c, score: (1 - TUNING.drift) * contextual + TUNING.drift * connected };
    });

    scored.sort((a, b) => b.score - a.score);
    const pool = scored.slice(0, TUNING.topK);
    const next = pool[Math.floor(Math.random() * pool.length)].combo;

    phrase.push(next);
    used.add(next.id);
    current = next;
  }

  return phrase;
}

// Stateful player. The caller owns timing and just calls advance() once per
// frame; the sequencer handles looping a combo, moving through the phrase, and
// building a fresh phrase when the current one ends.
//
// getContext() is read at phrase boundaries rather than every frame, so a mood
// flip mid-phrase doesn't produce a jump-cut — unless interrupt() is called,
// which is what a genuinely urgent change should do.
export function createSequencer({ getContext }) {
  const recent = [];
  let phrase = [];
  let comboIndex = 0;
  let frameIndex = 0;
  let loopsDone = 0;
  let dwellTarget = 0;

  function remember(id) {
    recent.unshift(id);
    while (recent.length > TUNING.recency.memory) recent.pop();
  }

  function startCombo(i) {
    comboIndex = i;
    frameIndex = 0;
    loopsDone = 0;
    dwellTarget = randInt(TUNING.dwell.min, TUNING.dwell.max);
    remember(phrase[comboIndex].id);
  }

  function newPhrase() {
    phrase = buildPhrase(getContext(), recent);
    startCombo(0);
  }

  newPhrase();

  return {
    // Current pose number to render.
    frame() {
      const combo = phrase[comboIndex];
      return combo.poses[frameIndex];
    },

    // Step one frame. Loops the combo `dwellTarget` times, then advances.
    // Returns true when it crossed into a new combo — see COMBO_GAP_MS.
    advance() {
      const combo = phrase[comboIndex];
      frameIndex += 1;
      if (frameIndex < combo.poses.length) return false;

      frameIndex = 0;
      loopsDone += 1;
      if (loopsDone < dwellTarget) return false;

      if (comboIndex + 1 < phrase.length) startCombo(comboIndex + 1);
      else newPhrase();
      return true;
    },

    // Abandon the current phrase immediately — for a real state change that
    // shouldn't wait politely for the current performance to finish.
    interrupt() {
      newPhrase();
    },

    // Introspection, for the preview and for debugging.
    state() {
      return {
        phrase: phrase.map((c) => c.id),
        combo: phrase[comboIndex].id,
        comboIndex,
        frameIndex,
        loopsDone,
        dwellTarget,
        recent: [...recent]
      };
    }
  };
}

export function comboById(id) {
  return COMBO_BY_ID[id];
}

// ---- narrative playback ---------------------------------------------------
// The story-shaped player (see clu3Narrative.js). Instead of wandering near a
// single mood point, this walks an ARC: each beat has its own bent context, so
// the performance has a beginning, a turn, and somewhere it lands.
//
// Beats are filled the same way phrases are — best-matching combo, or an
// improvised run — so everything learned from the authored combos still
// applies. The difference is purely that the target MOVES, on purpose, in a
// shape that means something.

// How many times a beat's combo loops, scaled by that beat's `hold`. Short
// beats (a startle) flash past; long ones (settling) linger.
function loopsForBeat(beat) {
  const base = randInt(TUNING.dwell.min, TUNING.dwell.max);
  return Math.max(1, Math.round(base * (beat.hold ?? 1)));
}

export function createStorySequencer({ getStory, buildStory }) {
  const recent = [];
  let arc = null;
  let beatIndex = 0;
  let current = null;
  let frameIndex = 0;
  let loopsDone = 0;
  let loopTarget = 1;

  function remember(id) {
    recent.unshift(id);
    while (recent.length > TUNING.recency.memory) recent.pop();
  }

  function startBeat(i) {
    beatIndex = i;
    const beat = arc.beats[i];
    // A beat is one combo: either recalled or invented, same as a phrase slot.
    current =
      (Math.random() < TUNING.improvisation ? improvisedCombo(beat) : null) || pickCombo(beat, recent);
    frameIndex = 0;
    loopsDone = 0;
    loopTarget = loopsForBeat(beat);
    remember(current.id);
  }

  function newStory() {
    arc = buildStory(getStory());
    startBeat(0);
  }

  newStory();

  return {
    frame() {
      return current.poses[frameIndex];
    },

    // Returns true when this step crossed into a new combo, so the caller can
    // hold for COMBO_GAP_MS before drawing the next frame.
    advance() {
      frameIndex += 1;
      if (frameIndex < current.poses.length) return false;

      frameIndex = 0;
      loopsDone += 1;
      if (loopsDone < loopTarget) return false;

      if (beatIndex + 1 < arc.beats.length) startBeat(beatIndex + 1);
      else newStory();
      return true;
    },

    // Abandon the story mid-telling — for a change urgent enough that
    // finishing the current narrative would be dishonest.
    interrupt() {
      newStory();
    },

    state() {
      return {
        arc: arc.id,
        unresolved: arc.unresolved,
        role: arc.beats[beatIndex].role,
        beatIndex,
        beats: arc.beats.length,
        combo: current.id,
        improvised: !!current.improvised,
        recent: [...recent]
      };
    }
  };
}
