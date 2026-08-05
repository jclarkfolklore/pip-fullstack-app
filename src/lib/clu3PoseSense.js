// What the authored combos TEACH, at the level of individual poses.
//
// clu3Combos.js is a base to build on, not the whole vocabulary. For Clu3 to
// improvise — to perform runs nobody wrote down, and to keep working when new
// sprites are added — meaning has to exist per POSE, not only per combo.
//
// Nothing here is hand-authored. Two things are learned from the combos:
//
//   SEMANTICS  a pose inherits a blend of the fields and axes of every combo
//              it appears in. Poses in several combos land between their
//              meanings, which is what makes shared frames genuinely
//              ambiguous rather than arbitrarily assigned to one reading.
//
//   ADJACENCY  every consecutive pair inside a combo is evidence that those
//              two frames look right back to back. This is the part that
//              can't be inferred from semantics alone — it's knowledge about
//              the ART (which drawings actually animate together), and it's
//              what keeps improvised runs from flickering between poses that
//              happen to mean similar things but don't move together.
//
// Add combos and this gets richer automatically. Add sprites with no combo
// and they'll be reported as unlearned rather than silently misused.

import { COMBOS } from './clu3Combos.js';

const AXES = ['valence', 'arousal', 'engagement'];

function buildSemantics() {
  const acc = new Map();

  for (const combo of COMBOS) {
    // A pose in a 2-frame combo carries half that combo's meaning; in a
    // 9-frame combo, a ninth of it. This is about ATTRIBUTION — how much a
    // combo tells us about one of its frames — and is unrelated to how
    // combos are weighted during selection, where length is ignored.
    const share = 1 / combo.poses.length;
    for (const pose of combo.poses) {
      if (!acc.has(pose)) acc.set(pose, { field: {}, axes: {}, weight: 0, combos: [] });
      const entry = acc.get(pose);
      entry.weight += share;
      entry.combos.push(combo.id);
      for (const [tag, value] of Object.entries(combo.field)) {
        entry.field[tag] = (entry.field[tag] || 0) + value * share;
      }
      for (const k of AXES) {
        entry.axes[k] = (entry.axes[k] || 0) + (combo.axes[k] ?? 0) * share;
      }
    }
  }

  const out = new Map();
  for (const [pose, entry] of acc) {
    const field = {};
    for (const [tag, value] of Object.entries(entry.field)) field[tag] = value / entry.weight;
    const axes = {};
    for (const k of AXES) axes[k] = (entry.axes[k] || 0) / entry.weight;
    out.set(pose, { pose, field, axes, combos: [...new Set(entry.combos)] });
  }
  return out;
}

export const POSE_SENSE = buildSemantics();

// Directed: how often does b follow a inside an authored combo?
function buildAdjacency() {
  const adj = new Map();
  for (const combo of COMBOS) {
    for (let i = 0; i < combo.poses.length - 1; i++) {
      const a = combo.poses[i];
      const b = combo.poses[i + 1];
      if (!adj.has(a)) adj.set(a, new Map());
      const row = adj.get(a);
      row.set(b, (row.get(b) || 0) + 1);
    }
  }
  return adj;
}

export const POSE_ADJACENCY = buildAdjacency();

export function poseSense(pose) {
  return POSE_SENSE.get(pose) || null;
}

function axisCloseness(a, b) {
  let sum = 0;
  for (const k of AXES) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    sum += d * d;
  }
  return 1 - Math.sqrt(sum) / Math.sqrt(AXES.length * 4);
}

function tagMatch(field, tags) {
  let hit = 0;
  let total = 0;
  for (const [tag, weight] of Object.entries(tags || {})) {
    total += weight;
    if (field[tag]) hit += weight * field[tag];
  }
  return total ? hit / total : 0;
}

// How well does a pose suit a context?
export function poseScore(pose, context) {
  const sense = POSE_SENSE.get(pose);
  if (!sense) return 0;
  return 0.6 * axisCloseness(sense.axes, context.axes || {}) + 0.4 * tagMatch(sense.field, context.tags);
}

// How natural is a -> b as a frame transition? Observed adjacency dominates:
// if the art says these two follow each other, that beats any semantic
// argument. Unobserved pairs fall back to how close they sit in meaning, so
// novel transitions are possible but never preferred over learned ones.
export function poseAffinity(a, b) {
  if (a === b) return 0.15; // a held frame is fine occasionally, not as a habit
  const observed = POSE_ADJACENCY.get(a);
  const count = observed ? observed.get(b) || 0 : 0;
  if (count > 0) return Math.min(1, 0.75 + 0.1 * count);

  const sa = POSE_SENSE.get(a);
  const sb = POSE_SENSE.get(b);
  if (!sa || !sb) return 0;
  // Capped below the observed floor so learned pairs always win.
  return 0.6 * axisCloseness(sa.axes, sb.axes);
}

// Compose a run of poses that was never authored.
//
// Walks the adjacency graph from a context-appropriate starting frame,
// weighing "does this follow naturally" against "does this still suit the
// mood" at every step. The result is shaped like a combo so the rest of the
// system can treat it identically.
export function improvise(context, { minLength = 3, maxLength = 7, flow = 0.6, avoidRepeat = true } = {}) {
  const poses = [...POSE_SENSE.keys()];
  if (!poses.length) return null;

  const length = minLength + Math.floor(Math.random() * (maxLength - minLength + 1));

  // Start somewhere that suits the context, sampled from the better options
  // rather than always the single best.
  const ranked = poses
    .map((p) => ({ p, s: poseScore(p, context) + Math.random() * 0.12 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  let current = ranked[Math.floor(Math.random() * ranked.length)].p;

  const run = [current];
  const used = new Set([current]);

  while (run.length < length) {
    const candidates = poses
      .filter((p) => !avoidRepeat || !used.has(p))
      .map((p) => ({
        p,
        s: flow * poseAffinity(current, p) + (1 - flow) * poseScore(p, context) + Math.random() * 0.08
      }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);

    if (!candidates.length) break;
    current = candidates[Math.floor(Math.random() * candidates.length)].p;
    run.push(current);
    used.add(current);
  }

  return { poses: run, ...senseOfRun(run) };
}

// Average the semantics of a run's frames, so an improvised sequence exposes
// the same { field, axes } surface an authored combo does.
export function senseOfRun(run) {
  const field = {};
  const axes = {};
  let n = 0;
  for (const pose of run) {
    const sense = POSE_SENSE.get(pose);
    if (!sense) continue;
    n += 1;
    for (const [tag, value] of Object.entries(sense.field)) field[tag] = (field[tag] || 0) + value;
    for (const k of AXES) axes[k] = (axes[k] || 0) + (sense.axes[k] ?? 0);
  }
  if (n) {
    for (const tag of Object.keys(field)) field[tag] /= n;
    for (const k of AXES) axes[k] /= n;
  }
  return { field, axes };
}

// Poses no combo covers — they have no learned meaning, so improvisation
// can't reach them. Surfaces newly added sprites that still need grouping.
export function unlearnedPoses(totalPoses) {
  const missing = [];
  for (let n = 0; n < totalPoses; n++) if (!POSE_SENSE.has(n)) missing.push(n);
  return missing;
}
