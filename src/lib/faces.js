// Clu3's face — a cat, built from composable pixel parts.
//
// Faces are a static BODY (head + ears) plus always-on NOSE and WHISKERS,
// plus swappable EYES and MOUTHS — rather than one full grid per emotion. So
// a new mood is usually one line in MOOD_PARTS, and blinking comes free by
// swapping the eyes.
//
// Deliberately separate from lib/icons.js: those are hand-authored 8x8 UI
// glyphs, this is a 16x16 animated character. Same rendering idea (pixel grid
// -> SVG rects, no emoji per the global rule), different job.
//
// Two tones only: body pixels (dim) and feature pixels (ink). Features draw
// on top, so a part's '.' cells let the body colour show through — that's
// what makes a hollow eye read as a slit pupil.
//
// The grids are exported so they can be audited or previewed without running
// the whole app. See docs/CLU3.md.

const ON = '#';

// prettier-ignore
export const BODY = [
  '.##..........##.', // ear tips
  '.###........###.',
  '.####......####.',
  '..############..',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
  '...##########...',
  '....########....',
  '....##....##....'  // paws
];

// prettier-ignore
export const EYES = {
  // 3 wide, 4 tall, hollow — the vertical gap reads as a cat's slit pupil.
  open:    ['###', '#.#', '#.#', '###'],
  // Fully dilated: alert / startled.
  wide:    ['###', '###', '###', '###'],
  // Upward caret — the contented cat squint.
  happy:   ['.#.', '#.#'],
  sparkle: ['#.#', '.#.', '#.#'],
  droopy:  ['###', '###'],
  closed:  ['###']
};

// prettier-ignore
export const MOUTHS = {
  small:  ['.#..#.'],                          // subtle cat-mouth corners
  smile:  ['#....#', '.####.'],
  flat:   ['######'],
  frown:  ['.####.', '#....#'],
  open:   ['.####.', '#....#', '.####.'],      // a meow
  wobble: ['.#.#.#']
};

// prettier-ignore
const NOSE = ['##'];
// prettier-ignore
const WHISKER = ['###'];

// mood -> parts. ADD NEW MOODS HERE (and to MOODS in
// server/repo/clu3Repo.js so the API accepts them on authored messages).
export const MOOD_PARTS = {
  content: { eyes: 'open', mouth: 'small' },
  happy: { eyes: 'happy', mouth: 'smile' },
  proud: { eyes: 'sparkle', mouth: 'smile' },
  curious: { eyes: 'wide', mouth: 'small' },
  busy: { eyes: 'open', mouth: 'flat' },
  concerned: { eyes: 'open', mouth: 'wobble' },
  alarmed: { eyes: 'wide', mouth: 'open' },
  sleepy: { eyes: 'closed', mouth: 'small' }
};

// Anchors on the 16x16 canvas. Eyes mirror around the head's centre;
// whiskers flank the nose and sit on the cheeks.
const EYE_LEFT_X = 3;
const EYE_RIGHT_X = 10;
const EYE_Y = 5;
const NOSE_X = 7;
const NOSE_Y = 9;
const MOUTH_X = 5;
const MOUTH_Y = 10;
const WHISKER_LEFT_X = 0;
const WHISKER_RIGHT_X = 13;
const WHISKER_ROWS = [8, 10];

// Below this energy Clu3 visibly flags — eyes go half-lidded. Moods where
// alertness IS the point are exempt, so a genuine alarm never looks sleepy.
const LOW_ENERGY = 25;
const ENERGY_EXEMPT_MOODS = new Set(['alarmed', 'curious', 'proud']);

const SVG_NS = 'http://www.w3.org/2000/svg';

function rect(x, y, className) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', '1');
  r.setAttribute('height', '1');
  r.setAttribute('class', className);
  return r;
}

function paint(target, grid, offsetX, offsetY, className) {
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === ON) target.appendChild(rect(offsetX + x, offsetY + y, className));
    }
  });
}

export const MOODS = Object.keys(MOOD_PARTS);

export function knownMood(mood) {
  return Object.prototype.hasOwnProperty.call(MOOD_PARTS, mood) ? mood : 'content';
}

// Resolves which parts to draw, applying blink and low-energy droop. Kept
// separate from rendering so the decision is easy to reason about.
export function partsFor(mood, { blinking = false, energy = 100 } = {}) {
  const base = MOOD_PARTS[knownMood(mood)];
  let eyes = base.eyes;
  if (energy <= LOW_ENERGY && !ENERGY_EXEMPT_MOODS.has(mood) && eyes !== 'closed') {
    eyes = 'droopy';
  }
  if (blinking) eyes = 'closed';
  return { eyes, mouth: base.mouth };
}

export function renderFace(mood, { blinking = false, energy = 100, className = '' } = {}) {
  const { eyes, mouth } = partsFor(mood, { blinking, energy });
  const eyeGrid = EYES[eyes] || EYES.open;
  const mouthGrid = MOUTHS[mouth] || MOUTHS.small;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);

  paint(svg, BODY, 0, 0, 'pip-clu3-px-body');

  // Closed eyes are a single line, so drop them to where the lids would be
  // rather than leaving them floating at the top of the socket.
  const eyeY = eyes === 'closed' ? EYE_Y + 1 : EYE_Y;
  paint(svg, eyeGrid, EYE_LEFT_X, eyeY, 'pip-clu3-px-ink');
  paint(svg, eyeGrid, EYE_RIGHT_X, eyeY, 'pip-clu3-px-ink');

  paint(svg, NOSE, NOSE_X, NOSE_Y, 'pip-clu3-px-ink');
  paint(svg, mouthGrid, MOUTH_X, MOUTH_Y, 'pip-clu3-px-ink');

  for (const row of WHISKER_ROWS) {
    paint(svg, WHISKER, WHISKER_LEFT_X, row, 'pip-clu3-px-ink');
    paint(svg, WHISKER, WHISKER_RIGHT_X, row, 'pip-clu3-px-ink');
  }

  return svg;
}
