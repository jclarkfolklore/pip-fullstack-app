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

// Combines outcome + optional "turn into a task" in one call — the server
// does the resolve + create-task + link atomically.
export function resolveInboxItem(id, { outcomeMd = '', makeTask = false, taskTitle = null } = {}) {
  return apiPost(`/api/inbox/${id}/resolve`, { outcomeMd, makeTask, taskTitle });
}

export function archiveItem(id) {
  return apiPost(`/api/inbox/${id}/archive`, {});
}

export function deleteItem(id) {
  return apiDelete(`/api/inbox/${id}`);
}

export function stageCounts() {
  return apiGet('/api/inbox/counts');
}
