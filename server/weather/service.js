// 3-day forecast via Open-Meteo — genuinely free, no API key, no account.
// https://open-meteo.com
//
// Polled server-side on an interval and cached, so every open tab shares one
// upstream request rather than each browser hitting the API itself.
//
// Two honesty rules, consistent with the rest of this app:
//   - the last successful payload is persisted, so a restart or a dropped
//     network shows real (if older) data instead of blanking or inventing it
//   - that payload always carries `fetchedAt`, and the UI marks it stale
//     rather than passing old numbers off as current
//
// Location lives in app_meta (set via Settings), NOT hardcoded — and until
// it's set the panel says so instead of guessing at a city.

const { db } = require('../db');
const { describe } = require('./codes');

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

// Active weather warnings. Open-Meteo doesn't carry alerts, so this comes from
// the US National Weather Service — also free and key-less, but US-only. For a
// non-US location it simply returns nothing and no alert dot appears.
// api.weather.gov asks callers to identify themselves via User-Agent.
const ALERTS_URL = 'https://api.weather.gov/alerts/active';
const USER_AGENT = 'PIP-personal-dashboard (local, single-user)';

// Air quality, also Open-Meteo and also key-less. US AQI because the bands
// below are the US EPA ones; swap both together if that ever changes.
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const AQI_BANDS = [
  { max: 50, label: 'Good' },
  { max: 100, label: 'Moderate' },
  { max: 150, label: 'Sensitive' },
  { max: 200, label: 'Unhealthy' },
  { max: 300, label: 'Very poor' },
  { max: Infinity, label: 'Hazardous' }
];

const REFRESH_MS = 60 * 60 * 1000; // matches Clu3's poll cadence — see clu3Panel.js
const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // past this the UI flags it as stale
const REQUEST_TIMEOUT_MS = 8000;
const FORECAST_DAYS = 3;

const KEYS = {
  place: 'weather_place',
  lat: 'weather_lat',
  lon: 'weather_lon',
  unit: 'weather_unit'
};
const CACHE_KEY = 'weather_cache';
const DEFAULT_UNIT = 'fahrenheit';

let timer = null;
let inFlight = null;

function metaGet(key) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function metaSet(key, value) {
  db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(key, value);
}

function getSettings() {
  const lat = metaGet(KEYS.lat);
  const lon = metaGet(KEYS.lon);
  const unit = metaGet(KEYS.unit) || DEFAULT_UNIT;
  return {
    place: metaGet(KEYS.place),
    lat: lat === null ? null : Number(lat),
    lon: lon === null ? null : Number(lon),
    unit,
    configured: lat !== null && lon !== null
  };
}

function setLocation({ place, lat, lon }) {
  if (!place || lat === undefined || lon === undefined) throw new Error('place, lat and lon are required');
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) throw new Error('lat must be between -90 and 90');
  if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) throw new Error('lon must be between -180 and 180');
  metaSet(KEYS.place, String(place));
  metaSet(KEYS.lat, String(latNum));
  metaSet(KEYS.lon, String(lonNum));
  metaSet(CACHE_KEY, ''); // location changed — old forecast is meaningless
  return getSettings();
}

function setUnit(unit) {
  if (unit !== 'fahrenheit' && unit !== 'celsius') throw new Error("unit must be 'fahrenheit' or 'celsius'");
  metaSet(KEYS.unit, unit);
  metaSet(CACHE_KEY, '');
  return getSettings();
}

function readCache() {
  const raw = metaGet(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeCache(payload) {
  metaSet(CACHE_KEY, JSON.stringify(payload));
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Never throws — an alerts outage must not take the forecast down with it.
async function fetchAlerts(lat, lon) {
  try {
    const url = `${ALERTS_URL}?point=${lat},${lon}&status=actual`;
    const data = await fetchJson(url, { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' });
    return (data.features || []).map((f) => {
      const p = f.properties || {};
      return {
        id: f.id,
        event: p.event || 'Alert',
        severity: p.severity || 'Unknown',
        urgency: p.urgency || null,
        headline: p.headline || null,
        description: p.description || null,
        instruction: p.instruction || null,
        areaDesc: p.areaDesc || null,
        starts: p.onset || p.effective || null,
        ends: p.ends || p.expires || null
      };
    });
  } catch (err) {
    console.warn('[pip] weather alerts fetch failed:', err.message);
    return [];
  }
}

// Never throws — like alerts, an air-quality outage must not take the
// forecast down with it. Returns null rather than a fake reading.
async function fetchAirQuality(lat, lon) {
  try {
    const data = await fetchJson(`${AIR_URL}?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`);
    const value = data && data.current ? data.current.us_aqi : null;
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    const aqi = Math.round(value);
    return { aqi, label: AQI_BANDS.find((b) => aqi <= b.max).label };
  } catch (err) {
    console.warn('[pip] air quality fetch failed:', err.message);
    return null;
  }
}

// City name -> candidate coordinates, for the Settings location picker.
async function searchPlaces(name) {
  const query = String(name || '').trim();
  if (!query) return [];
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const data = await fetchJson(url);
  return (data.results || []).map((r) => ({
    place: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude
  }));
}

function shape(raw, settings, alerts = [], air = null) {
  const daily = raw.daily || {};
  const days = (daily.time || []).map((date, i) => {
    const code = daily.weather_code[i];
    const { kind, label } = describe(code);
    return {
      date,
      code,
      kind,
      label,
      high: Math.round(daily.temperature_2m_max[i]),
      low: Math.round(daily.temperature_2m_min[i])
    };
  });

  // What's actually happening right now, distinct from the daily forecast —
  // today's card reads this for its temperature and icon; only the high/low
  // underneath it comes from the (predicted) daily block, same as tomorrow
  // and the day after.
  let current = null;
  if (raw.current && raw.current.temperature_2m !== undefined) {
    const { kind, label } = describe(raw.current.weather_code);
    current = {
      temp: Math.round(raw.current.temperature_2m),
      code: raw.current.weather_code,
      kind,
      label,
      observedAt: raw.current.time || null
    };
  }

  return {
    place: settings.place,
    unit: settings.unit,
    unitLabel: settings.unit === 'celsius' ? 'C' : 'F',
    timezone: raw.timezone || null,
    current,
    days,
    alerts,
    air,
    fetchedAt: new Date().toISOString()
  };
}

async function refresh() {
  const settings = getSettings();
  if (!settings.configured) return null;

  const url =
    `${FORECAST_URL}?latitude=${settings.lat}&longitude=${settings.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&current=temperature_2m,weather_code` +
    `&timezone=auto&forecast_days=${FORECAST_DAYS}&temperature_unit=${settings.unit}`;

  // Alerts and air quality are best-effort and resolve to []/null on failure,
  // so Promise.all is safe here — only the forecast can reject.
  const [raw, alerts, air] = await Promise.all([
    fetchJson(url),
    fetchAlerts(settings.lat, settings.lon),
    fetchAirQuality(settings.lat, settings.lon)
  ]);
  const payload = shape(raw, settings, alerts, air);
  writeCache(payload);
  return payload;
}

// Collapses concurrent callers onto one upstream request.
function refreshOnce() {
  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// What the panel polls. Never throws — a weather outage shouldn't surface as
// an error in the UI, just as stale-or-absent data.
async function current() {
  const settings = getSettings();
  if (!settings.configured) {
    return { configured: false, place: null, days: [], alerts: [], air: null, stale: false, error: null };
  }

  const cached = readCache();
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;

  if (cached && age < REFRESH_MS) {
    return { configured: true, ...cached, stale: false, error: null };
  }

  try {
    const fresh = await refreshOnce();
    if (fresh) return { configured: true, ...fresh, stale: false, error: null };
  } catch (err) {
    console.warn('[pip] weather fetch failed:', err.message);
    if (cached) {
      return { configured: true, ...cached, stale: age > STALE_AFTER_MS, error: 'offline' };
    }
    return { configured: true, place: settings.place, days: [], alerts: [], air: null, stale: false, error: 'offline' };
  }

  return { configured: true, ...(cached || {}), stale: age > STALE_AFTER_MS, error: null };
}

function startWeatherPoller({ intervalMs = REFRESH_MS } = {}) {
  const tick = () => {
    refreshOnce().catch(() => {
      /* current() reports the failure to the UI; nothing to do here */
    });
  };
  if (getSettings().configured) tick();
  timer = setInterval(() => {
    if (getSettings().configured) tick();
  }, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { current, refreshOnce, getSettings, setLocation, setUnit, searchPlaces, startWeatherPoller };
