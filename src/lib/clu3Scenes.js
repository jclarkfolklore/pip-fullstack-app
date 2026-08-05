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
// The canvas is 72x44 with the ground at y=40. Everything is laid out so the
// set sits LEFT of the cat and symbols sit above or right of them — nothing
// overlaps the character.

import { renderStage } from './sprites.js';
import { CLU3_ATLAS } from './clu3Atlas.js';
import { renderFace } from './faces.js';

const W = 72;
const H = 44;
const GROUND_Y = 40;

// The cat is 32x30 (7 rows of ears + 23 of head/body).
const CAT_X = 26;
const CAT_Y = GROUND_Y - 30;
const EARS_H = 7;

// Face part offsets, relative to the cat's own origin.
const EYE_L = 5;
const EYE_R = 20;
const EYE_Y = 8;
const PUPIL_L = 7;
const PUPIL_R = 22;
const PUPIL_Y = 9;
const LID_Y = 11;

function eyeLayers(x, y, { blinking, happy }) {
  if (blinking) return [{ sprite: 'eyeClosed', x, y: y + LID_Y, tone: 'cut' }];
  if (happy) return [{ sprite: 'eyeHappy', x, y: y + LID_Y, tone: 'cut' }];
  return [{ sprite: 'eyeOpen', x, y: y + EYE_Y, tone: 'cut' }];
}

// The cat: ears + body + the face knocked into it + a tail that sways on its
// own. Body and face share one motion so the features never slide off the head.
function cat({ pose = 'normal', blinking = false, happy = false, motion = 'bob' } = {}) {
  const x = CAT_X;
  const y = CAT_Y;
  const ears = pose === 'alert' ? 'catEarsAlert' : 'catEarsNormal';

  const layers = [
    { sprite: 'tail', x: x + 31, y: y + 14, tone: 'ink', motion: 'sway' },
    { sprite: ears, x, y, tone: 'ink', motion },
    { sprite: 'catHeadBody', x, y: y + EARS_H, tone: 'ink', motion },
    { sprite: 'innerEar', x: x + 4, y: y + 3, tone: 'cut', motion },
    { sprite: 'innerEar', x: x + 24, y: y + 3, tone: 'cut', motion },
    ...eyeLayers(x + EYE_L, y, { blinking, happy }).map((l) => ({ ...l, motion })),
    ...eyeLayers(x + EYE_R, y, { blinking, happy }).map((l) => ({ ...l, motion })),
    { sprite: 'muzzle', x: x + 9, y: y + 15, tone: 'cut', motion },
    { sprite: 'whisker', x: x + 1, y: y + 16, tone: 'cut', motion },
    { sprite: 'whisker', x: x + 24, y: y + 16, tone: 'cut', motion },
    { sprite: 'whisker', x: x + 2, y: y + 18, tone: 'cut', motion },
    { sprite: 'whisker', x: x + 23, y: y + 18, tone: 'cut', motion },
    { sprite: 'nose', x: x + 14, y: y + 15, tone: 'ink', motion },
    { sprite: 'mouth', x: x + 12, y: y + 18, tone: 'ink', motion },
    { sprite: 'chest', x: x + 12, y: y + 21, tone: 'cut', motion }
  ];

  // Pupils only exist when the eyes are actually open.
  if (!blinking && !happy) {
    layers.push(
      { sprite: 'pupil', x: x + PUPIL_L, y: y + PUPIL_Y, tone: 'ink', motion },
      { sprite: 'pupil', x: x + PUPIL_R, y: y + PUPIL_Y, tone: 'ink', motion }
    );
  }

  return layers;
}

// The shared room. Everything sits left of CAT_X so nothing collides.
function room({ withWindow = true, withPlant = true } = {}) {
  const layers = [{ sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' }];
  if (withWindow) layers.push({ sprite: 'window9', x: 4, y: 8, tone: 'dim' });
  if (withPlant) layers.push({ sprite: 'plant', x: 6, y: 26, tone: 'dim' });
  return layers;
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
      ...room({ withPlant: false }),
      ...cat({ blinking: s.blinking, happy: true }),
      { sprite: 'yarn', x: 8, y: GROUND_Y - 12, tone: 'ink', motion: 'nudge' }
    ]
  }),

  proud: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room(),
      ...cat({ pose: 'alert', blinking: s.blinking, happy: true }),
      { sprite: 'sparkle', x: 14, y: 0, tone: 'ink', motion: 'twinkle' },
      { sprite: 'sparkle', x: 59, y: 3, tone: 'ink', motion: 'twinkle-late' }
    ]
  }),

  curious: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withPlant: false }),
      ...cat({ pose: 'alert', blinking: s.blinking }),
      { sprite: 'box', x: 3, y: GROUND_Y - 12, tone: 'dim' },
      { sprite: 'question', x: 59, y: 1, tone: 'ink', motion: 'float' }
    ]
  }),

  busy: (s) => ({
    width: W,
    height: H,
    layers: [
      { sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' },
      { sprite: 'desk', x: 0, y: 32, tone: 'dim' },
      { sprite: 'laptop', x: 5, y: 22, tone: 'ink', motion: 'flicker' },
      { sprite: 'clock', x: 4, y: 4, tone: 'dim', motion: 'tick' },
      ...cat({ blinking: s.blinking, motion: null })
    ]
  }),

  concerned: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withWindow: false }),
      { sprite: 'clock', x: 5, y: 8, tone: 'dim', motion: 'tick' },
      ...cat({ blinking: s.blinking }),
      { sprite: 'alertTri', x: 58, y: 2, tone: 'ink', motion: 'pulse-soft' }
    ]
  }),

  alarmed: (s) => ({
    width: W,
    height: H,
    layers: [
      ...room({ withPlant: false }),
      ...cat({ pose: 'alert', blinking: s.blinking, motion: 'jitter' }),
      { sprite: 'bang', x: 62, y: 2, tone: 'ink', motion: 'flash' },
      { sprite: 'bang', x: 18, y: 2, tone: 'ink', motion: 'flash-late' }
    ]
  }),

  sleepy: () => ({
    width: W,
    height: H,
    layers: [
      { sprite: 'stars', x: 0, y: 1, tone: 'faint', motion: 'twinkle' },
      { sprite: 'floor', x: 0, y: GROUND_Y, tone: 'faint' },
      // The curled pose is only 16 tall, so it sits lower than standing ones.
      { sprite: 'catCurl', x: 18, y: GROUND_Y - 16, tone: 'ink', motion: 'breathe' },
      { sprite: 'tailCurl', x: 42, y: GROUND_Y - 11, tone: 'cut', motion: 'breathe' },
      { sprite: 'eyeClosed', x: 24, y: GROUND_Y - 10, tone: 'cut', motion: 'breathe' },
      { sprite: 'zed', x: 56, y: 17, tone: 'ink', motion: 'float' },
      { sprite: 'zed', x: 61, y: 6, tone: 'dim', motion: 'float-late' }
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
