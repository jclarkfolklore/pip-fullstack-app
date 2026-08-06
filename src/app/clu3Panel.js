// Clu3 — the panel at the top of the right column.
//
// Not a chatbot and not a dashboard tile: it's ambient chrome that reflects
// the workspace back at you with a face, a line, and (when useful) a link
// into the app. All of the thinking happens server-side in server/clu3/; this
// file is presentation plus the update loops.
//
// Two things run independently and compose on every paint:
//   - the PERFORMER — a story sequencer (clu3Sequencer.js) walking a
//     narrative arc (clu3Narrative.js), one pose per frame. Clu3 isn't
//     playing a mood loop; it's telling a short story with a beginning, a
//     turn, and somewhere it lands. A genuine mood change interrupts the
//     story rather than waiting out its ending, so a repoll visibly lands.
//   - the SSE `onChange` + hourly tick, which is what actually re-fetches
//     mood/energy/line from the server — see refresh() below.
//
// There is no separate blink timer any more: eye state is part of the pose
// art itself, so blinking is something the sequence does, not an overlay.

import { h, fmtTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderClu3Visual, knownScene } from '../lib/clu3Scenes.js';
import { createStorySequencer, contextForMood, FRAME_MS, COMBO_GAP_MS } from '../lib/clu3Sequencer.js';
import { chooseArc, buildArc } from '../lib/clu3Narrative.js';
import { onChange, isStatic } from '../api/client.js';
import { clu3State, dismissMessage } from '../api/clu3Repo.js';
import { navigateTo } from './router.js';
import { openClu3SheetModal } from './clu3SheetModal.js';

// Matches the weather panel's poll cadence (weatherPanel.js) — both update
// hourly. Real activity still reacts instantly via the SSE `onChange` below;
// this tick only covers time-based moods that need wall-clock time to pass
// (staleness thresholds, the evening wind-down), which don't need faster
// than hourly. A manual "get latest" button covers everything else.
const TICK_MS = 60 * 60 * 1000;
const ENERGY_PIPS = 5;

export function mountClu3Panel(container) {
  const faceHost = h('div', { class: 'pip-clu3-face' });
  const lineEl = h('div', { class: 'pip-clu3-line' }, '…');
  const actionHost = h('div', { class: 'pip-clu3-action' });
  const pipsHost = h('div', { class: 'pip-clu3-pips', title: 'energy' });

  const sheetBtn = h('button', { class: 'pip-clu3-sheet-btn', title: 'Preview sprite sheet' }, [icon('grid', { size: 15 })]);
  const refreshBtn = h('button', { class: 'pip-clu3-refresh', title: 'Get latest now' }, [icon('refresh', { size: 15 })]);
  // Nothing to re-read in a snapshot — Clu3's line was computed when the
  // snapshot was taken and can't change.
  if (isStatic()) refreshBtn.style.display = 'none';

  sheetBtn.addEventListener('click', () => openClu3SheetModal());

  const header = h('div', { class: 'pip-clu3-header' }, [
    h('span', { class: 'pip-clu3-name' }, 'CLU3'),
    h('div', { class: 'pip-clu3-header-right' }, [pipsHost, sheetBtn, refreshBtn])
  ]);
  const updatedEl = h('div', { class: 'pip-clu3-updated' }, '');

  const widget = h('div', { class: 'pip-clu3-widget' }, [
    header,
    faceHost,
    h('div', { class: 'pip-clu3-speech' }, [lineEl, actionHost]),
    updatedEl
  ]);
  container.appendChild(widget);

  // Last known state, so frame repaints don't need a fetch.
  let state = { mood: 'content', line: '', action: null, energy: 100, source: 'rule', messageId: null };
  let destroyed = false;
  let refreshing = false;

  // The performer. It owns which story is being told and which frame of it is
  // showing; this file only drives the clock and paints what it's handed.
  // Blinking used to be a separate overlay timer — it isn't any more, because
  // eye state is part of the pose art itself now.
  let playingMood = null;
  let frameTimer = null;
  const sequencer = createStorySequencer({
    getStory: () => ({ mood: knownScene(state.mood) }),
    buildStory: (story) => buildArc(chooseArc(story), contextForMood(story.mood))
  });

  function paintFace() {
    faceHost.innerHTML = '';
    faceHost.appendChild(renderClu3Visual(state.mood, { pose: sequencer.frame(), energy: state.energy }));
  }

  // Each frame schedules the next. A combo change gets an extra beat of
  // stillness so the seam between gestures is legible.
  function scheduleNextFrame(delay = FRAME_MS) {
    if (destroyed) return;
    frameTimer = setTimeout(() => {
      if (destroyed) return;
      const switched = sequencer.advance();
      paintFace();
      scheduleNextFrame(switched ? FRAME_MS + COMBO_GAP_MS : FRAME_MS);
    }, delay);
  }

  // Called whenever fresh state comes in. A genuine mood change abandons the
  // story in progress and starts a new one — that's what makes a repoll
  // visibly land, rather than the new mood waiting out the old one's ending.
  function syncAnimator() {
    const mood = knownScene(state.mood);
    if (mood === playingMood) return;
    playingMood = mood;
    sequencer.interrupt();
    paintFace();
  }

  function paintPips() {
    pipsHost.innerHTML = '';
    const filled = Math.round((Math.max(0, Math.min(100, state.energy)) / 100) * ENERGY_PIPS);
    for (let i = 0; i < ENERGY_PIPS; i += 1) {
      pipsHost.appendChild(h('span', { class: `pip-clu3-pip ${i < filled ? 'is-on' : ''}`.trim() }));
    }
  }

  function paintSpeech() {
    lineEl.textContent = state.line || '';
    actionHost.innerHTML = '';

    if (state.action && state.action.kind) {
      actionHost.appendChild(
        h(
          'button',
          {
            class: 'pip-clu3-chip',
            onClick: () => navigateTo(state.action.kind)
          },
          [state.action.label || 'OPEN', icon('forward', { size: 8 })]
        )
      );
    }

    // Authored messages are dismissible — rule-generated lines aren't, since
    // they'd just be recomputed on the next tick anyway.
    if (state.source === 'message' && state.messageId) {
      actionHost.appendChild(
        h(
          'button',
          {
            class: 'pip-clu3-dismiss',
            title: 'Dismiss',
            onClick: async () => {
              await dismissMessage(state.messageId);
              refresh();
            }
          },
          [icon('close', { size: 8 })]
        )
      );
    }
  }

  async function refresh() {
    if (destroyed) return;
    try {
      const next = await clu3State();
      if (destroyed) return;
      state = next;
      syncAnimator();
      paintFace();
      paintPips();
      paintSpeech();
      updatedEl.textContent = state.computedAt ? `updated ${fmtTime(state.computedAt)}` : '';
    } catch (err) {
      // Clu3 going quiet is never worth breaking the app over — leave the
      // last expression on screen and try again on the next tick.
      console.warn('[clu3] refresh failed:', err.message);
    }
  }

  refreshBtn.addEventListener('click', async () => {
    if (destroyed || refreshing) return;
    refreshing = true;
    refreshBtn.classList.add('is-spinning');
    await refresh();
    refreshing = false;
    refreshBtn.classList.remove('is-spinning');
  });

  syncAnimator();
  paintFace();
  paintPips();
  refresh();
  scheduleNextFrame();

  const tick = isStatic() ? null : setInterval(refresh, TICK_MS);
  const unsubscribe = onChange(refresh);

  return {
    el: widget,
    destroy() {
      destroyed = true;
      if (tick) clearInterval(tick);
      clearTimeout(frameTimer);
      unsubscribe();
    }
  };
}
