// Sprite-sheet preview — three views, all independent of Clu3's live state.
//
//   POSES  every extracted pose with its stable reference number, run through
//          the style filter. Doubles as the tuning surface for
//          clu3Quantize.js: controls re-run the filter over the raw
//          extraction live, so chunkiness and denoising can be judged without
//          an edit/rebuild cycle. Raw data is never modified.
//
//   COMBOS every combo from clu3Combos.js, looping, labelled with its pose
//          range and strongest associations — for checking that a run reads
//          the way its field claims it does.
//
//   FOCUS  click any pose to see it large plus every combo that uses it,
//          animating. Poses are deliberately shared between combos, so this
//          answers "what does this frame actually end up doing?" — which is
//          hard to hold in your head across 35 overlapping runs.

import { h } from '../lib/dom.js';
import { renderStage } from '../lib/sprites.js';
import {
  quantizeSprite,
  allSprites,
  clearQuantizeCache,
  spriteIdByNumber,
  SPRITE_SIZE
} from '../lib/clu3Quantize.js';
import { COMBOS } from '../lib/clu3Combos.js';
import { createSequencer, contextForMood, MOOD_CONTEXT, FRAME_MS, COMBO_GAP_MS } from '../lib/clu3Sequencer.js';
import { openModal } from './modal.js';

const VIEWS = ['poses', 'combos', 'sequence'];

// 32 is native. Below ~20 the eyes merge into the hair and moods stop being
// distinguishable, so the ladder stops there.
const SIZES = [32, 30, 28, 26, 24, 22, 20];

function stageFor(n, options) {
  const id = spriteIdByNumber(n);
  const { w, h: sh, layers } = quantizeSprite(id, options);
  return renderStage({ width: w || SPRITE_SIZE, height: sh || SPRITE_SIZE, layers });
}

function combosUsing(n) {
  return COMBOS.filter((c) => c.poses.includes(n));
}

function topField(combo, count = 3) {
  return Object.entries(combo.field)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([k]) => k)
    .join(' · ');
}

function poseTile({ n, id }, options, onPick) {
  const stage = stageFor(n, options);
  const cell = h('button', { class: 'pip-clu3-sheet-cell is-pickable', title: `pose ${n} — cell ${id}` }, [
    h('div', { class: 'pip-clu3-sheet-stage' }, [stage, h('span', { class: 'pip-clu3-sheet-num' }, String(n))]),
    h('div', { class: 'pip-clu3-sheet-caption' }, id)
  ]);
  cell.addEventListener('click', () => onPick(n));
  return cell;
}

// Every frame is rendered once up front and then shown/hidden — cheaper than
// re-rendering SVG on each tick with ~35 tiles animating at the same time.
// `mark` highlights the frames matching a focused pose.
function comboTile(combo, options, timers, mark = null) {
  const frames = combo.poses.map((n, i) => {
    const el = h('div', { class: 'pip-clu3-frame' }, [stageFor(n, options)]);
    if (i !== 0) el.style.display = 'none';
    return el;
  });

  let i = 0;
  timers.push(
    setInterval(() => {
      frames[i].style.display = 'none';
      i = (i + 1) % frames.length;
      frames[i].style.display = '';
    }, FRAME_MS)
  );

  const first = combo.poses[0];
  const last = combo.poses[combo.poses.length - 1];
  const at = mark === null ? null : combo.poses.indexOf(mark) + 1;

  return h('div', { class: 'pip-clu3-combo-cell' }, [
    h('div', { class: 'pip-clu3-sheet-stage' }, frames),
    h('div', { class: 'pip-clu3-combo-id' }, combo.id),
    h(
      'div',
      { class: 'pip-clu3-sheet-caption' },
      at ? `${first}–${last} · frame ${at}/${combo.poses.length}` : `${first}–${last}`
    ),
    h('div', { class: 'pip-clu3-combo-field' }, topField(combo))
  ]);
}

// One live sequencer per mood, so you can watch what each context actually
// performs — including how much it varies between phrases.
function sequenceTile(mood, options, timers) {
  const stageHost = h('div', { class: 'pip-clu3-sheet-stage' });
  const comboEl = h('div', { class: 'pip-clu3-combo-id' }, '');
  const phraseEl = h('div', { class: 'pip-clu3-combo-field' }, '');

  const seq = createSequencer({ getContext: () => contextForMood(mood) });

  function paint() {
    stageHost.innerHTML = '';
    stageHost.appendChild(stageFor(seq.frame(), options));
    const s = seq.state();
    comboEl.textContent = s.combo;
    phraseEl.textContent = s.phrase.map((id) => (id === s.combo ? `[${id}]` : id)).join(' → ');
  }

  // setTimeout rather than setInterval so a combo change can hold longer —
  // same pacing as the live panel.
  paint();
  const step = (delay) => {
    const t = setTimeout(() => {
      const switched = seq.advance();
      paint();
      step(switched ? FRAME_MS + COMBO_GAP_MS : FRAME_MS);
    }, delay);
    timers.push(t);
  };
  step(FRAME_MS);

  return h('div', { class: 'pip-clu3-seq-cell' }, [
    h('div', { class: 'pip-clu3-focus-title' }, mood.toUpperCase()),
    stageHost,
    comboEl,
    phraseEl
  ]);
}

export function openClu3SheetModal() {
  const state = { size: 32, denoise: false, view: 'poses', focus: null };
  const banner = h('div', { class: 'pip-clu3-focus-banner' });
  const grid = h('div', { class: 'pip-clu3-sheet-grid' });
  const timers = [];

  // Timeouts and intervals share an id space in browsers, but the mix here is
  // deliberate: looping tiles use setInterval, the sequencer tiles chain
  // setTimeout so a combo change can hold longer. clearTimeout cancels both.
  function stopTimers() {
    while (timers.length) clearTimeout(timers.pop());
  }

  function pickPose(n) {
    state.focus = n;
    draw();
  }

  function drawFocus() {
    const n = state.focus;
    const used = combosUsing(n);

    const back = h('button', { class: 'pip-chip-toggle' }, '← ALL POSES');
    back.addEventListener('click', () => {
      state.focus = null;
      draw();
    });

    banner.append(
      h('div', { class: 'pip-clu3-focus-hero' }, [stageFor(n, state)]),
      h('div', { class: 'pip-clu3-focus-meta' }, [
        h('div', { class: 'pip-clu3-focus-title' }, `POSE ${n}`),
        h(
          'div',
          { class: 'pip-clu3-focus-sub' },
          used.length ? `used in ${used.length} combo${used.length === 1 ? '' : 's'}` : 'not used in any combo yet'
        ),
        back
      ])
    );

    grid.dataset.view = 'combos';
    for (const combo of used) grid.appendChild(comboTile(combo, state, timers, n));
    if (!used.length) {
      grid.appendChild(h('div', { class: 'pip-ticket-empty' }, 'No combo covers this pose — it is currently unused.'));
    }
  }

  function draw() {
    stopTimers();
    clearQuantizeCache();
    grid.innerHTML = '';
    banner.innerHTML = '';

    if (state.focus !== null) return drawFocus();

    if (state.view === 'poses') {
      grid.dataset.view = 'poses';
      for (const sprite of allSprites()) grid.appendChild(poseTile(sprite, state, pickPose));
    } else if (state.view === 'combos') {
      grid.dataset.view = 'combos';
      for (const combo of COMBOS) grid.appendChild(comboTile(combo, state, timers));
    } else {
      grid.dataset.view = 'sequence';
      for (const mood of Object.keys(MOOD_CONTEXT)) grid.appendChild(sequenceTile(mood, state, timers));
    }
  }

  function toggle(label, get, onClick) {
    const btn = h('button', { class: 'pip-chip-toggle' }, label());
    btn.dataset.on = get() ? 'true' : 'false';
    btn.addEventListener('click', () => {
      onClick();
      btn.textContent = label();
      btn.dataset.on = get() ? 'true' : 'false';
      draw();
    });
    return btn;
  }

  const controls = h('div', { class: 'pip-clu3-sheet-controls' }, [
    toggle(
      () =>
        state.view === 'poses'
          ? 'POSES (121)'
          : state.view === 'combos'
            ? `COMBOS (${COMBOS.length})`
            : 'SEQUENCER',
      () => state.view !== 'poses',
      () => {
        state.view = VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length];
        state.focus = null;
      }
    ),
    toggle(
      () => `PIXELS: ${state.size}`,
      () => state.size !== 32,
      () => {
        const i = SIZES.indexOf(state.size);
        state.size = SIZES[(i + 1) % SIZES.length];
      }
    ),
    toggle(
      () => `DENOISE: ${state.denoise ? 'ON' : 'OFF'}`,
      () => state.denoise,
      () => {
        state.denoise = !state.denoise;
      }
    )
  ]);

  draw();

  openModal({
    title: 'CLU3 — SPRITE SHEET',
    body: [controls, banner, grid],
    onClose: stopTimers,
    footer: h(
      'div',
      { class: 'pip-modal-note' },
      'Click any pose to see every combo it appears in. Numbers (0–120) are stable references; the words under a combo are its strongest associations, not a fixed meaning.'
    )
  });
}
