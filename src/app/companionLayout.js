// Decides whether Clu3 and/or the forecast should render in a compact form
// on a DESKTOP window that's short on height — as opposed to narrow, which
// the unconditional CSS media query in device.css (max-width: 859px)
// already handles on its own, with no help from this.
//
// WHY MEASURED, NOT A CSS BREAKPOINT. Clu3's panel height depends on how
// long its current message is, so no single viewport-height number is "the"
// right threshold — a fixed number either compacts too early for a short
// message or too late for a long one. What actually decides this is a
// direct comparison: would leaving things as they are push search below
// where it's still useful? That's answered by comparing the column's actual
// content height at a given state against the space actually available, not
// by guessing a pixel number ahead of time and hoping it holds for every
// message and every window size.
//
// WHY TWO STEPS. Compacting Clu3 to a thumbnail is a bigger visual change
// than tightening the forecast, so it's held in reserve: the forecast alone
// gives up its "rest of the week" and some padding first, and Clu3 only
// joins in if that alone still isn't enough room for search. STATES lists
// them from least to most compact — recheck() tries each in order and stops
// at the first one that fits, so a window that only needs a little space
// back doesn't pay for the bigger change.
//
// This only sets data-companions on .pip-side. All the actual visual
// compacting is CSS in device.css, under `.pip-side[data-companions='...']`
// — kept in sync by comment cross-reference with the mobile block, since
// there's no preprocessor here to share it for real.
const STATES = ['', 'weather', 'compact'];

export function watchCompanionLayout(sideEl) {
  if (!sideEl) return () => {};

  let scheduled = false;

  function recheck() {
    scheduled = false;

    // Mobile: .pip-side is display:contents there (no box of its own — see
    // device.css), so it has nothing to measure and nothing to decide; the
    // dedicated mobile media query already compacts unconditionally.
    if (!sideEl.clientHeight) return;

    // Try least-compact first. Setting the attribute and immediately reading
    // scrollHeight forces a synchronous layout each time — several of those
    // per call, but this only runs once per animation frame (see schedule()),
    // never on every resize or mutation event as they arrive.
    for (const state of STATES) {
      sideEl.dataset.companions = state;
      if (state === STATES[STATES.length - 1] || sideEl.scrollHeight <= sideEl.clientHeight) break;
    }
  }

  // Coalesces into one measurement per frame regardless of how many resize
  // or mutation events fire in between — both can fire in bursts (a dragged
  // window edge; a full re-render replacing many nodes at once).
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(recheck);
  }

  // Fires when the column's own available height changes — i.e. the window
  // being resized, since .pip-side's height is stretched to match .pip-console
  // by the parent flex row rather than driven by its own children.
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(sideEl);

  // Clu3's message and the forecast both refresh on their own timers
  // (clu3Panel.js, weatherPanel.js) and re-render their subtree without
  // resizing .pip-side itself while compact — it's pinned to a fixed height
  // then (see device.css), so the ResizeObserver above can't see a content
  // change that might now fit, or might no longer. Watching the DOM directly
  // catches that without either module needing to know this exists.
  const mutationObserver = new MutationObserver(schedule);
  mutationObserver.observe(sideEl, { childList: true, subtree: true, characterData: true });

  schedule();

  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
  };
}
