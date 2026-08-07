import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { tile } from '../../app/tile.js';
import { onChange } from '../../api/client.js';
import { getMetrics } from '../../api/metricsRepo.js';
import { staggerIn, badgePop, pulse, confettiBurst } from '../../lib/animations.js';
import {
  columnChart,
  sparkline,
  divergingColumns,
  calendarHeat,
  pieChart,
  tagGraph
} from '../../lib/charts.js';

export const kind = 'metrics';

// throughput is the single source of truth for "how much closed" — task and
// inbox closures together. The old tile/chart charted `resolved` alone
// (inbox_resolved only, ~4 events total on a live workspace vs. 38
// task_completed), which is why a busy day used to read as "no activity."
function closedCount(day) {
  return (day.completed || 0) + (day.resolved || 0);
}

export async function renderTile(ctx) {
  const m = await getMetrics();
  const total = m.throughput.slice(-7).reduce((a, d) => a + closedCount(d), 0);
  return tile({
    kind: 'metrics',
    glyph: 'metricsLg',
    label: 'METRICS',
    sub: total ? `${total} closed / 7d` : 'no activity yet',
    ctx
  });
}

const STAGE_TONE = { new: 'accent-3', active: 'accent', resolved: 'green' };
const TASK_TONE = { open: 'accent-3', doing: 'accent', done: 'green' };
const SOURCE_TONES = ['accent-2', 'accent-3', 'accent', 'green'];
const CATEGORY_META = {
  task: { label: 'Tasks', tone: 'accent-2' },
  inbox_item: { label: 'Inbox', tone: 'accent-3' },
  note: { label: 'Notes', tone: 'accent' },
  project: { label: 'Projects', tone: 'green' },
  journal_entry: { label: 'Journal', tone: 'accent-2' }
};
const ENTITY_LABEL = {
  task: 'TASK',
  inbox_item: 'INBOX',
  note: 'NOTE',
  project: 'PROJECT',
  journal_entry: 'JOURNAL'
};
const BEST_DAY_KEY = 'pip:metrics:bestDay';

// Every chart lives inside one of these: a title row, an info affordance
// that says in plain language what you're looking at, and a bordered box.
// A floating SVG with a tiny label above it reads as a disconnected
// fragment; the card is the boundary that says "this is one thing", and the
// info line is what stops a clever chart from being a puzzle.
// One document-level dismisser for every info popover, installed lazily.
// Per-card listeners would need per-card teardown; a single delegated
// handler that just closes whatever is open cannot leak as cards come and go.
let infoDismisserInstalled = false;

function closeAllInfo(except = null) {
  for (const open of document.querySelectorAll('.pip-ch-card-info.is-open')) {
    if (open === except) continue;
    open.classList.remove('is-open');
    open.previousElementSibling?.querySelector('.pip-ch-card-info-btn')?.classList.remove('is-active');
  }
}

function ensureInfoDismisser() {
  if (infoDismisserInstalled) return;
  infoDismisserInstalled = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest('.pip-ch-card-info') || e.target.closest('.pip-ch-card-info-btn')) return;
    closeAllInfo();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllInfo();
  });
}

// Every chart lives inside one of these: a title row, an info affordance
// that says in plain language what you're looking at, and a bordered box.
// A floating SVG with a tiny label above it reads as a disconnected
// fragment; the card is the boundary that says "this is one thing", and the
// info line is what stops a clever chart from being a puzzle.
//
// The info panel is a popover — absolutely positioned so opening it overlays
// the chart instead of pushing every card below it down the page.
function card({ title, info = null, subtitle = null }, ...children) {
  const titleEl = h('div', { class: 'pip-ch-card-title' }, title);
  const head = [titleEl];
  let infoEl = null;

  if (info) {
    ensureInfoDismisser();
    const closeBtn = h('button', { class: 'pip-ch-card-info-close', title: 'Close', 'aria-label': 'Close' }, [
      icon('close', { size: 9 })
    ]);
    infoEl = h('div', { class: 'pip-ch-card-info', role: 'note' }, [
      closeBtn,
      h('div', { class: 'pip-ch-card-info-text' }, info)
    ]);

    const btn = h(
      'button',
      { class: 'pip-ch-card-info-btn', title: 'What is this?', 'aria-label': 'What is this?' },
      [icon('info', { size: 11 })]
    );
    btn.addEventListener('click', () => {
      const willOpen = !infoEl.classList.contains('is-open');
      closeAllInfo(infoEl);
      infoEl.classList.toggle('is-open', willOpen);
      btn.classList.toggle('is-active', willOpen);
    });
    closeBtn.addEventListener('click', () => {
      infoEl.classList.remove('is-open');
      btn.classList.remove('is-active');
    });
    head.push(btn);
  }

  // `null` means this card never has a subtitle; an empty string means it
  // has one that gets filled in by the update pass — so the element must
  // exist for setSubtitle() to find later.
  const subtitleEl = subtitle === null ? null : h('div', { class: 'pip-ch-card-subtitle' }, subtitle);

  return h(
    'div',
    { class: 'pip-ch-card' },
    [h('div', { class: 'pip-ch-card-head' }, head), infoEl, subtitleEl, ...children.flat()].filter(Boolean)
  );
}

function setSubtitle(cardEl, text) {
  const el = cardEl.querySelector('.pip-ch-card-subtitle');
  if (el) el.textContent = text;
}

// A pie plus a real legend. The pie answers "what's the split"; the legend
// answers "of what, exactly" — a proportion graphic with no numbers next to
// it is decoration.
function pieWithLegend(entries, { donutLabel = null } = {}) {
  const chart = pieChart(entries, { cells: 21, cell: 5, gap: 1 });
  const total = entries.reduce((a, e) => a + e.value, 0);
  const centre = h('div', { class: 'pip-ch-pie-centre' }, [
    h('div', { class: 'pip-ch-pie-total' }, String(total)),
    h('div', { class: 'pip-ch-pie-total-label' }, donutLabel || 'total')
  ]);
  const legend = h(
    'div',
    { class: 'pip-ch-legend pip-ch-legend--stack' },
    entries.map((e) =>
      h('span', { class: 'pip-ch-legend-item' }, [
        h('span', { class: `pip-ch-legend-dot pip-ch-tone-${e.tone}` }),
        h('span', { class: 'pip-ch-legend-label' }, e.label),
        h('strong', {}, String(e.value)),
        h('span', { class: 'pip-ch-legend-pct' }, total ? `${Math.round((e.value / total) * 100)}%` : '0%')
      ])
    )
  );
  const wrap = h('div', { class: 'pip-ch-pie-row' }, [
    h('div', { class: 'pip-ch-pie-wrap' }, [chart.el, centre]),
    legend
  ]);
  return { wrap, chart, legend, centre, entries };
}

function updatePieWithLegend(pieObj, entries) {
  pieObj.chart.update(entries);
  pieObj.entries = entries;
  const total = entries.reduce((a, e) => a + e.value, 0);
  const totalEl = pieObj.centre.querySelector('.pip-ch-pie-total');
  if (Number(totalEl.textContent) !== total) {
    totalEl.textContent = String(total);
    badgePop(totalEl);
  }
  entries.forEach((e, i) => {
    const item = pieObj.legend.children[i];
    if (!item) return;
    const strong = item.querySelector('strong');
    const pct = item.querySelector('.pip-ch-legend-pct');
    if (Number(strong.textContent) !== e.value) {
      strong.textContent = String(e.value);
      pulse(strong);
    }
    pct.textContent = total ? `${Math.round((e.value / total) * 100)}%` : '0%';
  });
}

// A labelled horizontal bar — used wherever the answer is a ranked list of
// counts (project load, activity mix). Deliberately not a chart primitive:
// it's one ratio per row, and plain DOM says that more clearly than SVG.
function barRow(label, value, max, total, tone = 'accent-2') {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 3;
  const share = total ? `${Math.round((value / total) * 100)}%` : '';
  return h('div', { class: 'pip-ch-load-row' }, [
    h('div', { class: 'pip-ch-load-label', title: label }, label),
    h('div', { class: 'pip-ch-load-track' }, [
      h('div', { class: `pip-ch-load-fill pip-ch-fill-${tone}`, style: `width:${pct}%` })
    ]),
    h('div', { class: 'pip-ch-load-value' }, String(value)),
    h('div', { class: 'pip-ch-load-pct' }, share)
  ]);
}

// Expand the sparse {day: count} map the API returns into one entry per
// calendar day across the whole window — a heatmap needs the empty days to
// exist as cells, and days before the log started are flagged so they can be
// drawn as "no data" rather than as a real zero.
function calendarDays(dailyActivity, firstEventAt, days = 182) {
  const firstDay = firstEventAt ? firstEventAt.slice(0, 10) : null;
  const out = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    out.push({ key, n: dailyActivity[key] || 0, ghost: firstDay ? key < firstDay : true });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// Names both axes in words. A chart whose vertical scale is unlabelled is a
// shape, not a measurement — and "what is the y axis" was the first thing
// anyone asked of these two.
function axisCaption(yText, xText) {
  return h('div', { class: 'pip-ch-axis-caption' }, [
    h('span', {}, `↕ ${yText}`),
    h('span', {}, `↔ ${xText}`)
  ]);
}

function weekdayLabel(dateKey) {
  // Parsed as local, not UTC — `new Date('YYYY-MM-DD')` is UTC-midnight and
  // was the source of the old off-by-one weekday label.
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'narrow' });
}

function dayTitle(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function hoursLabel(hrs) {
  if (hrs == null) return '—';
  return hrs < 24 ? `${hrs.toFixed(1)}h` : `${(hrs / 24).toFixed(1)}d`;
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dayStamp(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const TABS = [
  { key: 'now', label: 'NOW' },
  { key: 'throughput', label: 'FLOW' },
  { key: 'breakdown', label: 'BREAKDOWN' },
  { key: 'tags', label: 'TAGS' },
  { key: 'recent', label: 'RECENT' }
];

// A sticky tab bar over the panels, all built up front and kept alive (not
// torn down when hidden) — the widget still gets live SSE updates for every
// panel regardless of which is on screen, so switching back never shows
// stale numbers.
function buildTabs(panelsByKey) {
  const buttons = new Map();
  const bar = h(
    'div',
    { class: 'pip-metrics-tabs' },
    TABS.map((t) => {
      const btn = h('button', { class: 'pip-metrics-tab', onClick: () => activate(t.key) }, t.label);
      buttons.set(t.key, btn);
      return btn;
    })
  );

  function activate(key) {
    for (const [k, panel] of panelsByKey) panel.style.display = k === key ? '' : 'none';
    for (const [k, btn] of buttons) btn.classList.toggle('is-active', k === key);
    const panel = panelsByKey.get(key);
    if (panel) staggerIn(panel.children);
  }
  activate(TABS[0].key);
  return bar;
}

export function renderFull(ctx) {
  const el = h('div', { class: 'pip-view' });
  const header = h('div', { class: 'pip-view-header' }, [
    h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
    h('div', { class: 'pip-view-title' }, 'METRICS')
  ]);
  const body = h('div', { class: 'pip-view-body' });
  el.append(header, body);

  let charts = null;
  let debounceTimer = null;

  function ghostBoundary(firstEventAt) {
    if (!firstEventAt) return () => false;
    const firstDay = firstEventAt.slice(0, 10);
    return (dayKey) => dayKey < firstDay;
  }

  function stageEntries(m) {
    return [
      { key: 'new', label: 'New', tone: STAGE_TONE.new, value: m.inbox.new },
      { key: 'active', label: 'Active', tone: STAGE_TONE.active, value: m.inbox.active },
      { key: 'resolved', label: 'Resolved', tone: STAGE_TONE.resolved, value: m.inbox.resolved }
    ];
  }

  function taskEntries(m) {
    return [
      { key: 'open', label: 'Open', tone: TASK_TONE.open, value: m.tasks.open },
      { key: 'doing', label: 'Doing', tone: TASK_TONE.doing, value: m.tasks.doing },
      { key: 'done', label: 'Done', tone: TASK_TONE.done, value: m.tasks.done }
    ];
  }

  function counterTile(iconName, label, value) {
    const valueEl = h('div', { class: 'pip-ch-counter-value' }, String(value));
    return {
      el: h('div', { class: 'pip-ch-counter' }, [
        icon(iconName, { size: 20, className: 'pip-ch-counter-icon' }),
        valueEl,
        h('div', { class: 'pip-ch-counter-label' }, label)
      ]),
      valueEl
    };
  }

  function buildNowPanel(m) {
    const inboxPie = pieWithLegend(stageEntries(m), { donutLabel: 'items' });
    const taskPie = pieWithLegend(taskEntries(m), { donutLabel: 'tasks' });

    const notesTile = counterTile('note', 'Notes', m.notes.total);
    const journalTile = counterTile('book', 'Journal', m.journalCount);
    const projectsTile = counterTile('folder', 'Projects', m.projectCount);
    const filesTile = counterTile('download', 'Files', m.attachmentCount);
    const counterStrip = h('div', { class: 'pip-ch-counter-strip' }, [
      notesTile.el,
      journalTile.el,
      projectsTile.el,
      filesTile.el
    ]);

    const loadHost = h('div', { class: 'pip-ch-load-list' });
    const loadCard = card(
      {
        title: 'PROJECT LOAD',
        info: 'Open work per project — unresolved inbox items, unfinished tasks, and notes. This is what is on your plate right now, not what you have finished.'
      },
      loadHost
    );

    // Totals first — the cheapest thing to read — then the two lifecycle
    // pies paired across the width, then what's actually on the plate.
    const panel = h('div', { class: 'pip-metrics-panel' }, [
      card(
        {
          title: 'AT A GLANCE',
          info: 'Totals for everything PIP is holding: notes, journal entries, projects, and stored attachments.'
        },
        counterStrip
      ),
      h('div', { class: 'pip-metrics-row' }, [
        card(
          {
            title: 'INBOX',
            info: 'Every inbox item by lifecycle stage. Slice size is that stage’s share of all items — the numbers beside it are the real counts.'
          },
          inboxPie.wrap
        ),
        card(
          {
            title: 'TASKS',
            info: 'Every task by status. Slice size is that status’s share of all tasks — the numbers beside it are the real counts.'
          },
          taskPie.wrap
        )
      ]),
      loadCard
    ]);

    const state = { inboxPie, taskPie, notesTile, journalTile, projectsTile, filesTile, loadHost, loadCard };
    updateNowPanel(state, m);
    return { panel, state };
  }

  function updateNowPanel(state, m) {
    updatePieWithLegend(state.inboxPie, stageEntries(m));
    updatePieWithLegend(state.taskPie, taskEntries(m));
    updateCounter(state.notesTile, m.notes.total);
    updateCounter(state.journalTile, m.journalCount);
    updateCounter(state.projectsTile, m.projectCount);
    updateCounter(state.filesTile, m.attachmentCount);

    const maxLoad = Math.max(1, ...m.byProject.map((p) => p.n));
    const totalLoad = m.byProject.reduce((a, p) => a + p.n, 0);
    state.loadHost.replaceChildren(
      ...(m.byProject.length
        ? m.byProject.map((p) => barRow(p.name, p.n, maxLoad, totalLoad))
        : [h('div', { class: 'pip-ch-empty' }, 'Nothing assigned to a project yet.')])
    );
    setSubtitle(
      state.loadCard,
      totalLoad ? `${totalLoad} open items across ${m.byProject.length} projects` : ''
    );
  }

  function buildThroughputPanel(m) {
    const isGhost = ghostBoundary(m.firstEventAt);
    const series = m.throughput.map((d) => ({
      key: d.day,
      label: dayTitle(d.day),
      value: closedCount(d),
      ghost: isGhost(d.day)
    }));

    const throughputChart = columnChart(series, {
      width: 300,
      height: 80,
      tone: 'accent-2',
      unit: 'closed',
      gutterLeft: 20
    });
    const dayLabels = h(
      'div',
      { class: 'pip-ch-day-labels' },
      // Every 4th day only — labelling all 28 would collide at this width,
      // and this is the exact spot the old chart's weekday-label bug lived
      // (a UTC-parsed date rendered in local time, off by one).
      m.throughput.map((d, i) => h('span', {}, i % 4 === 0 ? weekdayLabel(d.day) : ''))
    );
    const throughputCard = card(
      {
        title: `THROUGHPUT — LAST ${m.throughput.length} DAYS`,
        info: 'Tasks completed plus inbox items resolved, per day. Dashed lines mark half and full scale; hover any bar for its exact count. Faint ticks are days before PIP started recording — not days with zero work.',
        subtitle: ''
      },
      h('div', { class: 'pip-ch-chart-wrap' }, [throughputChart.el]),
      dayLabels,
      axisCaption('items closed that day', 'one bar per day, oldest left → today right')
    );

    const netSeries = m.throughput.map((d) => ({
      key: d.day,
      label: dayTitle(d.day),
      value: closedCount(d) - (d.created || 0),
      ghost: isGhost(d.day)
    }));
    const netFlowChart = divergingColumns(netSeries, { width: 300, height: 72, gutterLeft: 20 });
    const netFlowCard = card(
      {
        title: 'NET FLOW',
        info: 'Closed minus created, per day. Above the line you cleared more than arrived; below it, the backlog grew. The line itself is zero.'
      },
      h('div', { class: 'pip-ch-chart-wrap' }, [netFlowChart.el]),
      axisCaption('closed minus created that day', 'one bar per day, oldest left → today right'),
      h('div', { class: 'pip-ch-legend' }, [
        h('span', { class: 'pip-ch-legend-item' }, [
          h('span', { class: 'pip-ch-legend-dot pip-ch-tone-green' }),
          h('span', { class: 'pip-ch-legend-label' }, 'cleared more than arrived')
        ]),
        h('span', { class: 'pip-ch-legend-item' }, [
          h('span', { class: 'pip-ch-legend-dot pip-ch-tone-accent' }),
          h('span', { class: 'pip-ch-legend-label' }, 'backlog grew')
        ])
      ])
    );

    const calSeries = calendarDays(m.dailyActivity, m.firstEventAt);
    const calChart = calendarHeat(calSeries, {
      monthLabel: (key) => {
        const [y, mo, d] = key.split('-').map(Number);
        return new Date(y, mo - 1, d).toLocaleDateString(undefined, { month: 'short' });
      },
      dayTitle: (key) => {
        const [y, mo, d] = key.split('-').map(Number);
        return new Date(y, mo - 1, d).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        });
      }
    });
    // The shades are relative, so the ends of the scale have to say what
    // they currently mean — otherwise "less" and "more" imply a fixed range
    // that does not exist. Both numbers are rewritten on every update.
    const scaleMinEl = h('span', {}, '1');
    const scaleMaxEl = h('span', { class: 'pip-ch-scale-max' }, '');
    const heatScale = h('div', { class: 'pip-ch-scale' }, [
      h('span', {}, 'less'),
      scaleMinEl,
      ...[1, 2, 3, 4, 5].map((lvl) => h('span', { class: `pip-ch-scale-swatch pip-ch-heat-${lvl}` })),
      scaleMaxEl,
      h('span', {}, 'more')
    ]);
    const heatCard = card(
      {
        title: 'WHEN YOU WORK',
        info: 'Every logged event, one square per day, weeks running left to right. Colour is relative to your own busiest day, so the scale re-fits itself as your workload grows or shrinks. Hollow squares are days before PIP started recording — not quiet days.',
        subtitle: ''
      },
      h('div', { class: 'pip-ch-cal-wrap' }, [calChart.el]),
      heatScale
    );

    // Calendar first: it is the widest view of the same story the two
    // charts below tell in detail.
    const panel = h('div', { class: 'pip-metrics-panel' }, [heatCard, throughputCard, netFlowCard]);
    const state = { throughputChart, throughputCard, netFlowChart, calChart, heatCard, scaleMaxEl, isGhost };
    updateThroughputPanel(state, m);
    return { panel, state };
  }

  function updateThroughputPanel(state, m) {
    const isGhost = ghostBoundary(m.firstEventAt);
    const series = m.throughput.map((d) => ({
      key: d.day,
      label: dayTitle(d.day),
      value: closedCount(d),
      ghost: isGhost(d.day)
    }));
    state.throughputChart.update(series);
    const peak = state.throughputChart.maxValue();
    const total = series.reduce((a, d) => a + d.value, 0);
    setSubtitle(
      state.throughputCard,
      `${total} closed · busiest day ${peak} · dashed lines at ${Math.round(peak / 2)} and ${peak}`
    );

    state.netFlowChart.update(
      m.throughput.map((d) => ({
        key: d.day,
        label: dayTitle(d.day),
        value: closedCount(d) - (d.created || 0),
        ghost: isGhost(d.day)
      }))
    );

    state.calChart.update(calendarDays(m.dailyActivity, m.firstEventAt));
    const busiest = state.calChart.maxValue();
    state.scaleMaxEl.textContent = String(busiest);
    setSubtitle(
      state.heatCard,
      `5 shades spread evenly between 1 and your busiest day — the scale re-fits itself as that number moves`
    );
  }

  function buildBreakdownPanel(m) {
    const histoChart = columnChart(
      m.closeTimeBuckets.map((b) => ({ key: b.label, label: b.label, value: b.n })),
      { width: 240, height: 78, horizontal: true, tone: 'accent-3', unit: 'closed' }
    );
    const histoLabels = h(
      'div',
      { class: 'pip-ch-histo-labels' },
      m.closeTimeBuckets.map((b) => h('div', { class: 'pip-ch-histo-label' }, b.label))
    );
    const histoCard = card(
      {
        title: 'TIME TO CLOSE',
        info: 'How long things took from created to closed, over the last 30 days, across both tasks and inbox items. An average alone hides whether everything closes quickly or half of it drags.',
        subtitle: ''
      },
      h('div', { class: 'pip-ch-histo' }, [
        histoLabels,
        h('div', { class: 'pip-ch-chart-wrap' }, [histoChart.el])
      ])
    );

    const sourcePie = pieWithLegend(
      m.bySourceType.map((s, i) => ({
        key: s.source_type,
        label: s.source_type,
        tone: SOURCE_TONES[i % SOURCE_TONES.length],
        value: s.n
      })),
      { donutLabel: 'records' }
    );
    const sourceCard = card(
      {
        title: 'WHERE WORK COMES FROM',
        info: 'Inbox items and notes by the system they arrived from. Slice size is that source’s share of everything captured.'
      },
      sourcePie.wrap
    );

    const projectHost = h('div', { class: 'pip-ch-project-grid' });
    const projectCard = card(
      {
        title: 'COMPLETIONS PER PROJECT — LAST 14 DAYS',
        info: 'One mini chart per project, each bar a day. All of them share a single scale, so a tall bar means the same amount of work in every card — you can compare them directly.',
        subtitle: ''
      },
      projectHost
    );

    // Source mix and per-project completions are both compact and both
    // answer "how is the work distributed", so they pair naturally — side by
    // side on a wide screen, stacked when there isn't room.
    const panel = h('div', { class: 'pip-metrics-panel' }, [
      histoCard,
      h('div', { class: 'pip-metrics-row' }, [sourceCard, projectCard])
    ]);
    const state = { histoChart, histoCard, sourcePie, projectHost, projectCard, projectSparks: new Map() };
    updateBreakdownPanel(state, m);
    return { panel, state };
  }

  function projectSeries(daysMap) {
    const out = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ key, label: dayTitle(key), value: daysMap.get(key) || 0 });
    }
    return out;
  }

  function updateBreakdownPanel(state, m) {
    state.histoChart.update(m.closeTimeBuckets.map((b) => ({ key: b.label, label: b.label, value: b.n })));
    const closedTotal = m.closeTimeBuckets.reduce((a, b) => a + b.n, 0);
    setSubtitle(state.histoCard, `${closedTotal} closed · average ${hoursLabel(m.avgResolutionHours)}`);

    updatePieWithLegend(
      state.sourcePie,
      m.bySourceType.map((s, i) => ({
        key: s.source_type,
        label: s.source_type,
        tone: SOURCE_TONES[i % SOURCE_TONES.length],
        value: s.n
      }))
    );

    const byProject = new Map();
    for (const row of m.completionsByProject) {
      if (!byProject.has(row.project_id))
        byProject.set(row.project_id, { name: row.project_name, days: new Map() });
      byProject.get(row.project_id).days.set(row.day, row.n);
    }

    // One scale across every mini chart. Independently-scaled small
    // multiples are the classic way a grid of sparklines lies: a project
    // with 2 completions renders identically to one with 20.
    const sharedMax = Math.max(1, ...m.completionsByProject.map((r) => r.n));

    const wanted = [...byProject.keys()].join(',');
    if (state.renderedProjects !== wanted) {
      state.renderedProjects = wanted;
      state.projectSparks = new Map();
      const cards = [];
      for (const [projectId, data] of byProject) {
        const series = projectSeries(data.days);
        const spark = sparkline(series, { tone: 'accent-2', max: sharedMax, unit: 'completed' });
        state.projectSparks.set(projectId, spark);
        const totalEl = h(
          'span',
          { class: 'pip-ch-project-total' },
          String(series.reduce((a, d) => a + d.value, 0))
        );
        cards.push(
          h('div', { class: 'pip-ch-project-spark' }, [
            h('div', { class: 'pip-ch-project-spark-head' }, [
              h('span', { class: 'pip-ch-project-spark-label', title: data.name }, data.name),
              totalEl
            ]),
            spark.el
          ])
        );
      }
      state.projectHost.replaceChildren(
        ...(cards.length
          ? cards
          : [h('div', { class: 'pip-ch-empty' }, 'No completions in the last 14 days.')])
      );
    } else {
      for (const [projectId, spark] of state.projectSparks) {
        spark.update(projectSeries(byProject.get(projectId)?.days || new Map()), { max: sharedMax });
      }
    }
    setSubtitle(state.projectCard, sharedMax > 1 ? `shared scale — tallest bar = ${sharedMax} in a day` : '');
  }

  function buildTagsPanel(m) {
    const graph = tagGraph(m.tagGraph, { width: 320, height: 260 });

    const linkSlider = h('input', {
      type: 'range',
      min: '1',
      max: '5',
      value: '1',
      class: 'pip-ch-graph-slider'
    });
    const linkValue = h('span', { class: 'pip-ch-graph-slider-value' }, '1+');
    linkSlider.addEventListener('input', () => {
      linkValue.textContent = `${linkSlider.value}+`;
      graph.setOptions({ minLink: Number(linkSlider.value) });
    });

    const labelToggle = h('button', { class: 'pip-chip-toggle', dataset: { on: 'true' } }, 'LABELS');
    labelToggle.addEventListener('click', () => {
      const on = labelToggle.dataset.on !== 'true';
      labelToggle.dataset.on = on ? 'true' : 'false';
      graph.setOptions({ showLabels: on });
    });

    const controls = h('div', { class: 'pip-ch-graph-controls' }, [
      h('label', { class: 'pip-ch-graph-control' }, [h('span', {}, 'min shared'), linkSlider, linkValue]),
      labelToggle
    ]);

    const graphCard = card(
      {
        title: 'TAG NETWORK',
        info: 'Every tag in PIP. Box size and colour are how often a tag is used; a line means two tags were applied to the same record, and thicker lines mean that happened more often. Drag the slider to hide weak connections and see only the strong clusters.',
        subtitle: ''
      },
      controls,
      h('div', { class: 'pip-ch-chart-wrap' }, [graph.el])
    );

    const panel = h('div', { class: 'pip-metrics-panel' }, [graphCard]);
    const state = { graph, graphCard };
    updateTagsPanel(state, m);
    return { panel, state };
  }

  function updateTagsPanel(state, m) {
    const nodes = m.tagGraph.nodes.length;
    const links = m.tagGraph.links.length;
    setSubtitle(state.graphCard, `${nodes} tags · ${links} connections`);
  }

  function categoryEntries(activityByCategory) {
    return activityByCategory
      .filter((c) => c.n > 0)
      .map((c) => {
        const meta = CATEGORY_META[c.entity_type] || { label: c.entity_type, tone: 'accent-2' };
        return { key: c.entity_type, label: meta.label, tone: meta.tone, value: c.n };
      });
  }

  function eventVerb(eventType) {
    return eventType
      .replace(/^(task|inbox|note|project|journal)_/, '')
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
  }

  function feedIcon(entityType) {
    if (entityType === 'task') return 'tasks';
    if (entityType === 'inbox_item') return 'inbox';
    if (entityType === 'note') return 'note';
    if (entityType === 'project') return 'folder';
    if (entityType === 'journal_entry') return 'book';
    return 'tag';
  }

  // Built for forensics: what changed, to which record, when, and in which
  // project — plus whatever the event itself recorded (a new status, the
  // fields that were edited). Everything here is read back out of
  // activity_log; nothing is inferred.
  function feedRow(r) {
    const detailBits = [];
    if (r.detail?.status) detailBits.push(`→ ${r.detail.status}`);
    if (Array.isArray(r.detail?.fields) && r.detail.fields.length)
      detailBits.push(r.detail.fields.join(', '));
    if (r.detail?.to) detailBits.push(`→ ${r.detail.to}`);
    if (r.detail?.toUser) detailBits.push(`→ ${r.detail.toUser}`);

    return h('div', { class: 'pip-ch-feed-row', dataset: { entity: r.entity_type } }, [
      h(
        'span',
        { class: 'pip-ch-feed-time', title: new Date(r.occurred_at).toLocaleString() },
        clockTime(r.occurred_at)
      ),
      h('span', { class: 'pip-ch-feed-icon' }, [icon(feedIcon(r.entity_type), { size: 11 })]),
      h(
        'div',
        { class: 'pip-ch-feed-main' },
        [
          h('div', { class: 'pip-ch-feed-title' }, r.entity_title || '(deleted)'),
          h(
            'div',
            { class: 'pip-ch-feed-meta' },
            [
              h('span', { class: 'pip-ch-feed-badge' }, ENTITY_LABEL[r.entity_type] || r.entity_type),
              h('span', {}, eventVerb(r.event_type)),
              detailBits.length ? h('span', { class: 'pip-ch-feed-detail' }, detailBits.join(' · ')) : null,
              r.project_name ? h('span', { class: 'pip-ch-feed-project' }, r.project_name) : null,
              h('span', { class: 'pip-ch-feed-day' }, dayStamp(r.occurred_at))
            ].filter(Boolean)
          )
        ].filter(Boolean)
      )
    ]);
  }

  function buildRecentPanel(m) {
    const mixHost = h('div', { class: 'pip-ch-load-list' });
    const mixCard = card(
      {
        title: 'ACTIVITY MIX — LAST 7 DAYS',
        info: 'Which kinds of record you have been touching. Counts every logged event, so an item edited five times counts five times — this is where effort went, not how many things exist.',
        subtitle: ''
      },
      mixHost
    );

    const feedEl = h('div', { class: 'pip-ch-feed' });
    const filterHost = h('div', { class: 'pip-ch-feed-filters' });
    const feedCard = card(
      {
        title: 'ACTIVITY LOG',
        info: 'The raw append-only log, newest first — every recorded change with its time, record, project and what specifically changed. Filter by kind to trace one thing at a time.',
        subtitle: ''
      },
      filterHost,
      feedEl
    );

    const panel = h('div', { class: 'pip-metrics-panel' }, [mixCard, feedCard]);
    const state = { mixHost, mixCard, feedEl, feedCard, filterHost, filter: null, recent: m.recent };
    buildFeedFilters(state, m);
    updateRecentPanel(state, m);
    return { panel, state };
  }

  function buildFeedFilters(state, m) {
    const kinds = ['all', ...Object.keys(CATEGORY_META)];
    state.filterHost.replaceChildren(
      ...kinds.map((k) => {
        const label = k === 'all' ? 'ALL' : ENTITY_LABEL[k] || k;
        const btn = h(
          'button',
          { class: 'pip-chip-toggle', dataset: { on: k === 'all' ? 'true' : 'false' } },
          label
        );
        btn.addEventListener('click', () => {
          state.filter = k === 'all' ? null : k;
          for (const other of state.filterHost.children) other.dataset.on = 'false';
          btn.dataset.on = 'true';
          renderFeed(state);
        });
        return btn;
      })
    );
    void m;
  }

  function renderFeed(state) {
    const rows = state.filter ? state.recent.filter((r) => r.entity_type === state.filter) : state.recent;
    state.feedEl.replaceChildren(
      ...(rows.length
        ? rows.map((r) => feedRow(r))
        : [h('div', { class: 'pip-ch-empty' }, 'Nothing logged for that kind yet.')])
    );
    setSubtitle(state.feedCard, `${rows.length} of ${state.recent.length} most recent events`);
    staggerIn(state.feedEl.children);
  }

  function updateRecentPanel(state, m) {
    const entries = categoryEntries(m.activityByCategory);
    const total = entries.reduce((a, c) => a + c.value, 0);
    const max = Math.max(1, ...entries.map((c) => c.value));
    state.mixHost.replaceChildren(
      ...(entries.length
        ? entries.map((c) => barRow(c.label, c.value, max, total, c.tone))
        : [h('div', { class: 'pip-ch-empty' }, 'No activity in the last 7 days.')])
    );
    setSubtitle(state.mixCard, `${total} events`);

    state.recent = m.recent;
    renderFeed(state);
  }

  // A genuine personal best — today closed more than any of the previous 27
  // days. Fires on the transition only, deduped in sessionStorage, and never
  // on first mount (which would celebrate history, not an achievement).
  function checkPersonalBest(m) {
    const days = m.throughput;
    if (days.length < 2) return;
    const today = days[days.length - 1];
    const todayN = closedCount(today);
    const priorBest = Math.max(0, ...days.slice(0, -1).map(closedCount));
    if (todayN <= priorBest || todayN === 0) return;

    let seen = null;
    try {
      seen = sessionStorage.getItem(BEST_DAY_KEY);
    } catch (_) {
      seen = null;
    }
    const stamp = `${today.day}:${todayN}`;
    if (seen === stamp) return;
    try {
      sessionStorage.setItem(BEST_DAY_KEY, stamp);
    } catch (_) {
      /* private browsing — the burst just won't dedupe across a reload */
    }
    if (seen === null) return; // first observation this session is a baseline, not a win
    const barEl = charts?.throughput.throughputChart.elFor(today.day);
    if (barEl) confettiBurst(barEl);
  }

  function updateCounter(counterObj, value) {
    if (Number(counterObj.valueEl.textContent) === value) return;
    counterObj.valueEl.textContent = String(value);
    badgePop(counterObj.valueEl);
  }

  async function render() {
    const m = await getMetrics();
    if (!charts) {
      body.innerHTML = '';
      const now = buildNowPanel(m);
      const throughput = buildThroughputPanel(m);
      const breakdown = buildBreakdownPanel(m);
      const tags = buildTagsPanel(m);
      const recent = buildRecentPanel(m);
      const panelsByKey = new Map([
        ['now', now.panel],
        ['throughput', throughput.panel],
        ['breakdown', breakdown.panel],
        ['tags', tags.panel],
        ['recent', recent.panel]
      ]);
      body.append(
        buildTabs(panelsByKey),
        h('div', { class: 'pip-metrics-panels' }, [...panelsByKey.values()])
      );
      charts = {
        now: now.state,
        throughput: throughput.state,
        breakdown: breakdown.state,
        tags: tags.state,
        recent: recent.state
      };
      checkPersonalBest(m);
      return;
    }

    updateNowPanel(charts.now, m);
    updateThroughputPanel(charts.throughput, m);
    updateBreakdownPanel(charts.breakdown, m);
    charts.tags.graph.update(m.tagGraph);
    updateTagsPanel(charts.tags, m);
    updateRecentPanel(charts.recent, m);
    checkPersonalBest(m);
  }

  function scheduleRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 120);
  }

  render();
  const unsubscribe = onChange(scheduleRender);
  return {
    el,
    destroy: () => {
      clearTimeout(debounceTimer);
      unsubscribe();
    }
  };
}
