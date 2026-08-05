import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client.js';

export const SOURCE_TYPES = ['manual', 'chat', 'monday', 'ado', 'email', 'screenshot'];

export function listNotes(filters = {}) {
  return apiGet('/api/notes' + qs(filters));
}

export function getNote(id) {
  return apiGet(`/api/notes/${id}`);
}

export function createNote(data) {
  return apiPost('/api/notes', data);
}

export function updateNote(id, fields) {
  return apiPatch(`/api/notes/${id}`, fields);
}

export function deleteNote(id) {
  return apiDelete(`/api/notes/${id}`);
}

export function noteCounts() {
  return apiGet('/api/notes/counts');
}
