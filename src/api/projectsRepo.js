import { apiGet, apiPost, apiPatch, apiDelete, qs } from './client.js';

export function listProjects(filters = {}) {
  return apiGet('/api/projects' + qs(filters));
}

export function getProject(id) {
  return apiGet(`/api/projects/${id}`);
}

export function createProject(data) {
  return apiPost('/api/projects', data);
}

export function updateProject(id, fields) {
  return apiPatch(`/api/projects/${id}`, fields);
}

export function deleteProject(id) {
  return apiDelete(`/api/projects/${id}`);
}
