#!/usr/bin/env node
// Extracts the Clu3 sprite sheet into raw, indexed-colour character grids.
//
// This is STEP ONE of two, and it is deliberately lossless-ish: it classifies
// every source pixel into a small semantic palette and writes the full 32x32
// grid for all 121 cells. It does NOT apply the app's pixel style — that's
// clu3Quantize.js, a separate pass you can re-tune or throw away without
// re-running this. Keeping the raw extraction committed is the whole point:
// the style filter is reversible because this file survives it.
//
// Input is a BMP because Node can decode one with no dependencies (24bpp,
// uncompressed). Convert first:
//   sips -s format bmp sheet.jpg --out sheet.bmp
//
// Usage: node scripts/clu3-extract-sheet.js <sheet.bmp> [out.json]
//
// Palette characters:
//   '.'  exterior background (flood-filled from the cell border)
//   'K'  dark    — outline, hair/ears, eyes, mouth
//   'B'  body    — the yellow fill
//   'A'  accent  — pink/red blush and tongue
//   'H'  highlight — light pixels enclosed by the sprite (eye whites, the
//                    outline-only "ghost" cells), NOT background

const fs = require('fs');
const path = require('path');

const CELL = 32;
const COLS = 11;
const ROWS = 11;

function readBmp(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 2) !== 'BM') throw new Error('not a BMP');
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const hRaw = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28);
  if (bpp !== 24) throw new Error(`expected 24bpp, got ${bpp}`);
  if (b.readUInt32LE(30) !== 0) throw new Error('compressed BMP not supported');
  const h = Math.abs(hRaw);
  const topDown = hRaw < 0;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  return {
    w,
    h,
    px(x, y) {
      const row = topDown ? y : h - 1 - y;
      const i = off + row * rowSize + x * 3;
      return [b[i + 2], b[i + 1], b[i]]; // BMP stores BGR
    }
  };
}

// Source art is JPEG-compressed, so nothing is an exact colour — classify by
// character (is it dark? is it warm? how light?) rather than exact matching.
function classify(r, g, bl) {
  const lum = (r + g + bl) / 3;
  if (lum < 120) return 'K';
  const warm = r - bl;
  if (r > 185 && g < r - 22 && bl > 120 && warm < 90) return 'A'; // pink blush
  if (lum > 218 && warm < 28) return 'H'; // white-ish; may be background
  if (warm >= 28) return 'B'; // yellow body
  return lum > 200 ? 'H' : 'B';
}

// Only background touching the cell edge is transparent — otherwise eye whites
// and the outline-only cells would be punched full of holes.
function floodBackground(grid) {
  const seen = Array.from({ length: CELL }, () => new Array(CELL).fill(false));
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
    if (seen[y][x]) return;
    if (grid[y][x] !== 'H') return;
    seen[y][x] = true;
    queue.push([x, y]);
  };
  for (let i = 0; i < CELL; i++) {
    push(i, 0);
    push(i, CELL - 1);
    push(0, i);
    push(CELL - 1, i);
  }
  while (queue.length) {
    const [x, y] = queue.pop();
    grid[y][x] = '.';
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

function extract(bmpPath) {
  const img = readBmp(bmpPath);
  if (img.w !== COLS * CELL || img.h !== ROWS * CELL) {
    throw new Error(`expected ${COLS * CELL}x${ROWS * CELL}, got ${img.w}x${img.h}`);
  }

  const sprites = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const grid = [];
      for (let y = 0; y < CELL; y++) {
        const row = [];
        for (let x = 0; x < CELL; x++) {
          const [pr, pg, pb] = img.px(c * CELL + x, r * CELL + y);
          row.push(classify(pr, pg, pb));
        }
        grid.push(row);
      }
      floodBackground(grid);

      const rows = grid.map((row) => row.join(''));
      const filled = rows
        .join('')
        .split('')
        .filter((ch) => ch !== '.').length;
      sprites.push({ id: `${r},${c}`, row: r, col: c, filled, rows });
    }
  }
  return sprites;
}

const inFile = process.argv[2];
const outFile = process.argv[3] || path.resolve(__dirname, '..', 'src', 'lib', 'clu3SpriteData.json');
if (!inFile) {
  console.error('usage: node scripts/clu3-extract-sheet.js <sheet.bmp> [out.json]');
  process.exit(1);
}

const sprites = extract(inFile);
fs.writeFileSync(outFile, JSON.stringify({ cell: CELL, cols: COLS, rows: ROWS, sprites }, null, 0));
console.log(`extracted ${sprites.length} sprites -> ${outFile}`);
const empty = sprites.filter((s) => s.filled < 60);
if (empty.length) console.log(`note: ${empty.length} near-empty cell(s):`, empty.map((s) => s.id).join(' '));
