import { apiGet, apiPatch, qs } from './client.js';

export function weatherNow() {
  return apiGet('/api/weather');
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
