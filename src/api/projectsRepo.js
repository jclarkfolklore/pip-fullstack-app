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

// ---- project detail --------------------------------------------------
// Everything belonging to a project, plus its stakeholders — powers the
// project detail modal.

export function projectContents(id) {
  return apiGet(`/api/projects/${id}/contents`);
}

export function listContacts(projectId) {
  return apiGet(`/api/projects/${projectId}/contacts`);
}

export function addContact(projectId, body) {
  return apiPost(`/api/projects/${projectId}/contacts`, body);
}

export function deleteContact(contactId) {
  return apiDelete(`/api/projects/contacts/${contactId}`);
}
