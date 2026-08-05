// Clu3's scenes — what the stage shows for a given mood.
//
// A scene is (renderState, pose) -> a stage spec for lib/sprites.js. It
// composes two things:
//
//   THE CHARACTER, which is not drawn here. It comes from the extracted
//   sprite sheet (clu3SpriteData.json -> clu3Quantize.js), and WHICH pose is
//   showing is decided by clu3Sequencer.js, not by this file. Scenes receive
//   a pose number and place it. That split is deliberate: expression is the
//   sequencer's job, staging is this file's.
//
//   THE ROOM around them — floor, window, props, symbol overlays. Still
//   hand-authored pixels in clu3Atlas.js, still per-mood, and still the place
//   to add set dressing.
//
// Canvas is 144x88 with the ground at y=80. The character is drawn at 2x
// (64x64 on the stage) because the whole reason for moving to the sprite
// sheet was legible expression — at native 32x32 the eyes and mouth are too
// small to read at panel size. It sits right-of-centre, so the room and any
// symbol overlays have the left third to themselves.

import { renderStage, scale2x } from './sprites.js';
import { CLU3_ATLAS } from './clu3Atlas.js';
import { quantizeSprite, spriteIdByNumber } from './clu3Quantize.js';

const W = 144;
const H = 88;
const GROUND_Y = 80;

const CHAR_SCALE = 2;
const CHAR_SIZE = 32 * CHAR_SCALE;
const CHAR_X = 74;
const CHAR_Y = GROUND_Y - CHAR_SIZE;

// A neutral resting pose, for the rare call that has no sequencer behind it.
const FALLBACK_POSE = 0;

// The character as stage layers. Tones come from the style filter
// (clu3Quantize.js), so it themes with everything else automatically.
function character(pose, { motion = null } = {}) {
  const id = spriteIdByNumber(Number.isInteger(pose) ? pose : FALLBACK_POSE);
  const { layers } = quantizeSprite(id);
  return layers.map((l) => ({
    grid: CHAR_SCALE === 2 ? scale2x(l.grid) : l.grid,
    tone: l.tone,
    x: CHAR_X,
    y: CHAR_Y,
    motion
  }));
}

// The shared room. Everything sits left of CHAR_X so nothing collides.
function room({ withWindow = true, withPlant = true } = {}) {
  const layers = [{ sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' }];
  if (withWindow) layers.push({ sprite: 'window9', x: 6, y: 12, tone: 'dim' });
  if (withPlant) layers.push({ sprite: 'plant', x: 10, y: 52, tone: 'dim' });
  return layers;
}

// mood -> scene. Every entry is (renderState, pose) -> full stage spec.
export const SCENES = {
  content: (s, pose) => ({
    width: W,
    height: H,
    layers: [...room(), ...character(pose, { motion: 'bob' })]
  }),

  happy: (s, pose) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withPlant: false }),
      { sprite: 'yarn', x: 14, y: GROUND_Y - 24, tone: 'ink', motion: 'nudge' },
      ...character(pose, { motion: 'bob' })
    ]
  }),

  proud: (s, pose) => ({
    width: W,
    height: H,
    layers: [
      ...room(),
      { sprite: 'sparkle', x: 46, y: 2, tone: 'ink', motion: 'twinkle' },
      { sprite: 'sparkle', x: 4, y: 40, tone: 'ink', motion: 'twinkle-late' },
      ...character(pose, { motion: 'bob' })
    ]
  }),

  curious: (s, pose) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withPlant: false }),
      { sprite: 'box', x: 6, y: GROUND_Y - 24, tone: 'dim' },
      { sprite: 'question', x: 50, y: 2, tone: 'ink', motion: 'float' },
      ...character(pose)
    ]
  }),

  busy: (s, pose) => ({
    width: W,
    height: H,
    layers: [
      { sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' },
      { sprite: 'desk', x: 0, y: 64, tone: 'dim' },
      { sprite: 'laptop', x: 8, y: 44, tone: 'ink', motion: 'flicker' },
      { sprite: 'clock', x: 8, y: 8, tone: 'dim', motion: 'tick' },
      ...character(pose)
    ]
  }),

  concerned: (s, pose) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withWindow: false }),
      { sprite: 'clock', x: 8, y: 14, tone: 'dim', motion: 'tick' },
      { sprite: 'alertTri', x: 44, y: 4, tone: 'ink', motion: 'pulse-soft' },
      ...character(pose)
    ]
  }),

  alarmed: (s, pose) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withPlant: false }),
      { sprite: 'bang', x: 56, y: 4, tone: 'ink', motion: 'flash' },
      { sprite: 'bang', x: 30, y: 4, tone: 'ink', motion: 'flash-late' },
      ...character(pose, { motion: 'jitter' })
    ]
  }),

  sleepy: (s, pose) => ({
    width: W,
    height: H,
    layers: [
      { sprite: 'stars', x: 0, y: 2, tone: 'faint', motion: 'twinkle' },
      { sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' },
      { sprite: 'zed', x: 50, y: 30, tone: 'ink', motion: 'float' },
      { sprite: 'zed', x: 60, y: 10, tone: 'dim', motion: 'float-late' },
      // The sequencer picks the lying-down poses for this mood on its own —
      // there's no special-cased curled sprite any more.
      ...character(pose, { motion: 'breathe' })
    ]
  })
};

export function knownScene(mood) {
  return Object.prototype.hasOwnProperty.call(SCENES, mood) ? mood : 'content';
}

// The one entry point the panel calls, per animation frame.
export function renderClu3Visual(mood, { pose = FALLBACK_POSE, energy = 100 } = {}) {
  const spec = SCENES[knownScene(mood)]({ energy }, pose);
  return renderStage(spec, CLU3_ATLAS);
}
