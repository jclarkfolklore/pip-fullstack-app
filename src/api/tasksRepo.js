import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client.js';

export function listTasks(filters = {}) {
  return apiGet('/api/tasks' + qs(filters));
}

export function getTask(id) {
  return apiGet(`/api/tasks/${id}`);
}

export function createTask(data) {
  return apiPost('/api/tasks', data);
}

export function updateTask(id, fields) {
  return apiPatch(`/api/tasks/${id}`, fields);
}

export function setTaskStatus(id, status) {
  return apiPost(`/api/tasks/${id}/status`, { status });
}

export function deleteTask(id) {
  return apiDelete(`/api/tasks/${id}`);
}

export function taskCounts() {
  return apiGet('/api/tasks/counts');
}
