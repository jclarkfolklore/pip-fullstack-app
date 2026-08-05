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
import { h, fmtDateTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { renderWeatherArt } from '../lib/weatherArt.js';
import { weatherNow } from '../api/weatherRepo.js';
import { navigateTo } from './router.js';
import { openModal } from './modal.js';

const REFRESH_MS = 10 * 60 * 1000;

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
  const header = h('div', { class: 'pip-wx-header' }, [
    h('span', { class: 'pip-wx-title' }, [icon('clock', { size: 10 }), ' 3-DAY']),
    placeEl
  ]);

  const widget = h('div', { class: 'pip-wx-widget' }, [header, body]);
  container.appendChild(widget);

  let destroyed = false;

  function todayCard(day, alerts, place) {
    const hasAlerts = alerts && alerts.length > 0;

    const children = [
      hasAlerts ? h('span', { class: 'pip-wx-dot', title: `${alerts.length} active alert(s)` }) : null,
      h('div', { class: 'pip-wx-today-left' }, [
        h('div', { class: 'pip-wx-dayname' }, dayName(day.date, 0)),
        renderWeatherArt(day.kind, { className: 'pip-wx-art--lg' })
      ]),
      h('div', { class: 'pip-wx-today-right' }, [
        h('div', { class: 'pip-wx-today-high' }, `${day.high}°`),
        h('div', { class: 'pip-wx-today-low' }, `low ${day.low}°`),
        h('div', { class: 'pip-wx-today-label' }, day.label),
        hasAlerts ? h('div', { class: 'pip-wx-alert-hint' }, `${alerts.length} ALERT — TAP`) : null
      ])
    ].filter(Boolean);

    // Only interactive when there's actually something to open.
    if (hasAlerts) {
      return h(
        'button',
        { class: 'pip-wx-today has-alert', onClick: () => alertModal(alerts, place) },
        children
      );
    }
    return h('div', { class: 'pip-wx-today' }, children);
  }

  function smallCard(day, index) {
    return h('div', { class: 'pip-wx-day' }, [
      h('div', { class: 'pip-wx-dayname' }, dayName(day.date, index)),
      renderWeatherArt(day.kind),
      h('div', { class: 'pip-wx-temps' }, [
        h('span', { class: 'pip-wx-high' }, `${day.high}°`),
        h('span', { class: 'pip-wx-low' }, `${day.low}°`)
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
    body.appendChild(todayCard(today, data.alerts || [], data.place));
    if (rest.length) {
      body.appendChild(h('div', { class: 'pip-wx-rest' }, rest.map((d, i) => smallCard(d, i + 1))));
    }

    if (data.stale || data.error === 'offline') {
      body.appendChild(h('div', { class: 'pip-wx-stale' }, 'last known — offline'));
    }
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
