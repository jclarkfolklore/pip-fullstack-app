// 3-day forecast, right column beneath Clu3.
//
// All fetching/caching is server-side (server/weather/service.js) — this just
// renders what the API reports. Refresh is slow on purpose: upstream data
// changes on roughly an hourly cadence and the server caches anyway.
//
// Layout is deliberately at-a-glance: today large and full width, the next two
// days small underneath at half width each. No "current conditions" reading —
// this panel answers "what are the next three days," not "what is it doing
// right now."
//
// Honest states, no invented data:
//   - not configured -> tells you to set a location in Settings
//   - offline/failed  -> shows the last real reading, marked stale
import { h, fmtDateTime, fmtTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderWeatherArt } from '../lib/weatherArt.js';
import { weatherNow, refreshWeather } from '../api/weatherRepo.js';
import { isStatic } from '../api/client.js';
import { navigateTo } from './router.js';
import { openModal } from './modal.js';
import { openWeatherSheetModal } from './weatherSheetModal.js';

// Matches Clu3's poll cadence (clu3Panel.js) — both update on the same
// hourly rhythm, with a manual "get latest" button on each for whenever you
// don't want to wait.
const REFRESH_MS = 60 * 60 * 1000;

function dayName(dateStr, index) {
  if (index === 0) return 'TODAY';
  // Parse at local noon so a date-only string can't slip a day across zones.
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
}

function alertModal(alerts, place) {
  const cards = alerts.map((a) =>
    h('div', { class: 'pip-modal-alert' }, [
      h('div', { class: 'pip-modal-alert-top' }, [
        h('span', { class: 'pip-modal-alert-event' }, a.event),
        h('span', { class: 'pip-modal-alert-sev', dataset: { severity: String(a.severity).toLowerCase() } }, a.severity)
      ]),
      a.headline ? h('div', { class: 'pip-modal-alert-headline' }, a.headline) : null,
      a.areaDesc ? h('div', { class: 'pip-modal-alert-meta' }, a.areaDesc) : null,
      a.starts || a.ends
        ? h(
            'div',
            { class: 'pip-modal-alert-meta' },
            `${a.starts ? fmtDateTime(a.starts) : '—'} → ${a.ends ? fmtDateTime(a.ends) : '—'}`
          )
        : null,
      a.description ? h('div', { class: 'pip-modal-alert-desc' }, a.description) : null,
      a.instruction ? h('div', { class: 'pip-modal-alert-instruction' }, a.instruction) : null
    ])
  );

  openModal({
    title: `WEATHER ALERTS — ${place || ''}`.trim(),
    body: cards,
    footer: h('div', { class: 'pip-modal-note' }, 'Source: US National Weather Service')
  });
}

export function mountWeatherPanel(container) {
  const body = h('div', { class: 'pip-wx-body' });
  const placeEl = h('span', { class: 'pip-wx-place' }, '');
  const refreshBtn = h('button', { class: 'pip-wx-refresh', title: 'Get latest now' }, [icon('refresh', { size: 15 })]);
  // In a snapshot there's nothing to refresh FROM: the button posts, which
  // returns null with no server, and the panel would then try to render it.
  if (isStatic()) refreshBtn.style.display = 'none';
  const sheetBtn = h('button', { class: 'pip-clu3-sheet-btn', title: 'Preview weather art & codes' }, [
    icon('grid', { size: 15 })
  ]);
  sheetBtn.addEventListener('click', () => openWeatherSheetModal());

  const header = h('div', { class: 'pip-wx-header' }, [
    h('span', { class: 'pip-wx-title' }, [icon('clock', { size: 10 }), ' 3-DAY']),
    placeEl,
    sheetBtn,
    refreshBtn
  ]);
  const updatedEl = h('div', { class: 'pip-wx-updated' }, '');

  const widget = h('div', { class: 'pip-wx-widget' }, [header, body, updatedEl]);
  container.appendChild(widget);

  let destroyed = false;
  let refreshing = false;

  // `current` is live right-now conditions (from Open-Meteo's `current`
  // block) — it's what the art and the big number represent. `day` is still
  // the daily forecast, and only feeds the H/L line beneath: a high/low is
  // inherently a prediction (the day isn't over), so it stays sourced from
  // the forecast even though the headline temperature no longer is.
  // `current` can be null on old cached payloads from before this existed —
  // fall back to the forecast rather than showing nothing.
  function todayCard(day, current, alerts, place, air) {
    const hasAlerts = alerts && alerts.length > 0;
    const kind = current ? current.kind : day.kind;
    const label = current ? current.label : day.label;
    const bigTemp = current ? current.temp : day.high;

    // Three stacked rows rather than three columns. Columns forced the
    // condition and air quality to share a narrow gutter, which is what made
    // this hard to read — in a ~276px panel there simply isn't width for
    // three independent things plus a 38px number.
    //
    //   head   TODAY .................... [alert]
    //   main   [art]  79° ............ Clear
    //   stats  H 80°  L 58° ..... AQI 54 Moderate
    //
    // Each row has one job, and the eye lands on the temperature first.
    const head = h('div', { class: 'pip-wx-today-head' }, [
      h('span', { class: 'pip-wx-dayname' }, dayName(day.date, 0)),
      // An alert is the one thing worth interrupting a glance for, so it gets
      // a counted badge on the title row — not a bare dot you have to already
      // know is clickable.
      hasAlerts
        ? h('span', { class: 'pip-wx-alert-badge', title: `${alerts.length} active alert(s) — tap to read` }, [
            icon('alert', { size: 9 }),
            h('span', {}, `${alerts.length} ALERT${alerts.length === 1 ? '' : 'S'}`)
          ])
        : null
    ].filter(Boolean));

    const main = h('div', { class: 'pip-wx-today-main' }, [
      renderWeatherArt(kind, { className: 'pip-wx-art--lg' }),
      h(
        'div',
        { class: 'pip-wx-today-temp', title: current ? 'current temperature' : "today's forecast high" },
        `${bigTemp}°`
      ),
      h('div', { class: 'pip-wx-today-cond' }, label)
    ]);

    const stats = h('div', { class: 'pip-wx-today-stats' }, [
      h('span', { class: 'pip-wx-today-hl' }, [
        h('span', { class: 'pip-wx-hl-key' }, 'H'),
        ` ${day.high}°  `,
        h('span', { class: 'pip-wx-hl-key' }, 'L'),
        ` ${day.low}°`
      ]),
      air
        ? h('span', { class: 'pip-wx-aqi', dataset: { band: air.label.toLowerCase().replace(/\s+/g, '-') } }, [
            h('span', { class: 'pip-wx-aqi-label' }, 'AQI'),
            h('span', { class: 'pip-wx-aqi-value' }, String(air.aqi)),
            h('span', { class: 'pip-wx-aqi-band' }, air.label)
          ])
        : null
    ].filter(Boolean));

    const children = [head, main, stats];
    return hasAlerts
      ? h('button', { class: 'pip-wx-today has-alert', onClick: () => alertModal(alerts, place) }, children)
      : h('div', { class: 'pip-wx-today' }, children);
  }

  function smallCard(day, index) {
    return h('div', { class: 'pip-wx-day' }, [
      h('div', { class: 'pip-wx-dayname' }, dayName(day.date, index)),
      // Art beside the temperatures rather than stacked above them — uses the
      // card's width instead of leaving gutters either side of a centred icon.
      h('div', { class: 'pip-wx-day-row' }, [
        renderWeatherArt(day.kind),
        h('div', { class: 'pip-wx-temps' }, [
          h('span', { class: 'pip-wx-high' }, `${day.high}°`),
          h('span', { class: 'pip-wx-low' }, `${day.low}°`)
        ])
      ]),
      h('div', { class: 'pip-wx-daylabel' }, day.label)
    ]);
  }

  function render(data) {
    body.innerHTML = '';
    placeEl.textContent = data.place || '';

    if (!data.configured) {
      body.appendChild(
        h('div', { class: 'pip-wx-empty' }, [
          h('div', {}, 'No location set.'),
          h('button', { class: 'pip-wx-link', onClick: () => navigateTo('settings') }, 'SET LOCATION')
        ])
      );
      return;
    }

    if (!data.days || !data.days.length) {
      body.appendChild(
        h('div', { class: 'pip-wx-empty' }, [
          h('div', {}, data.error === 'offline' ? "Can't reach weather." : 'No forecast yet.')
        ])
      );
      return;
    }

    const [today, ...rest] = data.days;
    body.appendChild(todayCard(today, data.current || null, data.alerts || [], data.place, data.air || null));
    if (rest.length) {
      body.appendChild(h('div', { class: 'pip-wx-rest' }, rest.map((d, i) => smallCard(d, i + 1))));
    }

    if (data.stale || data.error === 'offline') {
      body.appendChild(h('div', { class: 'pip-wx-stale' }, 'last known — offline'));
    }

    updatedEl.textContent = data.fetchedAt ? `updated ${fmtTime(data.fetchedAt)}` : '';
  }

  async function refresh() {
    if (destroyed) return;
    try {
      const data = await weatherNow();
      if (!destroyed) render(data);
    } catch (err) {
      console.warn('[weather] refresh failed:', err.message);
    }
  }

  refreshBtn.addEventListener('click', async () => {
    if (destroyed || refreshing) return;
    refreshing = true;
    refreshBtn.classList.add('is-spinning');
    try {
      const data = await refreshWeather();
      if (!destroyed) render(data);
    } catch (err) {
      console.warn('[weather] manual refresh failed:', err.message);
    } finally {
      refreshing = false;
      refreshBtn.classList.remove('is-spinning');
    }
  });

  refresh();
  // No poll in a snapshot — the data is frozen by definition, so re-fetching
  // the same captured file on a timer is pure noise.
  const tick = isStatic() ? null : setInterval(refresh, REFRESH_MS);

  return {
    el: widget,
    destroy() {
      destroyed = true;
      if (tick) clearInterval(tick);
    }
  };
}
