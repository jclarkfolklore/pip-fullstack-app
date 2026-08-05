import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { THEMES, getTheme, setTheme, themeLabel, onThemeChange } from '../../lib/theme.js';
import { getTone, setTone } from '../../api/clu3Repo.js';
import { weatherSettings, searchPlaces, updateWeatherSettings } from '../../api/weatherRepo.js';

export const kind = 'settings';

const TONES = [
  { key: 'sparse', label: 'Sparse', hint: 'Only when it matters' },
  { key: 'balanced', label: 'Balanced', hint: 'Default' },
  { key: 'chatty', label: 'Chatty', hint: 'Keeps you company' }
];

export async function renderTile(ctx) {
  return h(
    'button',
    { class: 'pip-tile', dataset: { widget: 'settings' }, onClick: (e) => ctx.open('settings', e.currentTarget) },
    [
      icon('theme', { size: 20, className: 'pip-tile-icon' }),
      h('div', { class: 'pip-tile-sub' }, `${themeLabel(getTheme())} theme`),
      h('div', { class: 'pip-tile-label' }, 'SETTINGS')
    ]
  );
}

function card(title, children) {
  return h('div', { class: 'pip-card' }, [
    h('div', { class: 'pip-card-top' }, [h('div', { class: 'pip-card-title' }, title)]),
    ...children
  ]);
}

export function renderFull(ctx) {
  const el = h('div', { class: 'pip-view' }, [
    h('div', { class: 'pip-view-header' }, [
      h('button', { class: 'pip-back', onClick: ctx.goHome }, [icon('back', { size: 12 }), ' HOME']),
      h('div', { class: 'pip-view-title' }, 'SETTINGS')
    ])
  ]);
  const body = h('div', { class: 'pip-view-body pip-card-list' });
  el.appendChild(body);

  // Sections render independently so a failed weather lookup can't take the
  // theme picker down with it.
  const appearanceHost = h('div');
  const clu3Host = h('div');
  const weatherHost = h('div');
  body.append(appearanceHost, clu3Host, weatherHost);

  function renderAppearance() {
    appearanceHost.innerHTML = '';
    appearanceHost.appendChild(
      card('Appearance', [
        h(
          'div',
          { class: 'pip-card-actions' },
          THEMES.map((name) =>
            h(
              'button',
              {
                class: `pip-action-btn ${getTheme() === name ? 'pip-action-btn--primary' : 'pip-action-btn--ghost'}`,
                onClick: () => {
                  setTheme(name);
                  renderAppearance();
                }
              },
              themeLabel(name)
            )
          )
        )
      ])
    );
  }

  async function renderClu3() {
    let current = 'balanced';
    try {
      current = (await getTone()).tone;
    } catch (_) {
      /* fall back to the default label if the server is unreachable */
    }
    clu3Host.innerHTML = '';
    clu3Host.appendChild(
      card('Clu3 — how much they talk', [
        h(
          'div',
          { class: 'pip-card-actions' },
          TONES.map((t) =>
            h(
              'button',
              {
                class: `pip-action-btn ${current === t.key ? 'pip-action-btn--primary' : 'pip-action-btn--ghost'}`,
                title: t.hint,
                onClick: async () => {
                  await setTone(t.key);
                  renderClu3();
                }
              },
              t.label
            )
          )
        )
      ])
    );
  }

  async function renderWeather() {
    let settings = { place: null, unit: 'fahrenheit', configured: false };
    try {
      settings = await weatherSettings();
    } catch (_) {
      /* render the form anyway so the user can still set a location */
    }

    weatherHost.innerHTML = '';

    const status = h(
      'div',
      { class: 'pip-card-meta' },
      settings.configured ? settings.place : 'No location set — forecast is blank until you pick one.'
    );

    const input = h('input', { type: 'text', placeholder: 'City name, e.g. Austin' });
    const results = h('div', { class: 'pip-card-actions' });

    async function runSearch() {
      const q = input.value.trim();
      results.innerHTML = '';
      if (!q) return;
      results.appendChild(h('div', { class: 'pip-card-meta' }, 'Searching…'));
      try {
        const places = await searchPlaces(q);
        results.innerHTML = '';
        if (!places.length) {
          results.appendChild(h('div', { class: 'pip-card-meta' }, 'No match.'));
          return;
        }
        for (const p of places) {
          results.appendChild(
            h(
              'button',
              {
                class: 'pip-action-btn',
                onClick: async () => {
                  await updateWeatherSettings({ place: p.place, lat: p.lat, lon: p.lon });
                  renderWeather();
                }
              },
              p.place
            )
          );
        }
      } catch (err) {
        results.innerHTML = '';
        results.appendChild(h('div', { class: 'pip-card-meta' }, "Couldn't reach the lookup service."));
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });

    const units = h('div', { class: 'pip-card-actions' }, [
      ...['fahrenheit', 'celsius'].map((u) =>
        h(
          'button',
          {
            class: `pip-action-btn ${settings.unit === u ? 'pip-action-btn--primary' : 'pip-action-btn--ghost'}`,
            onClick: async () => {
              await updateWeatherSettings({ unit: u });
              renderWeather();
            }
          },
          u === 'fahrenheit' ? '°F' : '°C'
        )
      )
    ]);

    weatherHost.appendChild(
      card('Weather location', [
        status,
        h('div', { class: 'pip-field' }, [input]),
        h('div', { class: 'pip-card-actions' }, [
          h('button', { class: 'pip-action-btn pip-action-btn--primary', onClick: runSearch }, 'SEARCH')
        ]),
        results,
        units
      ])
    );
  }

  function renderBackup() {
    body.appendChild(
      card('Backup', [
        h('div', { class: 'pip-card-actions' }, [
          h('a', { class: 'pip-action-btn pip-action-btn--primary', href: '/api/export' }, 'EXPORT BACKUP .sqlite')
        ])
      ])
    );
  }

  renderAppearance();
  renderClu3();
  renderWeather();
  renderBackup();

  const unsubscribe = onThemeChange(renderAppearance);
  return { el, destroy: unsubscribe };
}
