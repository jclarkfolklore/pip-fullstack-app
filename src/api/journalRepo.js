import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client.js';

export function listEntries(filters = {}) {
  return apiGet('/api/journal' + qs(filters));
}

export function getEntry(id) {
  return apiGet(`/api/journal/${id}`);
}

export function createEntry(data) {
  return apiPost('/api/journal', data);
}

export function updateEntry(id, fields) {
  return apiPatch(`/api/journal/${id}`, fields);
}

export function deleteEntry(id) {
  return apiDelete(`/api/journal/${id}`);
}

export function entryCount() {
  return apiGet('/api/journal/counts');
}
