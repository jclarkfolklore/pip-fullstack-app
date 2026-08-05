import { apiGet, apiPatch, apiPost, qs } from './client.js';

export function weatherNow() {
  return apiGet('/api/weather');
}

export function refreshWeather() {
  return apiPost('/api/weather/refresh', {});
}

export function weatherSettings() {
  return apiGet('/api/weather/settings');
}

export function searchPlaces(q) {
  return apiGet('/api/weather/search' + qs({ q }));
}

export function updateWeatherSettings(fields) {
  return apiPatch('/api/weather/settings', fields);
}

// Every upstream WMO code grouped by the art kind it resolves to — powers the
// art preview, and is the check that our art covers what the API can send.
export function weatherCodes() {
  return apiGet('/api/weather/codes');
}
