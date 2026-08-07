// Hand-built SVG chart primitives — the graphic-first replacement for the
// old text-and-counts Metrics view. Same construction as icon() in
// icons.js: crisp rects, integer coordinates, fills through the --lcd-*
// theme variables (via CSS classes, never inline colors) — never a
// generic charting library dropped onto a pixel-art device.
//
// Three rules hold across every primitive here:
//
// 1. `{ el, update(data), elFor(key) }`. `update` is a diff, not a rebuild:
//    each cell carries a stable `data-key`, and only cells whose value
//    actually changed animate. The widget re-renders on every SSE tick, so
//    replaying an entrance twice a second would be worse than plain text.
// 2. Growth is quantized (`round: 1`, `steps()` easing — see growCells in
//    animations.js). A smoothly interpolated bar reads as a web chart with
//    motion bolted on; one that steps through discrete pixel heights reads
//    as this device drawing it.
// 3. Structure is drawn, not implied. Baselines, gridlines and empty cells
//    are rendered even when there's no data in them — a chart whose marks
//    float in blank space can't be read, because nothing says where zero is
//    or how far the axis goes.
//
// Every value-bearing mark also gets an SVG <title>, so hovering any bar or
// cell gives its real number without the chart having to be dense with text.

import anime from 'animejs';
import { growCells, bootSweep, pulse } from './animations.js';

const NS = 'http://www.w3.org/2000/svg';

// Five relative steps. Every scale in this file is computed from the data's
// own max rather than a fixed ceiling — the app has no idea how much work a
// given week holds, so a fixed scale would either clip a busy week or
// flatten a quiet one into nothing.
const HEAT_STEPS = 5;

function svgRoot(w, h, className) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  if (className) svg.setAttribute('class', className);
  return svg;
}

function rect(x, y, w, h, className, key) {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', x);
  r.setAttribute('y', y);
  r.setAttribute('width', Math.max(0, w));
  r.setAttribute('height', Math.max(0, h));
  if (className) r.setAttribute('class', className);
  if (key != null) r.setAttribute('data-key', key);
  return r;
}

function titled(el, text) {
  const t = document.createElementNS(NS, 'title');
  t.textContent = text;
  el.appendChild(t);
  return el;
}

function setTitle(el, text) {
  const t = el.querySelector('title');
  if (t) t.textContent = text;
  else titled(el, text);
}

// Axis tick labels are drawn inside the SVG rather than beside it in HTML,
// so they scale with the chart and stay pinned to the value they name at any
// width — side-by-side HTML labels drift as soon as the chart is responsive.
function svgText(x, y, str, cls, anchor) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', x);
  t.setAttribute('y', y);
  t.setAttribute('text-anchor', anchor);
  t.setAttribute('class', cls);
  t.textContent = str;
  return t;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setAll(cells) {
  for (const { el, to } of cells) {
    for (const [k, v] of Object.entries(to)) el.setAttribute(k, v);
  }
}

// Relative bucket, 1..HEAT_STEPS, or 0 for genuinely nothing.
function heatLevel(v, max) {
  if (!v) return 0;
  return Math.min(HEAT_STEPS, Math.max(1, Math.ceil((v / max) * HEAT_STEPS)));
}

// ---------------------------------------------------------------------------
// columnChart — the throughput chart, the per-project small multiples, and
// (via `horizontal: true`) the time-to-close histogram.
//
// `items`: [{ key, value, ghost?, label? }]. `ghost` marks a day before the
// log existed (see firstEventAt): drawn as a fixed faint tick, never as an
// animated real zero — a zero bar for a day that predates logging would be
// a padded number.
//
// `max` can be supplied to force a shared scale. Small multiples MUST pass
// it: independently-scaled mini-charts make a project with 2 completions
// look identical to one with 20, which is the single easiest way for a
// grid of sparklines to mislead.
// ---------------------------------------------------------------------------
export function columnChart(items, opts = {}) {
  const {
    width = 280,
    height = 72,
    tone = 'accent-2',
    horizontal = false,
    gap = 3,
    max: fixedMax = null,
    gridlines = true,
    unit = '',
    gutterLeft = 0
  } = opts;

  const PAD = 4;
  const svg = svgRoot(width, height, 'pip-chart');
  const axisLen = (horizontal ? width : height) - PAD;
  // A y-axis gutter only applies to the vertical orientation; the horizontal
  // histogram names its bars with its own row labels instead.
  const plotLeft = horizontal ? 0 : gutterLeft;
  const crossLen = (horizontal ? height : width) - plotLeft;
  const yTicks = [];
  const cells = [];
  const prev = new Map();
  let max = 1;

  // Structure first, so it sits behind the data.
  if (gridlines) {
    for (const frac of [0.5, 1]) {
      const g = horizontal
        ? rect(Math.round(PAD + axisLen * frac) - 1, 0, 1, height, 'pip-ch-gridline')
        : rect(plotLeft, Math.round(height - PAD - axisLen * frac), width - plotLeft, 1, 'pip-ch-gridline');
      svg.appendChild(g);
    }
  }
  svg.appendChild(
    horizontal
      ? rect(PAD - 1, 0, 1, height, 'pip-ch-axis')
      : rect(plotLeft, height - PAD, width - plotLeft, 1, 'pip-ch-axis')
  );

  // Ticks for full scale, half scale and zero — without a number on the axis
  // a bar's height is a shape, not a quantity.
  if (!horizontal && gutterLeft > 0) {
    for (const frac of [1, 0.5, 0]) {
      const t = svgText(
        gutterLeft - 4,
        Math.round(height - PAD - axisLen * frac) + (frac === 1 ? 6 : 3),
        '',
        'pip-ch-axis-label',
        'end'
      );
      svg.appendChild(t);
      yTicks.push({ el: t, frac });
    }
  }

  function valueLen(v) {
    if (v <= 0) return 0;
    return Math.max(2, Math.round((v / max) * (axisLen - 2)));
  }

  function build(initial) {
    const n = initial.length || 1;
    const thick = Math.max(2, Math.floor(crossLen / n) - gap);
    initial.forEach((d, i) => {
      const pos = Math.round(plotLeft + i * (crossLen / n));
      if (d.ghost) {
        // A day before the log existed, and a day with a real zero, must not
        // look identical — otherwise "nothing happened" and "we weren't
        // recording" are the same picture.
        const el = horizontal
          ? rect(PAD, pos, 2, thick, 'pip-ch-ghost', d.key)
          : rect(pos, height - PAD - 2, thick, 2, 'pip-ch-ghost', d.key);
        titled(el, `${d.label || d.key} — before tracking began`);
        svg.appendChild(el);
        cells.push({ key: d.key, el, ghost: true });
        prev.set(d.key, 0);
        return;
      }
      const el = horizontal
        ? rect(PAD, pos, 0, thick, `pip-ch-bar pip-ch-tone-${tone}`, d.key)
        : rect(pos, height - PAD, thick, 0, `pip-ch-bar pip-ch-tone-${tone}`, d.key);
      titled(el, '');
      svg.appendChild(el);
      cells.push({ key: d.key, el, ghost: false });
      prev.set(d.key, null);
    });
  }

  function apply(next, { entrance = false } = {}) {
    const real = next.filter((d) => !d.ghost).map((d) => d.value || 0);
    max = fixedMax != null ? Math.max(1, fixedMax) : Math.max(1, ...real);
    for (const t of yTicks) t.el.textContent = String(Math.round(max * t.frac));
    const grow = [];
    for (const d of next) {
      const cell = cells.find((c) => c.key === d.key);
      if (!cell || cell.ghost) continue;
      const value = d.value || 0;
      setTitle(cell.el, `${d.label || d.key}: ${value}${unit ? ` ${unit}` : ''}`);
      if (!entrance && prev.get(d.key) === value) continue;
      const len = valueLen(value);
      grow.push({
        el: cell.el,
        to: horizontal ? { width: len } : { height: len, y: height - PAD - len }
      });
      prev.set(d.key, value);
    }
    if (!grow.length) return;
    if (prefersReducedMotion()) return setAll(grow);
    growCells(grow, { staggerRange: entrance ? [0, 420] : null });
  }

  build(items);
  apply(items, { entrance: true });

  return {
    el: svg,
    update: (next, nextOpts = {}) => {
      if (nextOpts.max != null) max = Math.max(1, nextOpts.max);
      apply(next, { entrance: false });
    },
    maxValue: () => max,
    elFor: (key) => cells.find((c) => c.key === key)?.el || null
  };
}

export function sparkline(items, opts = {}) {
  return columnChart(items, { width: 104, height: 34, gap: 2, gridlines: false, ...opts });
}

// ---------------------------------------------------------------------------
// divergingColumns — net created vs. closed, growing out from a center zero
// line. A sign flip (the direction actually reversed) gets a pulse; a
// magnitude change on the same side does not, since that happens on almost
// every tick and isn't the meaningful event.
// ---------------------------------------------------------------------------
export function divergingColumns(items, opts = {}) {
  const { width = 280, height = 64, gap = 3, toneUp = 'green', toneDown = 'accent', gutterLeft = 0 } = opts;
  const svg = svgRoot(width, height, 'pip-chart');
  const mid = Math.round(height / 2);
  const plotLeft = gutterLeft;
  const plotWidth = width - plotLeft;
  const yTicks = [];
  const cells = [];
  const prev = new Map();
  const prevSign = new Map();
  let max = 1;

  const zeroLine = rect(plotLeft, mid, plotWidth, 1, 'pip-ch-axis');

  function segLen(v) {
    return v === 0 ? 0 : Math.max(2, Math.round((Math.abs(v) / max) * (mid - 3)));
  }

  function build(initial) {
    const n = initial.length || 1;
    if (gutterLeft > 0) {
      // +max at the top, zero on the line, -max at the bottom: the sign is
      // the whole point of this chart, so the axis has to carry it.
      for (const [frac, y] of [
        [1, 8],
        [0, mid - 3],
        [-1, height - 2]
      ]) {
        const t = svgText(gutterLeft - 4, y, '', 'pip-ch-axis-label', 'end');
        svg.appendChild(t);
        yTicks.push({ el: t, frac });
      }
    }
    initial.forEach((d, i) => {
      const thick = Math.max(2, Math.floor(plotWidth / n) - gap);
      const x = Math.round(plotLeft + i * (plotWidth / n));
      if (d.ghost) {
        const el = rect(x, mid - 1, thick, 2, 'pip-ch-ghost', d.key);
        titled(el, `${d.label || d.key} — before tracking began`);
        svg.appendChild(el);
        cells.push({ key: d.key, el, ghost: true });
        return;
      }
      const el = rect(x, mid, thick, 0, `pip-ch-bar pip-ch-tone-${toneUp}`, d.key);
      titled(el, '');
      svg.appendChild(el);
      cells.push({ key: d.key, el, ghost: false });
      prev.set(d.key, null);
      prevSign.set(d.key, 0);
    });
    // Drawn last so the zero line reads on top of the bars that touch it.
    svg.appendChild(zeroLine);
  }

  function apply(next, { entrance = false } = {}) {
    max = Math.max(1, ...next.filter((d) => !d.ghost).map((d) => Math.abs(d.value || 0)));
    for (const t of yTicks) {
      t.el.textContent = t.frac === 0 ? '0' : `${t.frac > 0 ? '+' : '−'}${max}`;
    }
    const grow = [];
    for (const d of next) {
      const cell = cells.find((c) => c.key === d.key);
      if (!cell || cell.ghost) continue;
      const value = d.value || 0;
      const sign = Math.sign(value);
      const verdict = value > 0 ? `+${value} net closed` : value < 0 ? `${-value} net added` : 'even';
      setTitle(cell.el, `${d.label || d.key}: ${verdict}`);
      if (!entrance && prev.get(d.key) === value) continue;
      const len = segLen(value);
      cell.el.setAttribute('class', `pip-ch-bar pip-ch-tone-${sign < 0 ? toneDown : toneUp}`);
      grow.push({ el: cell.el, to: sign < 0 ? { height: len, y: mid } : { height: len, y: mid - len } });
      if (!entrance) {
        const was = prevSign.get(d.key);
        if (was !== 0 && sign !== 0 && was !== sign && !prefersReducedMotion()) pulse(cell.el);
      }
      prev.set(d.key, value);
      prevSign.set(d.key, sign);
    }
    if (!grow.length) return;
    if (prefersReducedMotion()) return setAll(grow);
    growCells(grow, { staggerRange: entrance ? [0, 420] : null });
  }

  build(items);
  apply(items, { entrance: true });

  return {
    el: svg,
    update: (next) => apply(next, { entrance: false }),
    maxValue: () => max,
    elFor: (key) => cells.find((c) => c.key === key)?.el || null
  };
}

// ---------------------------------------------------------------------------
// calendarHeat — the contribution calendar. Columns are weeks, rows are the
// seven weekdays, exactly the shape GitHub trained everyone to read: a wide
// horizontal band where time runs left to right and you can see streaks,
// gaps and weekly rhythm at a glance.
//
// `days`: [{ key: 'YYYY-MM-DD', n, ghost? }] in ascending date order, one
// entry per calendar day including the empty ones. `ghost` marks a day
// before the log existed — drawn in a distinct empty tone, because a zero
// for a day that predates tracking would be a padded number.
// ---------------------------------------------------------------------------
export function calendarHeat(days, opts = {}) {
  const {
    cell = 9,
    gap = 2,
    gutterLeft = 20,
    gutterTop = 13,
    weekdayLabels = ['', 'M', '', 'W', '', 'F', ''],
    monthLabel = () => '',
    dayTitle = (k) => k
  } = opts;

  const step = cell + gap;
  // Pad the head of the range so the first column starts on a Sunday, the
  // way a calendar's weeks actually break.
  const lead = days.length ? new Date(`${days[0].key}T00:00:00`).getDay() : 0;
  const slots = lead + days.length;
  const cols = Math.ceil(slots / 7);
  const width = gutterLeft + cols * step - gap;
  const height = gutterTop + 7 * step - gap;

  const svg = svgRoot(width, height, 'pip-chart pip-ch-cal');
  const cells = [];
  const prev = new Map();
  let mounted = false;
  let max = 1;

  function text(x, y, str, cls, anchor) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('class', cls);
    t.textContent = str;
    return t;
  }

  function build() {
    for (let r = 0; r < 7; r += 1) {
      if (!weekdayLabels[r]) continue;
      svg.appendChild(
        text(gutterLeft - 4, gutterTop + r * step + cell - 1, weekdayLabels[r], 'pip-ch-axis-label', 'end')
      );
    }

    let lastMonth = null;
    days.forEach((d, i) => {
      const slot = lead + i;
      const col = Math.floor(slot / 7);
      const row = slot % 7;
      const x = gutterLeft + col * step;
      const y = gutterTop + row * step;

      // A month label once, above the column where that month first appears.
      const month = d.key.slice(0, 7);
      if (month !== lastMonth) {
        lastMonth = month;
        svg.appendChild(text(x, gutterTop - 4, monthLabel(d.key), 'pip-ch-axis-label', 'start'));
      }

      const el = rect(
        x,
        y,
        cell,
        cell,
        d.ghost ? 'pip-ch-cell pip-ch-cal-ghost' : 'pip-ch-cell pip-ch-heat-0',
        d.key
      );
      titled(el, '');
      svg.appendChild(el);
      cells.push({ key: d.key, el, ghost: !!d.ghost });
      prev.set(d.key, null);
    });
  }

  function apply(next, { entrance = false } = {}) {
    max = Math.max(1, ...next.filter((d) => !d.ghost).map((d) => d.n || 0));
    const changed = [];
    for (const d of next) {
      const cellObj = cells.find((c) => c.key === d.key);
      if (!cellObj) continue;
      if (d.ghost) {
        setTitle(cellObj.el, `${dayTitle(d.key)} — before tracking began`);
        continue;
      }
      const n = d.n || 0;
      setTitle(cellObj.el, `${dayTitle(d.key)} — ${n} event${n === 1 ? '' : 's'}`);
      if (!entrance && prev.get(d.key) === n) continue;
      prev.set(d.key, n);
      cellObj.el.setAttribute('class', `pip-ch-cell pip-ch-heat-${heatLevel(n, max)}`);
      changed.push({ el: cellObj.el, to: 1 });
    }
    if (!changed.length) return;
    if (prefersReducedMotion()) {
      return changed.forEach(({ el }) => el.setAttribute('opacity', 1));
    }
    if (entrance && !mounted) {
      mounted = true;
      bootSweep(changed, [cols, 7]);
    } else {
      changed.forEach(({ el }) => el.setAttribute('opacity', 1));
    }
  }

  build();
  apply(days, { entrance: true });

  return {
    el: svg,
    update: (next) => apply(next, { entrance: false }),
    maxValue: () => max,
    levels: HEAT_STEPS,
    elFor: (key) => cells.find((c) => c.key === key)?.el || null
  };
}

// ---------------------------------------------------------------------------
// pieChart — proportion, rasterised onto a pixel grid.
//
// A real arc would need smooth curves, which is the one thing this device's
// vocabulary doesn't have. So the pie is drawn the way the icons are: decide
// per grid cell which slice its angle falls into, and fill that cell. The
// result is a genuinely chunky, aliased pie — axis-aligned rects only, no
// rotation, no anti-aliasing — which reads as proportion at a glance without
// implying (as a row of discrete blocks did) that each block is a countable
// unit.
// ---------------------------------------------------------------------------
export function pieChart(segments, opts = {}) {
  const { cells: gridN = 21, cell = 5, gap = 1, donut = 0.42 } = opts;
  const step = cell + gap;
  const size = gridN * step - gap;
  const svg = svgRoot(size, size, 'pip-chart pip-ch-pie');
  const mid = size / 2;
  const radius = size / 2;
  const inner = radius * donut;
  const wedges = [];

  for (let gy = 0; gy < gridN; gy += 1) {
    for (let gx = 0; gx < gridN; gx += 1) {
      const x = gx * step;
      const y = gy * step;
      const dx = x + cell / 2 - mid;
      const dy = y + cell / 2 - mid;
      const r = Math.hypot(dx, dy);
      if (r > radius - cell * 0.35 || r < inner) continue;
      // 0 at 12 o'clock, increasing clockwise — the direction a pie is read.
      const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
      const el = rect(x, y, cell, cell, 'pip-ch-pie-cell pip-ch-heat-0');
      titled(el, '');
      svg.appendChild(el);
      wedges.push({ el, angle });
    }
  }
  // Sweep order — the entrance animation reads as a radar wipe rather than
  // an arbitrary shimmer.
  wedges.sort((a, b) => a.angle - b.angle);

  let prevKeys = null;

  function apply(next, { entrance = false } = {}) {
    const total = next.reduce((a, s) => a + (s.value || 0), 0);
    const bounds = [];
    let acc = 0;
    for (const s of next) {
      const start = (acc / (total || 1)) * Math.PI * 2;
      acc += s.value || 0;
      const end = (acc / (total || 1)) * Math.PI * 2;
      bounds.push({ ...s, start, end });
    }

    const keys = [];
    for (const w of wedges) {
      const seg =
        total > 0
          ? bounds.find((b) => w.angle >= b.start && w.angle < b.end) || bounds[bounds.length - 1]
          : null;
      keys.push(seg ? seg.key : null);
      const cls = seg
        ? `pip-ch-pie-cell pip-ch-tone-${seg.tone || 'accent-2'}`
        : 'pip-ch-pie-cell pip-ch-heat-0';
      if (w.el.getAttribute('class') !== cls) w.el.setAttribute('class', cls);
      if (seg) {
        const pct = total ? Math.round((seg.value / total) * 100) : 0;
        setTitle(w.el, `${seg.label || seg.key}: ${seg.value} (${pct}%)`);
      }
    }

    const changed = prevKeys ? wedges.filter((_, i) => prevKeys[i] !== keys[i]) : wedges;
    prevKeys = keys;
    if (!changed.length || prefersReducedMotion()) return;
    anime({
      targets: changed.map((w) => w.el),
      opacity: [0, 1],
      duration: 200,
      easing: 'steps(3)',
      delay: entrance ? anime.stagger([0, 420], { start: 0 }) : 0
    });
  }

  apply(segments, { entrance: true });

  return { el: svg, update: (next) => apply(next, { entrance: false }), elFor: () => null };
}

// ---------------------------------------------------------------------------
// tagGraph — tags as a network, not a leaderboard.
//
// Node size and colour = how often a tag is used; edge weight = how often
// two tags land on the same record. Both come straight from entity_tags, so
// a link means "these really were applied together", never an inferred
// similarity.
//
// Layout is a small force simulation run for a fixed number of iterations at
// build time and then frozen — no rAF loop, nothing running while the
// dashboard sits open. Initial positions are seeded from a hash of the tag
// name so the same data always lays out the same way; a graph that
// rearranges itself on every re-render is unreadable.
// ---------------------------------------------------------------------------
function hashSeed(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function tagGraph(data, opts = {}) {
  const { width = 320, height = 260, iterations = 260, minLink = 1, showLabels = true } = opts;
  const svg = svgRoot(width, height, 'pip-chart pip-ch-graph');
  let state = { minLink, showLabels };

  function simulate(nodes, links) {
    const pts = nodes.map((n, i) => {
      const a = hashSeed(n.id) * Math.PI * 2;
      const rad = 20 + hashSeed(`${n.id}#r`) * Math.min(width, height) * 0.32;
      return { ...n, x: width / 2 + Math.cos(a) * rad, y: height / 2 + Math.sin(a) * rad, i };
    });
    const index = new Map(pts.map((p) => [p.id, p]));
    const edges = links
      .filter((l) => l.n >= state.minLink && index.has(l.source) && index.has(l.target))
      .map((l) => ({ a: index.get(l.source), b: index.get(l.target), n: l.n }));

    for (let it = 0; it < iterations; it += 1) {
      const cool = 1 - it / iterations;
      // Repulsion — every pair pushes apart, so unrelated tags don't pile up.
      for (let i = 0; i < pts.length; i += 1) {
        for (let j = i + 1; j < pts.length; j += 1) {
          const p = pts[i];
          const q = pts[j];
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (hashSeed(`${p.id}${q.id}`) - 0.5) * 2;
            dy = (hashSeed(`${q.id}${p.id}`) - 0.5) * 2;
            d2 = 1;
          }
          const force = (900 * cool) / d2;
          const d = Math.sqrt(d2);
          p.x -= (dx / d) * force;
          p.y -= (dy / d) * force;
          q.x += (dx / d) * force;
          q.y += (dy / d) * force;
        }
      }
      // Attraction along real co-occurrences, weighted by how often.
      for (const e of edges) {
        const dx = e.b.x - e.a.x;
        const dy = e.b.y - e.a.y;
        const d = Math.hypot(dx, dy) || 1;
        const force = ((d - 46) * 0.012 * Math.min(3, e.n) * cool) / 1;
        e.a.x += (dx / d) * force;
        e.a.y += (dy / d) * force;
        e.b.x -= (dx / d) * force;
        e.b.y -= (dy / d) * force;
      }
      // Gentle pull to centre so disconnected tags don't drift off-canvas.
      for (const p of pts) {
        p.x += (width / 2 - p.x) * 0.012 * cool;
        p.y += (height / 2 - p.y) * 0.012 * cool;
      }
    }

    const pad = 16;
    for (const p of pts) {
      p.x = Math.max(pad, Math.min(width - pad, p.x));
      p.y = Math.max(pad, Math.min(height - pad, p.y));
    }
    return { pts, edges };
  }

  function draw() {
    svg.replaceChildren();
    const nodes = data.nodes || [];
    const links = data.links || [];
    if (!nodes.length) return;

    const { pts, edges } = simulate(nodes, links);
    const maxN = Math.max(1, ...nodes.map((n) => n.n));
    const maxLink = Math.max(1, ...links.map((l) => l.n));

    for (const e of edges) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', Math.round(e.a.x));
      line.setAttribute('y1', Math.round(e.a.y));
      line.setAttribute('x2', Math.round(e.b.x));
      line.setAttribute('y2', Math.round(e.b.y));
      line.setAttribute('stroke-width', Math.max(1, Math.round((e.n / maxLink) * 3)));
      line.setAttribute('class', `pip-ch-graph-link pip-ch-linkw-${heatLevel(e.n, maxLink)}`);
      titled(line, `${e.a.id} + ${e.b.id}: ${e.n} shared record${e.n === 1 ? '' : 's'}`);
      svg.appendChild(line);
    }

    // Labels are placed most-used first, and any that would collide with one
    // already placed is dropped. A graph where five names overlap into an
    // unreadable smear is worse than one that labels only what it can label
    // legibly — every node still carries its name in the hover title.
    const placed = [];
    const CHAR_W = 5.1;
    const LABEL_H = 10;

    for (const p of [...pts].sort((a, b) => b.n - a.n)) {
      const level = heatLevel(p.n, maxN);
      const s = 5 + Math.round((p.n / maxN) * 9);
      const half = Math.round(s / 2);
      const el = rect(
        Math.round(p.x) - half,
        Math.round(p.y) - half,
        s,
        s,
        `pip-ch-graph-node pip-ch-heat-${level}`,
        p.id
      );
      titled(el, `#${p.id} — used ${p.n} time${p.n === 1 ? '' : 's'}`);
      svg.appendChild(el);

      if (!state.showLabels) continue;
      const w = p.id.length * CHAR_W;
      const box = {
        x1: p.x - w / 2,
        x2: p.x + w / 2,
        y1: p.y + half + 1,
        y2: p.y + half + 1 + LABEL_H
      };
      if (placed.some((q) => box.x1 < q.x2 && box.x2 > q.x1 && box.y1 < q.y2 && box.y2 > q.y1)) continue;
      placed.push(box);

      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', Math.round(p.x));
      label.setAttribute('y', Math.round(box.y2) - 1);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'pip-ch-graph-label');
      label.textContent = p.id;
      svg.appendChild(label);
    }

    if (!prefersReducedMotion()) {
      anime({
        targets: svg.querySelectorAll('.pip-ch-graph-node'),
        opacity: [0, 1],
        duration: 220,
        easing: 'steps(3)',
        delay: anime.stagger([0, 360], { start: 0 })
      });
    }
  }

  draw();

  return {
    el: svg,
    update: (nextData) => {
      data = nextData;
      draw();
    },
    setOptions: (next) => {
      state = { ...state, ...next };
      draw();
    },
    elFor: (key) => svg.querySelector(`.pip-ch-graph-node[data-key="${key}"]`)
  };
}
