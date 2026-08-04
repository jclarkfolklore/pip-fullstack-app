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
