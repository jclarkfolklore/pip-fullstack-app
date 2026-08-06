// Clu3's engine — risk #6.
//
// This is a generative system: 121 poses, 35 authored combos, per-pose meaning
// LEARNED from those combos, improvisation on top, and narrative arcs above
// that. Almost nothing about it is directly asserted by looking at the panel,
// because a wrong result still renders as a plausible cat.
//
// What's tested here is structure and invariants, never specific art. "Pose 42
// looks sad" is not a test — a deliberate redesign would fail it while being
// better. "Every pose a combo references exists" is, because violating it
// crashes or silently renders nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBOS, COMBO_BY_ID, affinity } from '../src/lib/clu3Combos.js';
import { POSE_SENSE, poseAffinity, improvise, unlearnedPoses, senseOfRun } from '../src/lib/clu3PoseSense.js';
import { buildPhrase, createStorySequencer, contextForMood, MOOD_CONTEXT, TUNING } from '../src/lib/clu3Sequencer.js';
import { chooseArc, buildArc, arcIds } from '../src/lib/clu3Narrative.js';
import { allSprites, quantizeSprite, SPRITE_SIZE } from '../src/lib/clu3Quantize.js';

const TOTAL_POSES = 121;

test('every combo references poses that exist', async () => {
  for (const combo of COMBOS) {
    assert.ok(combo.poses.length > 0, `${combo.id} has poses`);
    for (const p of combo.poses) {
      assert.ok(Number.isInteger(p) && p >= 0 && p < TOTAL_POSES, `${combo.id} pose ${p} in range`);
    }
  }
});

test('every combo has a semantic field and axes', async () => {
  // A combo with no field can never be selected for any context — it would sit
  // in the set doing nothing, which is the kind of dead weight that's invisible.
  for (const combo of COMBOS) {
    assert.ok(Object.keys(combo.field).length > 0, `${combo.id} has a field`);
    for (const axis of ['valence', 'arousal', 'engagement']) {
      const v = combo.axes[axis];
      assert.ok(typeof v === 'number' && v >= -1 && v <= 1, `${combo.id}.${axis} in [-1,1]`);
    }
  }
});

test('combo ids are unique', async () => {
  const ids = COMBOS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(Object.keys(COMBO_BY_ID).length, ids.length);
});

test('every pose has learned meaning', async () => {
  // Poses are covered by the authored combos, which is what lets improvisation
  // reach them. An uncovered pose is unreachable — worth knowing about when
  // new sprites are added.
  assert.equal(POSE_SENSE.size, TOTAL_POSES, 'all poses covered by some combo');
  assert.deepEqual(unlearnedPoses(TOTAL_POSES), [], 'no unlearned poses');
});

test('learned adjacency beats mere semantic similarity', async () => {
  // The core claim of clu3PoseSense: knowledge about the ART (which frames
  // animate together) must outrank knowledge about MEANING, or improvised runs
  // flicker between poses that mean similar things but don't move together.
  const combo = COMBOS.find((c) => c.poses.length >= 2);
  const [a, b] = combo.poses;
  const observed = poseAffinity(a, b);

  // Some pose never observed after `a`.
  const unobserved = [...POSE_SENSE.keys()].find((p) => p !== a && p !== b && poseAffinity(a, p) < 0.7);
  assert.ok(observed >= 0.75, 'an observed transition scores high');
  assert.ok(observed > poseAffinity(a, unobserved), 'observed beats unobserved');
});

test('improvisation produces valid, non-repeating runs', async () => {
  for (const mood of Object.keys(MOOD_CONTEXT)) {
    const run = improvise(contextForMood(mood), TUNING.improv);
    assert.ok(run && run.poses.length >= TUNING.improv.minLength, `${mood}: run long enough`);
    assert.ok(run.poses.length <= TUNING.improv.maxLength, `${mood}: run not too long`);
    for (const p of run.poses) {
      assert.ok(POSE_SENSE.has(p), `${mood}: improvised pose ${p} is real`);
    }
    assert.equal(new Set(run.poses).size, run.poses.length, `${mood}: no repeated frame within a run`);
    assert.ok(Object.keys(run.field).length > 0, `${mood}: improvised run exposes a field`);
  }
});

test('improvisation actually varies', async () => {
  // If it returned the same run every time it would be recall, not
  // improvisation — and Clu3 would look frozen again.
  const ctx = contextForMood('content');
  const runs = new Set();
  for (let i = 0; i < 20; i++) runs.add(improvise(ctx, TUNING.improv).poses.join(','));
  assert.ok(runs.size > 1, 'produced more than one distinct run in 20 attempts');
});

test('every mood builds a playable phrase', async () => {
  for (const mood of Object.keys(MOOD_CONTEXT)) {
    const phrase = buildPhrase(contextForMood(mood));
    assert.ok(phrase.length >= TUNING.phrase.min, `${mood}: phrase long enough`);
    for (const combo of phrase) {
      assert.ok(combo.poses.length > 0, `${mood}: every slot has frames`);
    }
  }
});

test('every narrative arc is well formed', async () => {
  for (const id of arcIds()) {
    const arc = buildArc(id, contextForMood('content'));
    assert.ok(arc.beats.length >= 2, `${id} has beats`);
    for (const beat of arc.beats) {
      assert.ok(beat.role, `${id} beat has a role`);
      for (const axis of ['valence', 'arousal', 'engagement']) {
        const v = beat.axes[axis];
        assert.ok(v >= -1 && v <= 1, `${id}.${beat.role}.${axis} stays clamped to [-1,1]`);
      }
    }
  }
});

test('an unknown arc id falls back rather than throwing', async () => {
  const arc = buildArc('does-not-exist', contextForMood('content'));
  assert.ok(arc.beats.length > 0, 'degrades to a default arc');
});

test('chooseArc prefers what HAPPENED over the standing mood', async () => {
  // A story is about events. If `change` is present it must win, or Clu3
  // narrates the wrong thing at the moment something actually occurred.
  assert.equal(chooseArc({ mood: 'content', change: { wentOverdue: true } }), 'deterioration');
  assert.equal(chooseArc({ mood: 'alarmed', change: { completed: true } }), 'accomplishment');
  assert.ok(arcIds().includes(chooseArc({ mood: 'content' })), 'falls back to a mood-appropriate arc');
});

test('the story sequencer advances and never emits an invalid pose', async () => {
  const seq = createStorySequencer({
    getStory: () => ({ mood: 'busy' }),
    buildStory: (s) => buildArc(chooseArc(s), contextForMood(s.mood))
  });

  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const frame = seq.frame();
    assert.ok(POSE_SENSE.has(frame), `frame ${frame} is a real pose`);
    seen.add(frame);
    seq.advance();
  }
  assert.ok(seen.size > 3, 'the performance actually moves through poses');

  const state = seq.state();
  assert.ok(state.arc && state.role, 'exposes what it is currently telling');
});

test('interrupting starts a new story immediately', async () => {
  const seq = createStorySequencer({
    getStory: () => ({ mood: 'content' }),
    buildStory: (s) => buildArc(chooseArc(s), contextForMood(s.mood))
  });
  for (let i = 0; i < 5; i++) seq.advance();
  seq.interrupt();
  assert.equal(seq.state().beatIndex, 0, 'restarted at the first beat');
});

test('all 121 sprites quantize to drawable layers', async () => {
  // The style filter is re-runnable and tunable; what must hold is that every
  // sprite comes out as something renderStage can draw.
  const sprites = allSprites();
  assert.equal(sprites.length, TOTAL_POSES);
  for (const s of sprites) {
    const { layers } = quantizeSprite(s.id);
    assert.ok(layers.length > 0, `${s.id} produced layers`);
    for (const layer of layers) {
      assert.equal(layer.grid.length, SPRITE_SIZE, `${s.id} grid is ${SPRITE_SIZE} rows`);
      for (const row of layer.grid) {
        assert.equal(row.length, SPRITE_SIZE, `${s.id} rows are ${SPRITE_SIZE} wide — a ragged grid renders skewed`);
      }
    }
  }
});

test('sprite reference numbers are stable and contiguous', async () => {
  // Poses are referred to by number in conversation and in the combo
  // definitions. Renumbering would silently repoint every combo.
  const sprites = allSprites();
  sprites.forEach((s, i) => assert.equal(s.n, i, 'numbering is positional and gapless'));
});

test('affinity between combos is bounded', async () => {
  for (const a of COMBOS.slice(0, 8)) {
    for (const b of COMBOS.slice(0, 8)) {
      const v = affinity(a, b);
      assert.ok(v >= 0 && v <= 1, `affinity(${a.id},${b.id}) in [0,1]`);
    }
  }
});

test('senseOfRun averages its frames', async () => {
  const run = [...POSE_SENSE.keys()].slice(0, 4);
  const sense = senseOfRun(run);
  for (const axis of ['valence', 'arousal', 'engagement']) {
    assert.ok(sense.axes[axis] >= -1 && sense.axes[axis] <= 1);
  }
});
