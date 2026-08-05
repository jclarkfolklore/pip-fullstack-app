// Deep-link highlighting: a search result click should land you on the exact
// card, not just the right widget. One-shot by design — ctx.pendingHighlight
// is consumed the moment the target widget mounts, so re-entering that widget
// later (without a fresh search) never re-triggers it. This is what "release
// the highlight when search mode is exited" reduces to: nothing re-applies it
// once it's been consumed or explicitly cleared.

const CLASS = 'pip-highlight-flash';

// Call once per widget mount. Returns the target id if this widget is the
// one a search result pointed at, and clears it from ctx so it can't fire
// twice (e.g. on a later onChange-triggered re-render).
export function consumeHighlight(ctx, kind) {
  const pending = ctx.pendingHighlight;
  if (!pending || pending.kind !== kind) return null;
  ctx.pendingHighlight = null;
  return pending.id;
}

// Scrolls the element into view and flashes it. The flash class removes
// itself via animationend so nothing lingers if the user never navigates
// away — "release" happens on its own after the animation, not just on exit.
export function applyHighlight(el) {
  clearHighlightNow();
  el.classList.add(CLASS);
  el.addEventListener('animationend', () => el.classList.remove(CLASS), { once: true });
}

// Proactively wipes any live highlight — used when search itself is exited
// (mobile overlay closes, desktop query is cleared) so a flash still fading
// on the current view doesn't feel orphaned from the search that caused it.
export function clearHighlightNow() {
  document.querySelectorAll(`.${CLASS}`).forEach((el) => el.classList.remove(CLASS));
}
