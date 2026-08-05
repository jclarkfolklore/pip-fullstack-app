// Clu3's scenes — what the stage shows for a given mood.
//
// ADD/EDIT SCENES HERE. A scene is a function of render state
// ({ blinking, energy }) returning a stage spec for lib/sprites.js. Because
// they're plain data, a scene can be reshuffled freely without touching the
// engine or the panel.
//
// Two display modes:
//   'scene' (default) — the cat in an environment, which is what we want most
//                       of the time; the room carries mood as much as the cat
//   'face'            — the detailed 16x16 close-up from faces.js, for when
//                       expression alone is the point
//
// The canvas is 32x20. Ground line sits at y=18 so characters stand on it.

import { renderStage } from './sprites.js';
import { CLU3_ATLAS } from './clu3Atlas.js';
import { renderFace } from './faces.js';

// Canvas. Wider than it is tall so there's room for a set beside the cat;
// rows 0-4 stay clear for symbol overlays above their head.
const W = 36;
const H = 22;
const GROUND_Y = 20;

// Standing cat poses are 15 tall, so this lands their feet on the ground.
const CAT_X = 13;
const CAT_Y = GROUND_Y - 15;

// Eye overlay offset relative to the cat's own origin.
const EYE_DX = 4;
const EYE_DY = 4;

function catEyes({ blinking, happy = false }) {
  if (blinking) return 'catEyesClosed';
  return happy ? 'catEyesHappy' : 'catEyesOpen';
}

// The shared room: floor, a window, a plant beneath it. Dim, so the cat reads
// as the subject instead of competing with the set. Everything sits left of
// CAT_X so nothing collides with the character.
function room({ withWindow = true, withPlant = true } = {}) {
  const layers = [{ sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' }];
  if (withWindow) layers.push({ sprite: 'window9', x: 1, y: 4, tone: 'dim' });
  if (withPlant) layers.push({ sprite: 'plant', x: 2, y: 13, tone: 'dim' });
  return layers;
}

// The cat, its tail, and its eyes as one reusable group. Eyes are 'cut' so
// they knock through the ink silhouette; body and eyes share the same motion
// so the face never slides off the head.
function cat({ pose = 'catSit', blinking = false, happy = false, motion = 'bob' } = {}) {
  return [
    { sprite: 'tail', x: CAT_X + 16, y: CAT_Y + 6, tone: 'ink', motion: 'sway' },
    { sprite: pose, x: CAT_X, y: CAT_Y, tone: 'ink', motion },
    { sprite: catEyes({ blinking, happy }), x: CAT_X + EYE_DX, y: CAT_Y + EYE_DY, tone: 'cut', motion }
  ];
}

// mood -> scene. Every entry returns a full stage spec.
export const SCENES = {
  content: (s) => ({
    width: W,
    height: H,
    layers: [...room(), ...cat({ blinking: s.blinking })]
  }),

  happy: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room(),
      ...cat({ blinking: s.blinking, happy: true }),
      { sprite: 'yarn', x: 9, y: GROUND_Y - 6, tone: 'ink', motion: 'nudge' }
    ]
  }),

  proud: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room(),
      ...cat({ pose: 'catAlert', blinking: s.blinking, happy: true }),
      { sprite: 'sparkle', x: 12, y: 0, tone: 'ink', motion: 'twinkle' },
      { sprite: 'sparkle', x: 29, y: 2, tone: 'ink', motion: 'twinkle-late' }
    ]
  }),

  curious: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withPlant: false }),
      ...cat({ pose: 'catAlert', blinking: s.blinking }),
      { sprite: 'box', x: 2, y: GROUND_Y - 6, tone: 'dim' },
      { sprite: 'question', x: 30, y: 1, tone: 'ink', motion: 'float' }
    ]
  }),

  busy: (s) => ({
    width: W,
    height: H,
    layers: [
      { sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' },
      { sprite: 'desk', x: 0, y: GROUND_Y - 4, tone: 'dim' },
      { sprite: 'laptop', x: 2, y: GROUND_Y - 8, tone: 'ink', motion: 'flicker' },
      { sprite: 'papers', x: 4, y: GROUND_Y - 13, tone: 'dim' },
      ...cat({ pose: 'catSit', blinking: s.blinking, motion: null })
    ]
  }),

  concerned: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withWindow: false }),
      { sprite: 'clock', x: 2, y: 4, tone: 'dim', motion: 'tick' },
      ...cat({ blinking: s.blinking }),
      { sprite: 'alertTri', x: 29, y: 1, tone: 'ink', motion: 'pulse-soft' }
    ]
  }),

  alarmed: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withPlant: false }),
      ...cat({ pose: 'catAlert', blinking: s.blinking, motion: 'jitter' }),
      { sprite: 'bang', x: 31, y: 1, tone: 'ink', motion: 'flash' },
      { sprite: 'bang', x: 10, y: 1, tone: 'ink', motion: 'flash-late' }
    ]
  }),

  sleepy: () => ({
    width: W,
    height: H,
    layers: [
      { sprite: 'stars', x: 0, y: 1, tone: 'faint', motion: 'twinkle' },
      { sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' },
      // The curled pose is only 8 tall, so it sits lower than the standing ones.
      { sprite: 'catCurl', x: 12, y: GROUND_Y - 8, tone: 'ink', motion: 'breathe' },
      { sprite: 'zed', x: 30, y: 9, tone: 'ink', motion: 'float' },
      { sprite: 'zed', x: 31, y: 4, tone: 'dim', motion: 'float-late' }
    ]
  })
};

export function knownScene(mood) {
  return Object.prototype.hasOwnProperty.call(SCENES, mood) ? mood : 'content';
}

// The one entry point the panel calls. `mode` selects the environment stage
// or the close-up face.
export function renderClu3Visual(mood, { blinking = false, energy = 100, mode = 'scene' } = {}) {
  if (mode === 'face') {
    return renderFace(mood, { blinking, energy });
  }
  const spec = SCENES[knownScene(mood)]({ blinking, energy });
  return renderStage(spec, CLU3_ATLAS);
}
