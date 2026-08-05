// Clu3 — the panel at the top of the right column.
//
// Not a chatbot and not a dashboard tile: it's ambient chrome that reflects
// the workspace back at you with a face, a line, and (when useful) a link
// into the app. All of the thinking happens server-side in server/clu3/; this
// file is presentation plus the update loop.
//
// Two update triggers:
//   - the shared SSE connection, so it reacts the moment data changes
//   - a slow tick, for time-based moods (staleness crossing a threshold,
//     the evening wind-down) and to rotate the current line's phrasing
// Blinking runs on its own timer and repaints only the face.

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderClu3Visual } from '../lib/clu3Scenes.js';
import { onChange } from '../api/client.js';
import { clu3State, dismissMessage } from '../api/clu3Repo.js';
import { navigateTo } from './router.js';

const TICK_MS = 20000;
const BLINK_MIN_MS = 3200;
const BLINK_MAX_MS = 7000;
const BLINK_HOLD_MS = 140;
const ENERGY_PIPS = 5;
const MODE_KEY = 'pip-clu3-mode';

function savedMode() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'face' || v === 'scene') return v;
  } catch (_) {
    /* ignore — defaults below */
  }
  return 'scene';
}

export function mountClu3Panel(container) {
  const faceHost = h('div', { class: 'pip-clu3-face' });
  const lineEl = h('div', { class: 'pip-clu3-line' }, '…');
  const actionHost = h('div', { class: 'pip-clu3-action' });
  const pipsHost = h('div', { class: 'pip-clu3-pips', title: 'energy' });

  let mode = savedMode();

  // Lets you drop to the close-up when you'd rather just read the expression.
  const modeBtn = h('button', {
    class: 'pip-clu3-mode',
    title: 'Toggle scene / face',
    onClick: () => {
      mode = mode === 'scene' ? 'face' : 'scene';
      try {
        localStorage.setItem(MODE_KEY, mode);
      } catch (_) {
        /* ignore — just won't persist */
      }
      faceHost.dataset.mode = mode;
      paintFace();
    }
  });
  modeBtn.appendChild(icon('select', { size: 9 }));

  const header = h('div', { class: 'pip-clu3-header' }, [
    h('span', { class: 'pip-clu3-name' }, 'CLU3'),
    h('div', { class: 'pip-clu3-header-right' }, [pipsHost, modeBtn])
  ]);

  const widget = h('div', { class: 'pip-clu3-widget' }, [
    header,
    faceHost,
    h('div', { class: 'pip-clu3-speech' }, [lineEl, actionHost])
  ]);
  container.appendChild(widget);

  // Last known state, so blink repaints don't need a fetch.
  let state = { mood: 'content', line: '', action: null, energy: 100, source: 'rule', messageId: null };
  let blinking = false;
  let destroyed = false;
  let blinkTimer = null;

  function paintFace() {
    faceHost.innerHTML = '';
    faceHost.appendChild(renderClu3Visual(state.mood, { blinking, energy: state.energy, mode }));
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
      paintFace();
      paintPips();
      paintSpeech();
    } catch (err) {
      // Clu3 going quiet is never worth breaking the app over — leave the
      // last expression on screen and try again on the next tick.
      console.warn('[clu3] refresh failed:', err.message);
    }
  }

  function scheduleBlink() {
    if (destroyed) return;
    // Low energy = slower, heavier blinking.
    const slow = state.energy <= 25 ? 1.6 : 1;
    const delay = (BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS)) * slow;
    blinkTimer = setTimeout(() => {
      if (destroyed) return;
      blinking = true;
      paintFace();
      setTimeout(() => {
        if (destroyed) return;
        blinking = false;
        paintFace();
        scheduleBlink();
      }, BLINK_HOLD_MS);
    }, delay);
  }

  faceHost.dataset.mode = mode;
  paintFace();
  paintPips();
  refresh();
  scheduleBlink();

  const tick = setInterval(refresh, TICK_MS);
  const unsubscribe = onChange(refresh);

  return {
    el: widget,
    destroy() {
      destroyed = true;
      clearInterval(tick);
      clearTimeout(blinkTimer);
      unsubscribe();
    }
  };
}
