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

    // Three columns spread across the full card width: art, temperature,
    // then the condition — so nothing is crammed and nothing is wasted.
    const children = [
      h('div', { class: 'pip-wx-today-left' }, [
        h('div', { class: 'pip-wx-dayname' }, dayName(day.date, 0)),
        renderWeatherArt(kind, { className: 'pip-wx-art--lg' })
      ]),
      h('div', { class: 'pip-wx-today-temps' }, [
        h('div', { class: 'pip-wx-today-high', title: current ? 'current temperature' : "today's forecast high" }, `${bigTemp}°`),
        h('div', { class: 'pip-wx-today-low' }, `H ${day.high}° · L ${day.low}°`)
      ]),
      h('div', { class: 'pip-wx-today-right' }, [
        h('div', { class: 'pip-wx-today-label' }, label),
        // Air quality rides in the space the condition label already occupies
        // rather than claiming a row of its own — the band word carries the
        // meaning, the number is there if you want it.
        air
          ? h('div', { class: 'pip-wx-aqi', dataset: { band: air.label.toLowerCase().replace(/\s+/g, '-') } }, [
              h('span', { class: 'pip-wx-aqi-label' }, 'AQI'),
              h('span', { class: 'pip-wx-aqi-value' }, String(air.aqi)),
              h('span', { class: 'pip-wx-aqi-band' }, air.label)
            ])
          : null
      ].filter(Boolean))
    ];

    const card = hasAlerts
      ? h('button', { class: 'pip-wx-today has-alert', onClick: () => alertModal(alerts, place) }, children)
      : h('div', { class: 'pip-wx-today' }, children);

    // An alert is the one thing here worth interrupting a glance for, so it
    // gets a real badge with a count and an affordance — not a bare dot you
    // have to already know is clickable.
    if (hasAlerts) {
      card.appendChild(
        h('span', { class: 'pip-wx-alert-badge', title: `${alerts.length} active alert(s) — tap to read` }, [
          icon('alert', { size: 9 }),
          h('span', {}, `${alerts.length} ALERT${alerts.length === 1 ? '' : 'S'}`)
        ])
      );
    }
    return card;
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
  const tick = setInterval(refresh, REFRESH_MS);

  return {
    el: widget,
    destroy() {
      destroyed = true;
      clearInterval(tick);
    }
  };
}
