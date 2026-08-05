// The sprite/stage engine — Clu3's rendering primitive.
//
// A STAGE is a pixel canvas composed of LAYERS. A layer places a named sprite
// (or an inline grid) at a coordinate, in a tone, optionally animated:
//
//   { sprite: 'catSit', x: 10, y: 6, tone: 'ink', motion: 'bob' }
//
// Everything visual about Clu3 goes through here — the character, the room
// around them, props, and symbol overlays — so a new scene is data, not code.
// Motion is a CSS class (see styles/device.css), which keeps animation off the
// JS main thread entirely.
//
// Same lineage as lib/icons.js (8x8 UI glyphs) and lib/weatherArt.js: our own
// hand-authored pixels, no icon pack, no emoji.
//
// Tones:
//   'ink'   full-strength foreground
//   'dim'   background mass (walls, furniture)
//   'faint' barely-there detail (stars, distant texture)
//   'cut'   paints the panel background colour — use this to punch holes in an
//           ink shape (eyes on a dark cat). A translucent tone can't lighten
//           an opaque one beneath it, so knockouts must be an opaque fill.

const ON = '#';
const SVG_NS = 'http://www.w3.org/2000/svg';

const TONE_CLASS = {
  ink: 'pip-clu3-px-ink',
  dim: 'pip-clu3-px-body',
  faint: 'pip-clu3-px-faint',
  cut: 'pip-clu3-px-cut'
};

// ---- authoring helpers -------------------------------------------------
// Long rows are easy to miscount by a character, so sparse or repeating
// sprites are built rather than typed.

// Sparse sprite from explicit [x, y] points.
export function gridFrom(width, height, points) {
  const rows = Array.from({ length: height }, () => Array(width).fill('.'));
  for (const [x, y] of points) {
    if (y >= 0 && y < height && x >= 0 && x < width) rows[y][x] = ON;
  }
  return rows.map((r) => r.join(''));
}

// One row of a repeating pattern, clipped to width (e.g. a dashed floor).
export function hline(width, pattern = '#') {
  let row = '';
  while (row.length < width) row += pattern;
  return [row.slice(0, width)];
}

// ---- rendering ---------------------------------------------------------

function rect(x, y) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', '1');
  r.setAttribute('height', '1');
  return r;
}

// Hand-authored grids are easy to get wrong by one character, and a ragged
// grid renders subtly broken rather than failing — so say so loudly.
function assertRectangular(grid, name) {
  const w = grid[0] ? grid[0].length : 0;
  const bad = grid.findIndex((row) => row.length !== w);
  if (bad !== -1) {
    console.warn(
      `[sprites] "${name || 'inline'}" row ${bad} is ${grid[bad].length} chars, expected ${w} — art will be misaligned`
    );
  }
}

function paintLayer(svg, grid, { x = 0, y = 0, tone = 'ink', motion = null, className = '' }) {
  const g = document.createElementNS(SVG_NS, 'g');
  const classes = [TONE_CLASS[tone] || TONE_CLASS.ink];
  if (motion) classes.push(`pip-sp-${motion}`);
  if (className) classes.push(className);
  g.setAttribute('class', classes.join(' '));

  // Motion transforms rotate/translate around the sprite's own centre rather
  // than the canvas origin, so a swaying tail pivots where you'd expect.
  const w = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const h = grid.length;
  g.style.transformOrigin = `${x + w / 2}px ${y + h}px`;

  grid.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx += 1) {
      if (row[rx] === ON) g.appendChild(rect(x + rx, y + ry));
    }
  });
  svg.appendChild(g);
}

// spec: { width, height, layers: [...] }
// A layer needs either `sprite` (a key in the supplied atlas) or `grid`.
export function renderStage(spec, atlas = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${spec.width} ${spec.height}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `pip-sp-stage ${spec.className || ''}`.trim());

  for (const layer of spec.layers || []) {
    const grid = layer.grid || atlas[layer.sprite];
    if (!grid) {
      // A typo'd sprite name should be obvious but not fatal.
      console.warn(`[sprites] unknown sprite "${layer.sprite}"`);
      continue;
    }
    assertRectangular(grid, layer.sprite);
    paintLayer(svg, grid, layer);
  }

  return svg;
}
