import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client.js';

export const SOURCE_TYPES = ['manual', 'chat', 'monday', 'ado', 'email', 'screenshot'];

export function listInboxItems(filters = {}) {
  return apiGet('/api/inbox' + qs(filters));
}

export function getInboxItem(id) {
  return apiGet(`/api/inbox/${id}`);
}

export function createInboxItem(data) {
  return apiPost('/api/inbox', data);
}

export function updateInboxItem(id, fields) {
  return apiPatch(`/api/inbox/${id}`, fields);
}

export function setStage(id, stage) {
  return apiPost(`/api/inbox/${id}/stage`, { stage });
}

// Combines outcome + spawning zero or more tasks in one call — the server
// resolves the item and creates a task per title, all linked back to it.
export function resolveInboxItem(id, { outcomeMd = '', taskTitles = [] } = {}) {
  return apiPost(`/api/inbox/${id}/resolve`, { outcomeMd, taskTitles });
}

export function archiveItem(id) {
  return apiPost(`/api/inbox/${id}/archive`, {});
}

export function deactivateItem(id) {
  return apiPost(`/api/inbox/${id}/deactivate`, {});
}

export function reactivateItem(id) {
  return apiPost(`/api/inbox/${id}/reactivate`, {});
}

export function deleteItem(id) {
  return apiDelete(`/api/inbox/${id}`);
}

export function stageCounts() {
  return apiGet('/api/inbox/counts');
}
