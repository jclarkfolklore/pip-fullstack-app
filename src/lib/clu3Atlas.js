// Clu3's sprite atlas — the vocabulary scenes are built from.
//
// ADD ART HERE. Anything drawn on a Clu3 stage lives in this file: the cat
// itself, the room around them, props they interact with, and symbol overlays
// for effects. Scenes (clu3Scenes.js) only reference these by name, so new art
// is immediately usable without touching the engine.
//
// Grids are arrays of equal-length strings; '#' is on. Sparse or repeating
// sprites use gridFrom/hline from sprites.js so long rows can't be miscounted.

import { gridFrom, hline } from './sprites.js';

// ---- the cat -----------------------------------------------------------
// Kept simpler than the 16x16 close-up in faces.js: at scene scale, posture
// and silhouette carry the feeling, not eyebrow detail.

// Sitting, facing forward. 16x15.
// prettier-ignore
const catSit = [
  '.###........###.',
  '.####......####.',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
  '..############..',
  '..############..',
  '..############..',
  '..############..',
  '.##############.',
  '.##..######..##.'
];

// Taller, ears pricked — alert / startled / curious. 16x15.
// prettier-ignore
const catAlert = [
  '.##..........##.',
  '.###........###.',
  '.####......####.',
  '.##############.',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
  '..############..',
  '..############..',
  '..############..',
  '..############..',
  '.##############.',
  '.##..######..##.'
];

// Curled up, asleep. 18x8.
// prettier-ignore
const catCurl = [
  '....########......',
  '..############....',
  '.####......####...',
  '################..',
  '.##############...',
  '..############....',
  '...##########.....',
  '....########......'
];

// Eye overlays, drawn in the 'cut' tone so they knock holes in the cat's
// silhouette. Placed relative to the cat's own origin.
// prettier-ignore
const catEyesOpen = [
  '##....##',
  '##....##',
  '##....##'
];
// prettier-ignore
const catEyesClosed = [
  '##....##'
];
// A contented squint — cats close their eyes when they're pleased, so this
// reading as "nearly shut" is correct rather than a limitation.
// prettier-ignore
const catEyesHappy = [
  '##....##',
  '.#....#.'
];

// Tail — its own sprite so it can sway independently of the body. 5x8.
// prettier-ignore
const tail = [
  '....#',
  '...##',
  '..##.',
  '.##..',
  '##...',
  '#....',
  '#....',
  '##...'
];

// ---- environment -------------------------------------------------------

const floor = hline(36, '##.');

// prettier-ignore
const window9 = [
  '##########',
  '#..#..#..#',
  '#..#..#..#',
  '##########',
  '#..#..#..#',
  '#..#..#..#',
  '##########'
];

// prettier-ignore
const plant = [
  '..##..',
  '.#..#.',
  '#.##.#',
  '..##..',
  '..##..',
  '.####.',
  '.####.'
];

// prettier-ignore
const box = [
  '##########',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '##########'
];

// prettier-ignore
const desk = [
  '##############',
  '.#..........#.',
  '.#..........#.',
  '.#..........#.'
];

const stars = gridFrom(36, 6, [
  [2, 1], [7, 0], [11, 3], [15, 1], [19, 4], [23, 0], [27, 2], [30, 4],
  [4, 4], [9, 2], [17, 3], [25, 4], [33, 1], [35, 3]
]);

// ---- props -------------------------------------------------------------

// prettier-ignore
const laptop = [
  '.#######.',
  '.#.....#.',
  '.#######.',
  '#########'
];

// prettier-ignore
const yarn = [
  '.####.',
  '#.##.#',
  '##..##',
  '##..##',
  '#.##.#',
  '.####.'
];

// prettier-ignore
const clock = [
  '.#####.',
  '#..#..#',
  '#..#..#',
  '#..###.',
  '#.....#',
  '#.....#',
  '.#####.'
];

// prettier-ignore
const papers = [
  '.######.',
  '.#....#.',
  '########',
  '#......#',
  '########'
];

// ---- symbols / effects -------------------------------------------------

// prettier-ignore
const zed = [
  '####',
  '..#.',
  '.#..',
  '####'
];

// prettier-ignore
const bang = [
  '##',
  '##',
  '##',
  '##',
  '..',
  '##'
];

// prettier-ignore
const question = [
  '.###.',
  '#...#',
  '...#.',
  '..#..',
  '.....',
  '..#..'
];

// prettier-ignore
const sparkle = [
  '..#..',
  '..#..',
  '#####',
  '..#..',
  '..#..'
];

// prettier-ignore
const heart = [
  '.##.##.',
  '#######',
  '#######',
  '.#####.',
  '..###..',
  '...#...'
];

// prettier-ignore
const alertTri = [
  '...#...',
  '..###..',
  '..#.#..',
  '.##.##.',
  '.#####.',
  '#######'
];

export const CLU3_ATLAS = {
  // cat
  catSit,
  catAlert,
  catCurl,
  catEyesOpen,
  catEyesClosed,
  catEyesHappy,
  tail,
  // environment
  floor,
  window9,
  plant,
  box,
  desk,
  stars,
  // props
  laptop,
  yarn,
  clock,
  papers,
  // symbols
  zed,
  bang,
  question,
  sparkle,
  heart,
  alertTri
};
