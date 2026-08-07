import anime from 'animejs';

// Subtle, tasteful motion helpers. Kept in one place so the "feel" of the
// whole device can be tuned from a single file.

export function viewEnter(el, direction = 'forward') {
  const x = direction === 'forward' ? 18 : -18;
  anime({
    targets: el,
    opacity: [0, 1],
    translateX: [x, 0],
    duration: 260,
    easing: 'easeOutCubic'
  });
}

export function viewExit(el, direction = 'forward') {
  const x = direction === 'forward' ? -18 : 18;
  return anime({
    targets: el,
    opacity: [1, 0],
    translateX: [0, x],
    duration: 180,
    easing: 'easeInCubic'
  }).finished;
}

export function staggerIn(nodeList) {
  anime({
    targets: nodeList,
    opacity: [0, 1],
    translateY: [10, 0],
    delay: anime.stagger(35, { start: 0 }),
    duration: 260,
    easing: 'easeOutQuad'
  });
}

export function collapseOut(el) {
  return anime({
    targets: el,
    opacity: [1, 0],
    scale: [1, 0.92],
    height: [el.offsetHeight, 0],
    marginBottom: [8, 0],
    duration: 220,
    easing: 'easeInCubic'
  }).finished;
}

export function pulse(el) {
  anime({
    targets: el,
    scale: [1, 1.03, 1],
    duration: 260,
    easing: 'easeOutQuad'
  });
}

export function tileToFull(tileRect, screenEl) {
  // FLIP-ish: grow a ghost rect from the tapped tile's bounds to fill the
  // screen, then fade it out as the real view fades in underneath.
  const ghost = document.createElement('div');
  ghost.style.position = 'absolute';
  ghost.style.left = `${tileRect.left}px`;
  ghost.style.top = `${tileRect.top}px`;
  ghost.style.width = `${tileRect.width}px`;
  ghost.style.height = `${tileRect.height}px`;
  ghost.style.borderRadius = '12px';
  ghost.style.background = 'rgba(255,255,255,0.5)';
  ghost.style.zIndex = '6';
  ghost.style.pointerEvents = 'none';
  screenEl.appendChild(ghost);

  const screenRect = screenEl.getBoundingClientRect();
  anime({
    targets: ghost,
    left: 0,
    top: 0,
    width: screenRect.width,
    height: screenRect.height,
    opacity: [0.9, 0],
    duration: 320,
    easing: 'easeOutQuint',
    complete: () => ghost.remove()
  });
}

export function badgePop(el) {
  anime({
    targets: el,
    scale: [0, 1.15, 1],
    duration: 320,
    easing: 'easeOutElastic(1, .6)'
  });
}

// ---- chart motion (src/lib/charts.js) ----
//
// Charts are pixel-grid SVG, built the same way icon() is: crisp rects, not
// smooth shapes. `round: 1` plus a `steps()` easing makes every intermediate
// frame land on a real cell boundary instead of a sub-pixel, anti-aliased
// one — that's the difference between "pixel chart" and "web chart with
// motion bolted on."
//
// `cells` is `[{ el, to: { height, y, opacity, ... } }]` — whatever SVG
// attributes the caller wants to land on. One anime() call animates the
// whole batch; `staggerRange` (a [min,max] pair) caps the total spread so a
// 28-cell chart doesn't crawl for a full second the way a fixed per-cell
// delay would.
export function growCells(cells, { duration = 260, easing = 'steps(6)', staggerRange = null } = {}) {
  if (!cells.length) return;
  const targets = cells.map((c) => c.el);
  const keys = new Set();
  for (const c of cells) for (const k of Object.keys(c.to)) keys.add(k);
  const props = {};
  for (const key of keys) {
    props[key] = (el, i) => cells[i].to[key];
  }
  anime({
    targets,
    ...props,
    round: 1,
    duration,
    easing,
    delay: staggerRange ? anime.stagger(staggerRange, { start: 0 }) : 0
  });
}

// The punchcard's first-mount-per-session moment: a diagonal self-test sweep
// (every cell to one uniform faint value) followed by a second pass dropping
// each cell to its real intensity — an LED panel's power-on test, not a
// fade-in. `cells` is `[{ el, to: <real opacity> }]`; `gridDims` is
// `[cols, rows]` for anime's grid-stagger.
export function bootSweep(cells, gridDims, { selfTestOpacity = 0.35 } = {}) {
  if (!cells.length) return;
  const targets = cells.map((c) => c.el);
  const timeline = anime.timeline({ easing: 'steps(4)' });
  timeline.add({
    targets,
    opacity: selfTestOpacity,
    duration: 260,
    delay: anime.stagger([0, 420], { grid: gridDims, from: 'first' })
  });
  timeline.add({
    targets,
    opacity: (el, i) => cells[i].to,
    duration: 260,
    delay: anime.stagger([0, 300], { grid: gridDims, from: 'first' })
  });
  return timeline;
}

// A real milestone deserves a moment, not a bigger number — a small burst of
// pixel confetti from wherever the milestone landed. Caller decides when a
// milestone genuinely occurred (a transition, never a re-render of the same
// value); this just draws the burst and cleans up after itself.
export function confettiBurst(originEl, { count = 10, className = 'pip-ch-confetti', spread = 14 } = {}) {
  const svg = originEl.ownerSVGElement || originEl.closest('svg');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const ox = Number(originEl.getAttribute('x') || 0) + Number(originEl.getAttribute('width') || 1) / 2;
  const oy = Number(originEl.getAttribute('y') || 0) + Number(originEl.getAttribute('height') || 1) / 2;

  const particles = [];
  for (let i = 0; i < count; i += 1) {
    const p = document.createElementNS(NS, 'rect');
    p.setAttribute('x', ox);
    p.setAttribute('y', oy);
    p.setAttribute('width', 1);
    p.setAttribute('height', 1);
    p.setAttribute('class', className);
    svg.appendChild(p);
    particles.push(p);
  }

  anime({
    targets: particles,
    x: () => ox + Math.round((Math.random() - 0.5) * spread * 2),
    y: () => oy + Math.round((Math.random() - 0.5) * spread * 2),
    opacity: [1, 0],
    round: 1,
    duration: 320,
    easing: 'easeOutQuint',
    complete: () => particles.forEach((p) => p.remove())
  });
}
