// STEP TWO: the style filter. Turns raw extracted sprites (clu3SpriteData.json,
// produced by scripts/clu3-extract-sheet.js) into layers our stage can draw.
//
// Deliberately separate from extraction so it stays reversible — every knob
// here can be re-tuned, or the whole pass swapped out, without touching the
// raw data. Nothing downstream reads the JSON directly; everything goes
// through quantizeSprite(), so this is the one place the look is decided.
//
// The source palette maps onto our four tones almost exactly:
//   'K' outline / hair / eyes / mouth -> ink   (full-strength foreground)
//   'B' yellow body fill              -> dim   (the body mass)
//   'A' pink blush                    -> faint (subtle accent)
//   'H' enclosed highlights           -> cut   (panel colour; eye whites)
//
// Sprites are NOT trimmed to their bounding box: every frame keeps the full
// 32x32 canvas so a pose swap animates in place instead of jumping around.

import rawData from './clu3SpriteData.json';

export const SHEET = rawData;
export const SPRITE_SIZE = rawData.cell;

const DEFAULT_TONE_MAP = { K: 'ink', B: 'dim', A: 'faint', H: 'cut' };

// Downsampling by majority vote alone eats thin outlines — a 1px black line
// loses every block it only partly fills. Weighting the vote keeps structure:
// outline beats blush beats body beats highlight beats background.
const DEFAULT_WEIGHTS = { K: 1.7, A: 1.25, B: 1.0, H: 0.85, '.': 1.0 };

const DEFAULTS = {
  // Target grid edge in pixels. 32 is native (finest); lower is chunkier.
  // Any value works, not just integer divisors of 32 — resampleGrid boxes the
  // source region per output pixel — so pixel size is tunable in small steps
  // rather than jumping straight from 32 to a too-coarse 16.
  size: 32,
  // Off by default: it removes genuine single-pixel detail (eye glints, the
  // thin line of a mouth) along with the JPEG specks, and the specks are
  // barely visible at render size anyway. Toggleable in the sheet preview.
  denoise: false,
  toneMap: DEFAULT_TONE_MAP,
  weights: DEFAULT_WEIGHTS
};

function toGrid(rows) {
  return rows.map((r) => r.split(''));
}

// A pixel with no orthogonal neighbour of its own kind is compression noise,
// not art. (The source is a JPEG, so cell edges pick up stray specks.)
function denoiseGrid(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const out = grid.map((r) => r.slice());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      let same = 0;
      if (y > 0 && grid[y - 1][x] === ch) same++;
      if (y < h - 1 && grid[y + 1][x] === ch) same++;
      if (x > 0 && grid[y][x - 1] === ch) same++;
      if (x < w - 1 && grid[y][x + 1] === ch) same++;
      if (same === 0) out[y][x] = '.';
    }
  }
  return out;
}

// Box-resample to an arbitrary target edge. Each output pixel votes over the
// source region it covers, so non-integer ratios (32 -> 28, 32 -> 26) work and
// the chunkiness can be dialled in small steps.
function resampleGrid(grid, target, weights) {
  const srcH = grid.length;
  const srcW = grid[0].length;
  if (!target || target >= srcW) return grid;

  const out = [];
  for (let y = 0; y < target; y++) {
    const y0 = Math.floor((y * srcH) / target);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / target));
    const row = [];
    for (let x = 0; x < target; x++) {
      const x0 = Math.floor((x * srcW) / target);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / target));
      const tally = {};
      for (let sy = y0; sy < y1 && sy < srcH; sy++) {
        for (let sx = x0; sx < x1 && sx < srcW; sx++) {
          const ch = grid[sy][sx];
          tally[ch] = (tally[ch] || 0) + 1;
        }
      }
      let best = '.';
      let bestScore = -1;
      for (const [ch, n] of Object.entries(tally)) {
        const score = n * (weights[ch] ?? 1);
        if (score > bestScore) {
          bestScore = score;
          best = ch;
        }
      }
      row.push(best);
    }
    out.push(row);
  }
  return out;
}

// Splits one multi-colour grid into a mask per tone, because the stage draws
// a layer at a time.
function toLayers(grid, toneMap) {
  const byTone = new Map();
  for (const [ch, tone] of Object.entries(toneMap)) {
    if (!byTone.has(tone)) byTone.set(tone, []);
    byTone.get(tone).push(ch);
  }
  // Body first, accent over it, outline over that, highlights last on top.
  const order = ['dim', 'faint', 'ink', 'cut'];
  const layers = [];
  for (const tone of order) {
    const chars = byTone.get(tone);
    if (!chars) continue;
    const mask = grid.map((row) => row.map((ch) => (chars.includes(ch) ? '#' : '.')).join(''));
    if (mask.some((r) => r.includes('#'))) layers.push({ tone, grid: mask });
  }
  return layers;
}

const cache = new Map();

export function quantizeSprite(id, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const key = `${id}|${opts.size}|${opts.denoise}|${JSON.stringify(opts.toneMap)}`;
  if (cache.has(key)) return cache.get(key);

  const sprite = rawData.sprites.find((s) => s.id === id);
  if (!sprite) {
    console.warn(`[clu3] unknown sprite cell "${id}"`);
    return { w: 0, h: 0, layers: [] };
  }

  let grid = toGrid(sprite.rows);
  if (opts.denoise) grid = denoiseGrid(grid);
  grid = resampleGrid(grid, opts.size, opts.weights);

  const result = { id, w: grid[0].length, h: grid.length, layers: toLayers(grid, opts.toneMap) };
  cache.set(key, result);
  return result;
}

// Places a quantized sprite's layers onto a stage at (x, y).
export function spriteLayers(id, { x = 0, y = 0, motion = null, options = {} } = {}) {
  const { layers } = quantizeSprite(id, options);
  return layers.map((l) => ({ grid: l.grid, tone: l.tone, x, y, motion }));
}

export function allSpriteIds() {
  return rawData.sprites.map((s) => s.id);
}

// Stable reference numbers for every pose, in sheet order (left-to-right,
// top-to-bottom). These are what poses are referred to by everywhere else —
// grouping poses into named combos, and in conversation about the art — so
// they must not be reordered once assigned. `id` stays the sheet coordinate
// the pose was extracted from.
export function allSprites() {
  return rawData.sprites.map((s, n) => ({ n, id: s.id, row: s.row, col: s.col }));
}

export function spriteIdByNumber(n) {
  const s = rawData.sprites[n];
  return s ? s.id : null;
}

export function clearQuantizeCache() {
  cache.clear();
}
