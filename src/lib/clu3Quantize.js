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

// Import attribute is required by the ESM spec for JSON, and Node enforces it.
// Webpack tolerates its absence, which is why this went unnoticed — the module
// simply could not be loaded outside the bundler until now.
import rawData from './clu3SpriteData.json' with { type: 'json' };

export const SHEET = rawData;
export const SPRITE_SIZE = rawData.cell;

const DEFAULT_TONE_MAP = { K: 'ink', B: 'dim', A: 'faint', H: 'cut' };

// Downsampling by majority vote alone eats thin outlines — a 1px black line
// loses every block it only partly fills. Weighting the vote keeps structure:
// outline beats blush beats body beats highlight beats background.
const DEFAULT_WEIGHTS = { K: 1.7, A: 1.25, B: 1.0, H: 0.85, '.': 1.0 };

// How the body mass is decided.
//
//   'solid'  TWO layers, nothing else: the dark pixels are the character, and
//            everything they enclose is fill. The source is a JPEG, so only
//            the outline survived sampling cleanly — the interior channels
//            (highlight, blush, body) are noise. Measured on the real sheet:
//            the highlight channel alone is 2,276 blobs averaging under 4px,
//            and because that tone paints the panel colour it was punching
//            ~70px of holes per sprite straight through the character. That
//            is the blotchiness, and it crawled between frames because the
//            noise differs per frame.
//
//            Deriving the mass from the outline instead makes it exact and
//            stable: all 121 sprites have a closed outline, so the flood
//            never leaks, and the same pose always yields the same fill. It
//            also leaves the interior as one flat region, which is the only
//            reason recolouring Clu3 is possible (--clu3-body).
//   'source' trust the extracted colour channels. Kept so the change stays
//            reversible and the sheet preview can show the difference.
//   'none'   line art only.
const BODY_FILL_MODES = ['solid', 'source', 'none'];

// Pose numbers (sheet order, see allSprites) whose fill is opaque white
// rather than the themed body colour. 55/56 are the outline-only ghost
// frames that end the spinOut run — as a flash they read as vanishing,
// which is what that run is for.
const PURE_WHITE_POSES = new Set([55, 56]);

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
  bodyFill: 'solid',
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

// Everything the outline encloses, as a boolean mask.
//
// Flood inward from all four borders through anything that is NOT outline;
// whatever the flood cannot reach is inside the character. Deriving the mass
// from the outline rather than from sampled colour is what makes it stable:
// the outline is crisp in the source, so the same pose always yields the
// same fill, and adjacent frames stop shimmering.
function enclosedMask(grid, outlineChars) {
  const h = grid.length;
  const w = grid[0].length;
  const outside = Array.from({ length: h }, () => new Array(w).fill(false));
  const stack = [];
  for (let x = 0; x < w; x++) {
    stack.push([x, 0], [x, h - 1]);
  }
  for (let y = 0; y < h; y++) {
    stack.push([0, y], [w - 1, y]);
  }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    if (outside[y][x]) continue;
    if (outlineChars.includes(grid[y][x])) continue;
    outside[y][x] = true;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  const mask = Array.from({ length: h }, () => new Array(w).fill(false));
  let filled = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!outside[y][x] && !outlineChars.includes(grid[y][x])) {
        mask[y][x] = true;
        filled++;
      }
    }
  }
  // A broken outline would let the flood swallow the character; rather than
  // render an empty ghost, say so and let the caller fall back.
  return filled > 0 ? mask : null;
}

// Splits one multi-colour grid into a mask per tone, because the stage draws
// a layer at a time. Only used by bodyFill:'source' — the 'solid' path builds
// its two layers directly.
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

function maskToRows(mask) {
  return mask.map((row) => row.map((on) => (on ? '#' : '.')).join(''));
}

const cache = new Map();

export function quantizeSprite(id, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const key = `${id}|${opts.size}|${opts.denoise}|${opts.bodyFill}|${JSON.stringify(opts.toneMap)}`;
  if (cache.has(key)) return cache.get(key);

  const spriteIndex = rawData.sprites.findIndex((s) => s.id === id);
  const sprite = spriteIndex === -1 ? null : rawData.sprites[spriteIndex];
  if (!sprite) {
    console.warn(`[clu3] unknown sprite cell "${id}"`);
    return { w: 0, h: 0, layers: [] };
  }

  let grid = toGrid(sprite.rows);
  if (opts.denoise) grid = denoiseGrid(grid);
  grid = resampleGrid(grid, opts.size, opts.weights);

  const mode = BODY_FILL_MODES.includes(opts.bodyFill) ? opts.bodyFill : 'solid';
  const outlineChars = Object.entries(opts.toneMap)
    .filter(([, tone]) => tone === 'ink')
    .map(([ch]) => ch);

  let layers;
  if (mode === 'source') {
    layers = toLayers(grid, opts.toneMap);
  } else {
    // Two layers, and only two: the dark pixels, and whatever they enclose.
    // Every other channel in the source is sampling noise (see above), so
    // there is deliberately no knockout or accent layer here — that is what
    // makes the interior flat, stable and recolourable.
    //
    // Derived after resampling, so the fill matches the outline actually
    // being drawn rather than the one at source resolution.
    const inkMask = grid.map((row) => row.map((ch) => outlineChars.includes(ch)));
    const bodyMask = mode === 'solid' ? enclosedMask(grid, outlineChars) : null;
    const bodyTone = PURE_WHITE_POSES.has(spriteIndex) ? 'bodyBright' : 'dim';
    layers = [];
    if (bodyMask) layers.push({ tone: bodyTone, grid: maskToRows(bodyMask) });
    layers.push({ tone: 'ink', grid: maskToRows(inkMask) });
  }

  const result = { id, w: grid[0].length, h: grid.length, layers };
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
